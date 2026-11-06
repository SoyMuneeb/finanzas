import "dotenv/config";
import { defineConfig } from "prisma/config";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ||= "file:./dev.db";
const configured = process.env.DATABASE_URL;
// Keep relative SQLite URLs anchored to the schema directory for CLI and runtime.
const url = configured.startsWith("file:")
  ? `file:${resolve(dirname(fileURLToPath(import.meta.url)), "prisma", configured.slice(5))}`
  : configured;

export default defineConfig({
  schema: "prisma/schema.prisma",
  experimental: { adapter: true },
  engine: "js",
  adapter: async () => new PrismaLibSQL({ url }),
});
