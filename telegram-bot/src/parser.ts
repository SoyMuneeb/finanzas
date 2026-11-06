import { z } from "zod";

/** Public integration contract. Amounts are positive euros; the API stores cents. */
export const movementSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isRealDate, "Fecha no válida"),
    amount: z
      .number()
      .positive()
      .max(999_999_999.99)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
        "Usa como máximo dos decimales",
      ),
    type: z.enum(["INCOME", "EXPENSE"]),
    concept: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).optional(),
    account: z.string().trim().min(1).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type ParsedMovement = z.infer<typeof movementSchema>;

function isRealDate(value: string): boolean {
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}

export function localDate(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => p.find((v) => v.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export class ParseError extends Error {}

/** Conservative parser: ambiguous messages are rejected instead of inventing amounts. */
export function parseMovement(text: string, now = new Date()): ParsedMovement {
  let input = text.trim();
  if (!input || input.length > 500)
    throw new ParseError(
      "Escribe un concepto y un importe, por ejemplo: café 2,50.",
    );
  if (/[£$]|\b(?:USD|GBP|d[oó]lares|libras)\b/i.test(input))
    throw new ParseError("Solo se admiten importes en euros.");
  let date = localDate(now);
  const dates = [
    ...input.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/g),
  ];
  if (dates.length > 1) throw new ParseError("Indica una sola fecha.");
  if (dates[0]) {
    const value = dates[0][0];
    if (value.includes("/")) {
      const [day, month, year] = value.split("/");
      date = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
    } else date = value;
    if (!isRealDate(date))
      throw new ParseError("La fecha no existe. Usa dd/mm/aaaa o aaaa-mm-dd.");
    input = input.replace(value, " ");
  }
  const relative = [...input.matchAll(/\b(hoy|ayer)\b/gi)];
  if ((relative.length && dates.length) || relative.length > 1)
    throw new ParseError("Indica una sola fecha.");
  if (relative[0]) {
    if (relative[0][0].toLowerCase() === "ayer") {
      const d = new Date(`${date}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      date = d.toISOString().slice(0, 10);
    }
    input = input.replace(relative[0][0], " ");
  }
  // Match whole numeric tokens to avoid silently accepting malformed 1,2,3 or 3.0000.
  const tokens = [
    ...input.matchAll(/(?<![\p{L}\d])[-+]?\d[\d.,]*(?![\p{L}\d])/gu),
  ];
  if (tokens.length !== 1)
    throw new ParseError("Indica un único importe, por ejemplo: compra 25,90.");
  const raw = tokens[0]![0];
  if (
    !/^[+-]?(?:\d+(?:[,.]\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)$/.test(raw)
  ) {
    throw new ParseError("Importe no válido. Ejemplos: 2,50 o 1.800,25.");
  }
  const normalized = raw.includes(",")
    ? raw.replaceAll(".", "").replace(",", ".")
    : /^[-+]?\d{1,3}(?:\.\d{3})+$/.test(raw)
      ? raw.replaceAll(".", "")
      : raw;
  const amount = Math.abs(Number(normalized));
  const income = /\b(?:ingreso|cobro|income)\b/i.test(input);
  const expense = /\b(?:gasto|pago|expense)\b/i.test(input);
  if (income && (expense || raw.startsWith("-")))
    throw new ParseError("El tipo es ambiguo: usa ingreso o gasto.");
  const concept = input
    .replace(raw, " ")
    .replace(
      /\b(?:ingreso|cobro|income|gasto|pago|expense|euros?|EUR)\b/gi,
      " ",
    )
    .replaceAll("€", " ")
    .replace(/\s+/g, " ")
    .trim();
  const result = movementSchema.safeParse({
    date,
    amount,
    type: income ? "INCOME" : "EXPENSE",
    concept,
  });
  if (!result.success)
    throw new ParseError(
      "Revisa el concepto, la fecha y un importe positivo con hasta dos decimales.",
    );
  return result.data;
}
