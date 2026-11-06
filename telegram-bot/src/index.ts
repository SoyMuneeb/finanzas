import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Bot, GrammyError, HttpError } from "grammy";
import { z } from "zod";
import { createApi, ApiError, summaryText } from "./api.js";
import { interpretMessage } from "./agent-hook.js";
import { ParseError } from "./parser.js";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const settings = z
  .object({
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    FINANZAS_API_KEY: z.string().min(1),
    FINANZAS_API_URL: z.string().url().default("http://127.0.0.1:3001"),
    TELEGRAM_ALLOWED_USER_IDS: z
      .string()
      .min(1)
      .refine(
        (value) => value.split(",").every((id) => /^\d+$/.test(id.trim())),
        "Usa IDs numéricos separados por comas",
      ),
    FINANZAS_DEFAULT_ACCOUNT: z.string().optional(),
    FINANZAS_DEFAULT_CATEGORY: z.string().optional(),
  })
  .safeParse(process.env);
if (!settings.success) {
  // Report missing field names only; validation errors may otherwise expose input values.
  console.error(
    "Configuración inválida:",
    [
      ...new Set(settings.error.issues.map((issue) => issue.path.join("."))),
    ].join(", "),
  );
  process.exit(1);
}
const cfg = settings.data;
const allowed = new Set(
  cfg.TELEGRAM_ALLOWED_USER_IDS.split(",").map((id) => id.trim()),
);
const api = createApi(cfg.FINANZAS_API_URL, cfg.FINANZAS_API_KEY);
const bot = new Bot(cfg.TELEGRAM_BOT_TOKEN);
bot.use(async (ctx, next) => {
  if (
    !ctx.from ||
    !allowed.has(String(ctx.from.id)) ||
    ctx.chat?.type !== "private"
  )
    return;
  await next();
});
bot.command(["start", "help", "ayuda"], (ctx) =>
  ctx.reply(
    "Envía «café 2,50» o «nómina 1800 ingreso». Puedes añadir una fecha: «compra 25,90 05/11/2026» o «ayer». Los movimientos quedan pendientes de revisión en Finanzas. /resumen muestra este mes.",
  ),
);
bot.command("resumen", async (ctx) => {
  try {
    await ctx.reply(summaryText(await api.summary()));
  } catch (error) {
    await ctx.reply(
      error instanceof ApiError
        ? error.message
        : "No se pudo consultar el resumen. Comprueba la conexión con la API.",
    );
  }
});
bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/"))
    return ctx.reply("Comando desconocido. Usa /ayuda.");
  try {
    const movement = await interpretMessage(ctx.message.text);
    if (cfg.FINANZAS_DEFAULT_ACCOUNT)
      movement.account = cfg.FINANZAS_DEFAULT_ACCOUNT;
    if (cfg.FINANZAS_DEFAULT_CATEGORY)
      movement.category = cfg.FINANZAS_DEFAULT_CATEGORY;
    await api.addMovement(movement);
    const amount = new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
    }).format(movement.amount);
    await ctx.reply(
      `${movement.type === "INCOME" ? "Ingreso" : "Gasto"} añadido: ${movement.concept} · ${amount}. Pendiente de revisión en Finanzas.`,
    );
  } catch (error) {
    await ctx.reply(
      error instanceof ParseError || error instanceof ApiError
        ? error.message
        : "No se pudo registrar. Comprueba la conexión y revisa la app antes de reenviar para evitar duplicados.",
    );
  }
});
bot.catch((error) => {
  // Never log full request objects: they can contain bot credentials and financial messages.
  console.error(
    error.error instanceof GrammyError
      ? "Telegram rechazó una operación."
      : error.error instanceof HttpError
        ? "Error de conexión con Telegram."
        : "Error interno del bot.",
  );
});
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
await bot.start({
  onStart: () =>
    console.log(
      "Bot de Finanzas iniciado; solo se aceptan chats privados autorizados.",
    ),
});
