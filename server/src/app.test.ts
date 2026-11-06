import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import { advanceDate } from "./recurrence.js";

let app: Express;
let prisma: PrismaClient;
let token: string;
let otherToken: string;
let userId: string;
let otherId: string;
let accountId: string;
let otherAccountId: string;
let categoryId: string;
let otherCategoryId: string;
const temporary = mkdtempSync(join(tmpdir(), "finanzas-api-test-"));
const password = "test-password-12345";
const today = new Date().toISOString().slice(0, 10);
const auth = () => ({ Authorization: `Bearer ${token}` });
const otherAuth = () => ({ Authorization: `Bearer ${otherToken}` });
const movement = (overrides: Record<string, unknown> = {}) => ({
  date: today,
  concept: "Compra de prueba",
  amount: 10,
  type: "EXPENSE",
  accountId,
  categoryId,
  notes: "",
  ...overrides,
});

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${join(temporary, "test.db")}`;
  process.env.JWT_SECRET =
    "api-tests-use-an-isolated-secret-of-more-than-32-characters";
  process.env.NODE_ENV = "test";
  process.env.ALLOW_REGISTRATION = "true";
  execFileSync("npm", ["run", "db:migrate", "-w", "server"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, npm_config_cache: "/tmp/finanzas-npm-cache" },
    stdio: "pipe",
    timeout: 60_000,
  });
  ({ app } = await import("./app.js"));
  const core = await import("./core.js");
  prisma = core.prisma;
  const registered = await request(app)
    .post("/api/auth/register")
    .send({ email: "owner@example.com", password });
  expect(registered.status).toBe(201);
  token = registered.body.token as string;
  userId = registered.body.user.id as string;
  const second = await prisma.user.create({
    data: { email: "second@example.com", passwordHash: "not-used-for-login" },
  });
  otherId = second.id;
  await core.defaults(otherId);
  otherToken = jwt.sign({ sub: otherId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}, 90_000);

beforeEach(async () => {
  await prisma.movement.deleteMany();
  await prisma.recurrence.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.apiKey.deleteMany();
  accountId = (await prisma.account.findFirstOrThrow({ where: { userId } })).id;
  otherAccountId = (
    await prisma.account.findFirstOrThrow({ where: { userId: otherId } })
  ).id;
  categoryId = (
    await prisma.category.findFirstOrThrow({
      where: { userId, name: "Alimentación" },
    })
  ).id;
  otherCategoryId = (
    await prisma.category.findFirstOrThrow({
      where: { userId: otherId, name: "Alimentación" },
    })
  ).id;
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
  rmSync(temporary, { recursive: true, force: true });
});

describe("authentication and user boundaries", () => {
  it("checks credentials, denies unauthenticated requests, and closes registration after the first user", async () => {
    expect((await request(app).get("/api/movements")).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/movements")
          .set("Authorization", "Bearer invalid")
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "owner@example.com", password: "incorrect-password" })
      ).status,
    ).toBe(401);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "owner@example.com", password });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe("owner@example.com");
    expect(typeof login.body.token).toBe("string");
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .send({ email: "third@example.com", password })
      ).status,
    ).toBe(403);
  });

  it("isolates reads, writes, and bulk deletions between users", async () => {
    const created = await request(app)
      .post("/api/movements")
      .set(otherAuth())
      .send(
        movement({ accountId: otherAccountId, categoryId: otherCategoryId }),
      );
    expect(created.status).toBe(201);
    expect(
      (await request(app).get("/api/movements").set(auth())).body.total,
    ).toBe(0);
    expect(
      (
        await request(app)
          .put(`/api/movements/${created.body.id}`)
          .set(auth())
          .send(movement())
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/api/movements/${created.body.id}`)
          .set(auth())
      ).status,
    ).toBe(404);
    await request(app)
      .post("/api/movements/bulk-delete")
      .set(auth())
      .send({ ids: [created.body.id] })
      .expect(200);
    expect(await prisma.movement.count({ where: { userId: otherId } })).toBe(1);
    expect(
      (
        await request(app)
          .post("/api/movements")
          .set(auth())
          .send(movement({ accountId: otherAccountId }))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/movements")
          .set(auth())
          .send(movement({ categoryId: otherCategoryId }))
      ).status,
    ).toBe(400);
  });
});

describe("movements and reporting", () => {
  it("validates calendar dates, money, concepts and supports edit, search, sorting and deletion", async () => {
    for (const overrides of [
      { date: "2026-02-30" },
      { amount: 1.234 },
      { amount: -2 },
      { concept: "   " },
      { type: "TRANSFER" },
    ]) {
      expect(
        (
          await request(app)
            .post("/api/movements")
            .set(auth())
            .send(movement(overrides))
        ).status,
      ).toBe(400);
    }
    const first = await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 2.5, concept: "Café especial" }))
      .expect(201);
    expect(first.body.amountCents).toBe(250);
    expect(first.body.source).toBe("MANUAL");
    const second = await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 19 }))
      .expect(201);
    const sorted = await request(app)
      .get("/api/movements?pageSize=1&sort=amountCents&order=desc")
      .set(auth())
      .expect(200);
    expect(sorted.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(sorted.body.items[0].id).toBe(second.body.id);
    expect(
      (await request(app).get("/api/movements?search=Caf%C3%A9").set(auth()))
        .body.total,
    ).toBe(1);
    const edited = await request(app)
      .put(`/api/movements/${first.body.id}`)
      .set(auth())
      .send(movement({ amount: 3.75, notes: "Corregido" }))
      .expect(200);
    expect(edited.body).toMatchObject({ amountCents: 375, notes: "Corregido" });
    await request(app)
      .delete(`/api/movements/${first.body.id}`)
      .set(auth())
      .expect(200);
    await request(app)
      .post("/api/movements/bulk-delete")
      .set(auth())
      .send({ ids: [second.body.id] })
      .expect(200);
    expect(
      (await request(app).get("/api/movements").set(auth())).body.total,
    ).toBe(0);
  });

  it("applies keyword rules and returns exact dashboard totals with filters", async () => {
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(
        movement({
          amount: 12.35,
          concept: "MERCADONA local",
          categoryId: undefined,
        }),
      )
      .expect(201);
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 100, type: "INCOME", concept: "Ingreso" }))
      .expect(201);
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 45, date: "2020-01-01" }))
      .expect(201);
    const result = await request(app)
      .get(`/api/dashboard?from=${today}&to=${today}&accountId=${accountId}`)
      .set(auth())
      .expect(200);
    expect(result.body).toMatchObject({
      incomeCents: 10000,
      expenseCents: 1235,
      balanceCents: 8765,
    });
    expect(result.body.monthly).toHaveLength(1);
    expect(result.body.categories).toEqual([
      expect.objectContaining({ name: "Alimentación", amountCents: 1235 }),
    ]);
    const items = (
      await request(app).get("/api/movements?search=MERCADONA").set(auth())
    ).body.items;
    expect(items[0].categoryId).toBe(categoryId);
  });
});

describe("budgets", () => {
  it("compares real monthly/category spending and copies a month without duplicates", async () => {
    const [year, month] = today.split("-").map(Number);
    const created = await request(app)
      .post("/api/budgets")
      .set(auth())
      .send({ period: "MONTHLY", year, month, amount: 100, categoryId })
      .expect(200);
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 80 }))
      .expect(201);
    let budgets = await request(app)
      .get(`/api/budgets?year=${year}&month=${month}`)
      .set(auth())
      .expect(200);
    expect(budgets.body[0]).toMatchObject({
      id: created.body.id,
      spentCents: 8000,
      percent: 80,
      status: "warning",
    });
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 21 }))
      .expect(201);
    budgets = await request(app)
      .get(`/api/budgets?year=${year}&month=${month}`)
      .set(auth());
    expect(budgets.body[0]).toMatchObject({
      spentCents: 10100,
      status: "exceeded",
      remainingCents: -100,
    });
    const fromMonth = today.slice(0, 7);
    const toMonth =
      month === 12
        ? `${year + 1}-01`
        : `${year}-${String(month + 1).padStart(2, "0")}`;
    expect(
      (
        await request(app)
          .post("/api/budgets/copy")
          .set(auth())
          .send({ fromMonth, toMonth })
      ).body.copied,
    ).toBe(1);
    expect(
      (
        await request(app)
          .post("/api/budgets/copy")
          .set(auth())
          .send({ fromMonth, toMonth })
      ).body.copied,
    ).toBe(0);
    expect(
      (
        await request(app)
          .post("/api/budgets")
          .set(auth())
          .send({ period: "MONTHLY", year, amount: 100 })
      ).status,
    ).toBe(400);
  });
});

describe("Telegram integration", () => {
  it("accepts one or a batch, marks review, permits review completion, and revokes keys immediately", async () => {
    const generated = await request(app)
      .post("/api/integrations/keys")
      .set(auth())
      .send({ name: "Bot de prueba" })
      .expect(201);
    const key = generated.body.key as string;
    expect(
      (await request(app).get("/api/integrations/keys").set(auth())).body[0],
    ).not.toHaveProperty("key");
    expect(
      (
        await request(app)
          .post("/api/integrations/telegram/movements")
          .send({ concept: "Café", amount: 2.5, type: "EXPENSE" })
      ).status,
    ).toBe(401);
    const created = await request(app)
      .post("/api/integrations/telegram/movements")
      .set("X-API-Key", key)
      .send({
        concept: "Café",
        amount: 2.5,
        type: "EXPENSE",
        account: accountId,
      })
      .expect(201);
    const item = created.body.items[0];
    expect(item).toMatchObject({
      source: "TELEGRAM",
      reviewPending: true,
      amountCents: 250,
    });
    const review = await request(app)
      .get("/api/movements?reviewPending=true")
      .set(auth())
      .expect(200);
    expect(review.body.total).toBe(1);
    await request(app)
      .put(`/api/movements/${item.id}`)
      .set(auth())
      .send(movement({ concept: "Café", amount: 2.5, reviewPending: false }))
      .expect(200);
    expect(
      (await request(app).get("/api/movements?reviewPending=true").set(auth()))
        .body.total,
    ).toBe(0);
    await request(app)
      .post("/api/integrations/telegram/movements")
      .set("X-API-Key", key)
      .send([
        { concept: "MERCADONA", amount: 5, type: "EXPENSE" },
        { concept: "Nómina", amount: 100, type: "INCOME" },
      ])
      .expect(201);
    expect(
      (
        await request(app)
          .get(`/api/integrations/telegram/summary?from=${today}&to=${today}`)
          .set("X-API-Key", key)
      ).body,
    ).toMatchObject({ expenseCents: 750, incomeCents: 10000 });
    await request(app)
      .delete(`/api/integrations/keys/${generated.body.id}`)
      .set(auth())
      .expect(200);
    expect(
      (
        await request(app)
          .get("/api/integrations/telegram/summary")
          .set("X-API-Key", key)
      ).status,
    ).toBe(401);
  });

  it("defaults Telegram summary to the current month and rejects an invalid batch atomically", async () => {
    const generated = await request(app)
      .post("/api/integrations/keys")
      .set(auth())
      .send({ name: "Resumen" })
      .expect(201);
    const key = generated.body.key as string;
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 50, date: "2020-01-01" }))
      .expect(201);
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 2.5 }))
      .expect(201);
    const summary = await request(app)
      .get("/api/integrations/telegram/summary")
      .set("X-API-Key", key)
      .expect(200);
    expect(summary.body.expenseCents).toBe(250);
    const invalid = await request(app)
      .post("/api/integrations/telegram/movements")
      .set("X-API-Key", key)
      .send([
        { concept: "Válido", amount: 5, type: "EXPENSE" },
        {
          concept: "Inválido",
          amount: 2,
          type: "EXPENSE",
          account: otherAccountId,
        },
      ]);
    expect(invalid.status).toBe(400);
    expect(await prisma.movement.count({ where: { userId } })).toBe(2);
  });
});

describe("import, export and backup", () => {
  it("returns actionable client errors for missing, unsupported and malformed import inputs", async () => {
    await request(app)
      .post("/api/import/preview")
      .set(auth())
      .field("accountId", accountId)
      .expect(400);
    await request(app)
      .post("/api/import/preview")
      .set(auth())
      .field("accountId", accountId)
      .attach("file", Buffer.from("not a statement"), "statement.pdf")
      .expect(400);
    await request(app)
      .post("/api/import/preview")
      .set(auth())
      .field("accountId", accountId)
      .field("mapping", "{invalid")
      .attach(
        "file",
        Buffer.from("Fecha;Concepto;Importe\n06/11/2026;Café;-2,50"),
        "statement.csv",
      )
      .expect(400);
  });

  it("previews duplicate hashes and category rules, skips duplicates and permits explicit reimport", async () => {
    const csv = Buffer.from(
      "Fecha;Concepto;Importe\n06/11/2026;MERCADONA;-12,50\n06/11/2026;MERCADONA;-12,50\n",
    );
    const preview = await request(app)
      .post("/api/import/preview")
      .set(auth())
      .field("accountId", accountId)
      .field("profile", "generic")
      .attach("file", csv, "extracto.csv")
      .expect(200);
    expect(preview.body.errors).toEqual([]);
    expect(
      preview.body.rows.map((r: { duplicate: boolean }) => r.duplicate),
    ).toEqual([false, true]);
    expect(preview.body.rows[0]).toMatchObject({
      amount: 12.5,
      type: "EXPENSE",
      categoryId,
    });
    const payload = {
      rows: preview.body.rows,
      accountId,
      skipDuplicates: true,
    };
    expect(
      (await request(app).post("/api/import/confirm").set(auth()).send(payload))
        .body,
    ).toEqual({ imported: 1, skipped: 1 });
    expect(
      (await request(app).post("/api/import/confirm").set(auth()).send(payload))
        .body,
    ).toEqual({ imported: 0, skipped: 2 });
    expect(
      (
        await request(app)
          .post("/api/import/confirm")
          .set(auth())
          .send({ ...payload, skipDuplicates: false })
      ).body,
    ).toEqual({ imported: 2, skipped: 0 });
    expect(
      await prisma.movement.count({ where: { userId, source: "IMPORT" } }),
    ).toBe(3);
  });

  it("exports filtered CSV/XLSX and neutralizes spreadsheet formula injection", async () => {
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ concept: '=HYPERLINK("https://example.com")' }))
      .expect(201);
    const csv = await request(app)
      .get(`/api/export?format=csv&from=${today}&to=${today}`)
      .set(auth())
      .expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("'=HYPERLINK");
    expect(csv.text).toContain('"-10,00"');
    const xlsx = await request(app)
      .get("/api/export?format=xlsx")
      .set(auth())
      .expect(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(Number(xlsx.headers["content-length"])).toBeGreaterThan(1000);
  });

  it("round-trips a complete JSON backup with remapped IDs and rejects invalid references without deleting data", async () => {
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 9.95 }))
      .expect(201);
    const backup = (
      await request(app).get("/api/backup").set(auth()).expect(200)
    ).body;
    expect(backup).not.toHaveProperty("apiKeys");
    expect(backup.movements[0]).not.toHaveProperty("userId");
    const invalid = structuredClone(backup);
    invalid.movements[0].accountId = "missing-account";
    await request(app)
      .post("/api/backup")
      .set(auth())
      .send(invalid)
      .expect(400);
    expect(await prisma.movement.count({ where: { userId } })).toBe(1);
    const oldId = backup.movements[0].id;
    const oldAccount = backup.accounts[0].id;
    await request(app).post("/api/backup").set(auth()).send(backup).expect(200);
    const restored = await prisma.movement.findFirstOrThrow({
      where: { userId },
    });
    expect(restored.id).not.toBe(oldId);
    expect(restored.accountId).not.toBe(oldAccount);
    expect(restored).toMatchObject({
      amountCents: 995,
      concept: "Compra de prueba",
    });
    expect(await prisma.account.count({ where: { userId: otherId } })).toBe(1);
  });

  it("rolls back every deletion if a database constraint fails during restoration", async () => {
    await request(app)
      .post("/api/movements")
      .set(auth())
      .send(movement({ amount: 3 }))
      .expect(201);
    const backup = (
      await request(app).get("/api/backup").set(auth()).expect(200)
    ).body;
    backup.accounts.push({
      ...backup.accounts[0],
      id: "different-id-same-name",
    });
    const original = await prisma.movement.findFirstOrThrow({
      where: { userId },
    });
    const failed = await request(app)
      .post("/api/backup")
      .set(auth())
      .send(backup);
    expect(failed.status).toBe(409);
    expect(
      await prisma.movement.findUnique({ where: { id: original.id } }),
    ).not.toBeNull();
    expect(await prisma.account.count({ where: { userId } })).toBe(1);
  });
});

describe("recurring movements", () => {
  it("generates due occurrences once and preserves end-of-month anchors", async () => {
    await request(app)
      .post("/api/recurrences")
      .set(auth())
      .send({
        concept: "Suscripción",
        amount: 4.99,
        type: "EXPENSE",
        accountId,
        categoryId,
        frequency: "MONTHLY",
        nextDate: today,
      })
      .expect(200);
    expect(
      (await request(app).post("/api/recurrences/run").set(auth())).body
        .generated,
    ).toBe(1);
    expect(
      (await request(app).post("/api/recurrences/run").set(auth())).body
        .generated,
    ).toBe(0);
    expect(await prisma.movement.count({ where: { userId } })).toBe(1);
    expect(advanceDate("2024-01-31", "MONTHLY", 31)).toBe("2024-02-29");
    expect(advanceDate("2024-02-29", "MONTHLY", 31)).toBe("2024-03-31");
    expect(advanceDate("2024-02-29", "YEARLY", 29)).toBe("2025-02-28");
    expect(advanceDate("2026-12-28", "WEEKLY", 28)).toBe("2027-01-04");
  });
});
