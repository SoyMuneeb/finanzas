import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { randomBytes } from "node:crypto";
const configuredDatabaseUrl = process.env.DATABASE_URL || "file:./dev.db";
const databaseUrl = configuredDatabaseUrl.startsWith("file:")
  ? `file:${resolve(dirname(fileURLToPath(import.meta.url)), "../prisma", configuredDatabaseUrl.slice(5))}`
  : configuredDatabaseUrl;
export const prisma = new PrismaClient({
  adapter: new PrismaLibSQL({ url: databaseUrl }),
});
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Fecha inválida",
  );
export const moneySchema = z
  .number()
  .finite()
  .positive()
  .max(10000000)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
    "Máximo dos decimales",
  );
export const typeSchema = z.enum(["INCOME", "EXPENSE"]);
export const movementSchema = z.object({
  date: dateSchema,
  concept: z.string().trim().min(1).max(300),
  amount: moneySchema,
  type: typeSchema,
  categoryId: z.string().nullable().optional(),
  accountId: z.string().min(1),
  notes: z.string().max(2000).default(""),
  reviewPending: z.boolean().optional(),
});
export function cents(n: number) {
  return Math.round(n * 100);
}
export const jwtSecret =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "test"
    ? "test-secret-only-at-least-thirty-two"
    : "");
export function ensureConfig() {
  if (jwtSecret.length < 32)
    throw new Error(
      "Configura JWT_SECRET con al menos 32 caracteres en server/.env",
    );
}
export async function defaults(userId: string) {
  await prisma.account.create({ data: { userId, name: "Cuenta principal" } });
  for (const [name, color, icon, type] of [
    ["Sin categorizar", "#94a3b8", "tag", "EXPENSE"],
    ["Vivienda", "#6366f1", "home", "EXPENSE"],
    ["Alimentación", "#10b981", "shopping-cart", "EXPENSE"],
    ["Transporte", "#f59e0b", "car", "EXPENSE"],
    ["Ocio", "#ec4899", "smile", "EXPENSE"],
    ["Salud", "#ef4444", "heart", "EXPENSE"],
    ["Suscripciones", "#8b5cf6", "repeat", "EXPENSE"],
    ["Nómina", "#14b8a6", "briefcase", "INCOME"],
    ["Otros ingresos", "#3b82f6", "plus", "INCOME"],
  ])
    await prisma.category.create({ data: { userId, name, color, icon, type } });
  const categories = await prisma.category.findMany({ where: { userId } });
  for (const [keyword, name] of [
    ["MERCADONA", "Alimentación"],
    ["LIDL", "Alimentación"],
    ["ALQUILER", "Vivienda"],
    ["NETFLIX", "Suscripciones"],
    ["NÓMINA", "Nómina"],
    ["UBER", "Transporte"],
  ])
    await prisma.rule.create({
      data: {
        userId,
        keyword,
        categoryId: categories.find((c) => c.name === name)!.id,
      },
    });
}
export function newKey() {
  return "fin_" + randomBytes(32).toString("hex");
}
