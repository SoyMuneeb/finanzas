import { prisma, defaults } from "./core.js";
import bcrypt from "bcryptjs";
import { movementHash } from "./importer.js";
const email = process.env.SEED_EMAIL || "demo@finanzas.local",
  password = process.env.SEED_PASSWORD;
if (!password || password.length < 12 || Buffer.byteLength(password, "utf8") > 72)
  throw new Error(
    "Define SEED_PASSWORD (mínimo 12 caracteres, máximo 72 bytes UTF-8). No se crea una contraseña predeterminada.",
  );
if (await prisma.user.findUnique({ where: { email } })) {
  console.log("Usuario existente: seed omitido para conservar sus datos");
  await prisma.$disconnect();
  process.exit(0);
}
if (await prisma.user.count()) throw new Error("Seed permitido solo en una base vacía; no se crean usuarios adicionales.");
const user = await prisma.user.create({
  data: { email, passwordHash: await bcrypt.hash(password, 12) },
});
await defaults(user.id);
const account = await prisma.account.findFirstOrThrow({
  where: { userId: user.id },
});
await prisma.account.update({
  where: { id: account.id },
  data: { initialBalanceCents: 150000 },
});
const categories = await prisma.category.findMany({
  where: { userId: user.id },
});
const cat = (name: string) => categories.find((c) => c.name === name)!.id;
const now = new Date();
for (let i = 11; i >= 0; i--) {
  const base = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
    ),
    month = base.toISOString().slice(0, 7);
  for (const [day, concept, amountCents, type, category] of [
    [1, "Nómina mensual", 245000, "INCOME", "Nómina"],
    [2, "Alquiler vivienda", 78000, "EXPENSE", "Vivienda"],
    [5, "Mercadona compra semanal", 16500 + i * 230, "EXPENSE", "Alimentación"],
    [12, "Transporte y gasolina", 8200 + i * 120, "EXPENSE", "Transporte"],
    [18, "Restaurante y ocio", 12400 + i * 340, "EXPENSE", "Ocio"],
    [20, "Netflix", 1599, "EXPENSE", "Suscripciones"],
    [25, "Farmacia", 2800 + i * 70, "EXPENSE", "Salud"],
  ] as const) {
    const date = month + "-" + String(day).padStart(2, "0");
    if (date > now.toISOString().slice(0, 10)) continue;
    await prisma.movement.create({
      data: {
        userId: user.id,
        accountId: account.id,
        date,
        concept,
        amountCents,
        type,
        categoryId: cat(category),
        hash: movementHash(date, amountCents, type, concept, account.id),
      },
    });
  }
}
for (const [name, amountCents] of [
  [null, 170000],
  ["Alimentación", 25000],
  ["Ocio", 20000],
] as const)
  await prisma.budget.create({
    data: {
      userId: user.id,
      period: "MONTHLY",
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      categoryId: name ? cat(name) : null,
      amountCents,
    },
  });
console.log("Datos de ejemplo creados para " + email);
await prisma.$disconnect();
