import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import {
  prisma,
  jwtSecret,
  defaults,
  movementSchema,
  moneySchema,
  typeSchema,
  dateSchema,
  cents,
  newKey,
} from "./core.js";
import { budgetPeriod, budgetProgress } from "./budget.js";
import {
  parseStatement,
  movementHash,
  autoCategory,
  profiles,
} from "./importer.js";
import { advanceDate } from "./recurrence.js";

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}
export const app = express();
app.disable("x-powered-by");
app.use(helmet());
const origins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",");
app.use(
  cors({
    origin: origins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  }),
);
app.use(express.json({ limit: "12mb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const credentials = z.object({
  email: z
    .email()
    .max(200)
    .transform((s) => s.toLowerCase()),
  password: z
    .string()
    .min(12)
    .max(72)
    .refine((s) => Buffer.byteLength(s, "utf8") <= 72, "Máximo 72 bytes UTF-8"),
});
app.get("/api/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok" });
});
app.post("/api/auth/register", authLimit, async (req, res) => {
  const data = credentials.parse(req.body);
  if (process.env.ALLOW_REGISTRATION !== "true")
    fail("Registro deshabilitado", 403);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    if (await tx.user.count())
      fail("Ya existe un usuario. Registro cerrado.", 403);
    return tx.user.create({ data: { email: data.email, passwordHash } });
  });
  await defaults(user.id);
  res
    .status(201)
    .json({
      token: jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: "12h" }),
      user: { id: user.id, email: user.email },
    });
});
app.post("/api/auth/login", authLimit, async (req, res) => {
  const data = credentials.parse(req.body),
    user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash)))
    fail("Credenciales incorrectas", 401);
  res.json({
    token: jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: "12h" }),
    user: { id: user.id, email: user.email },
  });
});
async function session(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!token) fail("Inicia sesión", 401);
    const data = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
    if (typeof data === "string" || !data.sub) fail("Sesión inválida", 401);
    req.userId = data.sub;
    if (!(await prisma.user.findUnique({ where: { id: req.userId } })))
      fail("Sesión inválida", 401);
    next();
  } catch {
    next(
      Object.assign(new Error("Sesión inválida o caducada"), { status: 401 }),
    );
  }
}
async function apiKey(req: Request, _res: Response, next: NextFunction) {
  try {
    const key = req.header("x-api-key");
    if (!key) fail("API key requerida", 401);
    const item = await prisma.apiKey.findUnique({
      where: { keyHash: hash(key) },
    });
    if (!item) fail("API key inválida", 401);
    req.userId = item.userId;
    await prisma.apiKey.update({
      where: { id: item.id },
      data: { lastUsedAt: new Date() },
    });
    next();
  } catch (err) {
    next(err);
  }
}
async function ownership(
  userId: string,
  accountId: string,
  categoryId?: string | null,
) {
  if (!(await prisma.account.findFirst({ where: { id: accountId, userId } })))
    fail("Cuenta no válida");
  if (
    categoryId &&
    !(await prisma.category.findFirst({ where: { id: categoryId, userId } }))
  )
    fail("Categoría no válida");
}
async function movementData(userId: string, body: unknown, source = "MANUAL") {
  const data = movementSchema.parse(body);
  await ownership(userId, data.accountId, data.categoryId);
  const rules = await prisma.rule.findMany({
    where: { userId },
    orderBy: { keyword: "asc" },
  });
  const categoryId =
    data.categoryId || autoCategory(data.concept, rules) || null;
  return {
    userId,
    date: data.date,
    concept: data.concept,
    amountCents: cents(data.amount),
    type: data.type,
    accountId: data.accountId,
    categoryId,
    notes: data.notes,
    source,
    reviewPending: source === "TELEGRAM" ? true : (data.reviewPending ?? false),
    hash: movementHash(
      data.date,
      cents(data.amount),
      data.type,
      data.concept,
      data.accountId,
    ),
  };
}
function filters(
  req: Request,
  defaults: Record<string, string> = {},
): Prisma.MovementWhereInput {
  const q = z
    .object({
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      search: z.string().max(300).optional(),
      type: typeSchema.optional(),
      source: z.enum(["MANUAL", "TELEGRAM", "IMPORT"]).optional(),
      reviewPending: z.enum(["true", "false"]).optional(),
    })
    .parse({ ...defaults, ...req.query });
  return {
    userId: req.userId,
    date: { gte: q.from, lte: q.to },
    accountId: q.accountId || undefined,
    categoryId: q.categoryId || undefined,
    type: q.type,
    source: q.source,
    reviewPending:
      q.reviewPending === undefined ? undefined : q.reviewPending === "true",
    ...(q.search
      ? {
          OR: [
            { concept: { contains: q.search } },
            { notes: { contains: q.search } },
          ],
        }
      : {}),
  };
}
async function summary(req: Request, currentMonth = false) {
  const now = new Date(),
    monthFrom = now.toISOString().slice(0, 7) + "-01",
    monthTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
  const where = filters(
      req,
      currentMonth ? { from: monthFrom, to: monthTo } : {},
    ),
    items = await prisma.movement.findMany({
      where,
      include: { category: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
  let incomeCents = 0,
    expenseCents = 0,
    running = 0;
  const monthly = new Map<
      string,
      { month: string; incomeCents: number; expenseCents: number }
    >(),
    cats = new Map<
      string,
      { name: string; color: string; amountCents: number }
    >(),
    balance = new Map<string, number>();
  // Opening balances and all earlier transactions establish the accumulated balance.
  const accounts = await prisma.account.findMany({
    where: {
      userId: req.userId,
      ...(where.accountId ? { id: where.accountId as string } : {}),
    },
  });
  running = accounts.reduce((n, a) => n + a.initialBalanceCents, 0);
  const from = (where.date as Prisma.StringFilter)?.gte;
  if (typeof from === "string") {
    const previous = await prisma.movement.findMany({
      where: { ...where, date: { lt: from } },
    });
    running += previous.reduce(
      (n, m) => n + (m.type === "INCOME" ? m.amountCents : -m.amountCents),
      0,
    );
  }
  for (const m of items) {
    const month = m.date.slice(0, 7),
      bucket = monthly.get(month) || { month, incomeCents: 0, expenseCents: 0 };
    if (m.type === "INCOME") {
      incomeCents += m.amountCents;
      bucket.incomeCents += m.amountCents;
      running += m.amountCents;
    } else {
      expenseCents += m.amountCents;
      bucket.expenseCents += m.amountCents;
      running -= m.amountCents;
      const name = m.category?.name || "Sin categorizar",
        cat = cats.get(name) || {
          name,
          color: m.category?.color || "#94a3b8",
          amountCents: 0,
        };
      cat.amountCents += m.amountCents;
      cats.set(name, cat);
    }
    monthly.set(month, bucket);
    balance.set(m.date, running);
  }
  return {
    incomeCents,
    expenseCents,
    balanceCents: incomeCents - expenseCents,
    savingsRate: incomeCents
      ? Math.round(((incomeCents - expenseCents) / incomeCents) * 1000) / 10
      : 0,
    monthly: [...monthly.values()],
    categories: [...cats.values()],
    balance: [...balance].map(([date, balanceCents]) => ({
      date,
      balanceCents,
    })),
    reviewCount: await prisma.movement.count({
      where: { userId: req.userId, reviewPending: true },
    }),
  };
}
app.post("/api/integrations/telegram/movements", apiKey, async (req, res) => {
  const batch = z
    .array(
      z.object({
        date: dateSchema.optional(),
        amount: moneySchema,
        type: typeSchema,
        concept: z.string(),
        category: z.string().optional(),
        account: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1)
    .max(200)
    .parse(Array.isArray(req.body) ? req.body : [req.body]);
  const data = [];
  for (const m of batch) {
    const account = await prisma.account.findFirst({
      where: {
        userId: req.userId,
        ...(m.account ? { OR: [{ id: m.account }, { name: m.account }] } : {}),
      },
      orderBy: { id: "asc" },
    });
    if (!account) fail("Cuenta no encontrada");
    const category = m.category
      ? await prisma.category.findFirst({
          where: {
            userId: req.userId,
            OR: [{ id: m.category }, { name: m.category }],
          },
        })
      : null;
    if (m.category && !category) fail("Categoría no encontrada");
    data.push(
      await movementData(
        req.userId,
        {
          ...m,
          date: m.date || new Date().toISOString().slice(0, 10),
          accountId: account.id,
          categoryId: category?.id,
        },
        "TELEGRAM",
      ),
    );
  }
  const items = await prisma.$transaction(
    data.map((d) =>
      prisma.movement.create({
        data: d,
        include: { category: true, account: true },
      }),
    ),
  );
  res.status(201).json({ items });
});
app.get("/api/integrations/telegram/summary", apiKey, async (req, res) => {
  res.json(await summary(req, true));
});
app.use("/api", session);
app.get("/api/auth/me", async (req, res) => {
  res.json({
    user: await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true },
    }),
  });
});
app.get("/api/dashboard", async (req, res) => res.json(await summary(req)));
app.get("/api/movements", async (req, res) => {
  const { page, pageSize, sort, order } = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      sort: z
        .enum(["date", "amountCents", "concept", "type", "createdAt"])
        .default("date"),
      order: z.enum(["asc", "desc"]).default("desc"),
    })
    .parse(req.query);
  const where = filters(req);
  const [items, total] = await prisma.$transaction([
    prisma.movement.findMany({
      where,
      include: { category: true, account: true },
      orderBy: [{ [sort]: order }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.movement.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
});
app.post("/api/movements", async (req, res) =>
  res
    .status(201)
    .json(
      await prisma.movement.create({
        data: await movementData(req.userId, req.body),
        include: { category: true, account: true },
      }),
    ),
);
app.put("/api/movements/:id", async (req, res) => {
  const existing = await prisma.movement.findFirst({
    where: { id: String(req.params.id), userId: req.userId },
  });
  if (!existing) fail("Movimiento no encontrado", 404);
  const data = await movementData(req.userId, req.body, existing.source);
  data.reviewPending = req.body.reviewPending ?? existing.reviewPending;
  res.json(
    await prisma.movement.update({
      where: { id: existing.id },
      data,
      include: { category: true, account: true },
    }),
  );
});
app.delete("/api/movements/:id", async (req, res) => {
  const result = await prisma.movement.deleteMany({
    where: { id: String(req.params.id), userId: req.userId },
  });
  if (!result.count) fail("Movimiento no encontrado", 404);
  res.json({ deleted: result.count });
});
app.post("/api/movements/bulk-delete", async (req, res) => {
  const { ids } = z
    .object({ ids: z.array(z.string()).min(1).max(500) })
    .parse(req.body);
  res.json(
    await prisma.movement.deleteMany({
      where: { id: { in: ids }, userId: req.userId },
    }),
  );
});
app.get("/api/accounts", async (req, res) =>
  res.json(
    await prisma.account.findMany({
      where: { userId: req.userId },
      orderBy: { name: "asc" },
    }),
  ),
);
const accountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  initialBalance: z.number().finite().min(-10000000).max(10000000).default(0),
});
app.post("/api/accounts", async (req, res) => {
  const d = accountSchema.parse(req.body);
  res
    .status(201)
    .json(
      await prisma.account.create({
        data: {
          userId: req.userId,
          name: d.name,
          initialBalanceCents: cents(d.initialBalance),
        },
      }),
    );
});
app.put("/api/accounts/:id", async (req, res) => {
  await ownership(req.userId, String(req.params.id));
  const d = accountSchema.parse(req.body);
  res.json(
    await prisma.account.update({
      where: { id: String(req.params.id) },
      data: { name: d.name, initialBalanceCents: cents(d.initialBalance) },
    }),
  );
});
app.delete("/api/accounts/:id", async (req, res) => {
  const id = String(req.params.id);
  await ownership(req.userId, id);
  if ((await prisma.account.count({ where: { userId: req.userId } })) <= 1)
    fail("Conserva al menos una cuenta");
  if (
    (await prisma.movement.count({ where: { accountId: id } })) ||
    (await prisma.recurrence.count({ where: { accountId: id } }))
  )
    fail("La cuenta tiene movimientos o recurrencias");
  await prisma.account.delete({ where: { id } });
  res.json({ deleted: true });
});
app.get("/api/categories", async (req, res) =>
  res.json(
    await prisma.category.findMany({
      where: { userId: req.userId },
      orderBy: { name: "asc" },
    }),
  ),
);
const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[a-f\d]{6}$/i)
    .default("#64748b"),
  icon: z.string().max(40).default("tag"),
  type: typeSchema.default("EXPENSE"),
  parentId: z.string().nullable().optional(),
});
async function validParent(
  userId: string,
  id: string | undefined,
  parentId?: string | null,
) {
  const visited = new Set<string>(id ? [id] : []);
  let current = parentId;
  while (current) {
    if (visited.has(current)) fail("Jerarquía circular");
    visited.add(current);
    const parent = await prisma.category.findFirst({
      where: { id: current, userId },
    });
    if (!parent) fail("Categoría padre no válida");
    current = parent.parentId;
  }
}
app.post("/api/categories", async (req, res) => {
  const d = categorySchema.parse(req.body);
  await validParent(req.userId, undefined, d.parentId);
  res
    .status(201)
    .json(await prisma.category.create({ data: { ...d, userId: req.userId } }));
});
app.put("/api/categories/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!(await prisma.category.findFirst({ where: { id, userId: req.userId } })))
    fail("Categoría no encontrada", 404);
  const d = categorySchema.parse(req.body);
  await validParent(req.userId, id, d.parentId);
  res.json(await prisma.category.update({ where: { id }, data: d }));
});
app.delete("/api/categories/:id", async (req, res) => {
  res.json(
    await prisma.category.deleteMany({
      where: { id: String(req.params.id), userId: req.userId },
    }),
  );
});
app.get("/api/rules", async (req, res) =>
  res.json(
    await prisma.rule.findMany({
      where: { userId: req.userId },
      include: { category: true },
      orderBy: { keyword: "asc" },
    }),
  ),
);
const ruleSchema = z.object({
  keyword: z.string().trim().min(1).max(100),
  categoryId: z.string(),
});
for (const method of ["post", "put"] as const)
  app[method](
    "/api/rules" + (method === "put" ? "/:id" : ""),
    async (req, res) => {
      const d = ruleSchema.parse(req.body);
      if (
        !(await prisma.category.findFirst({
          where: { id: d.categoryId, userId: req.userId },
        }))
      )
        fail("Categoría no válida");
      if (method === "put") {
        const found = await prisma.rule.findFirst({
          where: { id: String(req.params.id), userId: req.userId },
        });
        if (!found) fail("Regla no encontrada", 404);
        res.json(
          await prisma.rule.update({ where: { id: found.id }, data: d }),
        );
      } else
        res
          .status(201)
          .json(
            await prisma.rule.create({ data: { ...d, userId: req.userId } }),
          );
    },
  );
app.delete("/api/rules/:id", async (req, res) =>
  res.json(
    await prisma.rule.deleteMany({
      where: { id: String(req.params.id), userId: req.userId },
    }),
  ),
);
const budgetBaseSchema = z.object({
  period: z.enum(["MONTHLY", "YEARLY"]),
  year: z.number().int().min(1900).max(9999),
  month: z.number().int().min(1).max(12).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  amount: moneySchema,
});
const budgetSchema = budgetBaseSchema.refine(
  (d) => d.period !== "MONTHLY" || !!d.month,
  "Mes requerido",
);
app.get("/api/budgets", async (req, res) => {
  const q = z
    .object({
      year: z.coerce.number().int().min(1900).max(9999).optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
    })
    .parse(req.query);
  const items = await prisma.budget.findMany({
    where: {
      userId: req.userId,
      year: q.year,
      ...(q.month ? { OR: [{ month: q.month }, { period: "YEARLY" }] } : {}),
    },
    include: { category: true },
    orderBy: { year: "desc" },
  });
  const result = [];
  for (const b of items) {
    const p = budgetPeriod(
      b.period as "MONTHLY" | "YEARLY",
      b.year,
      b.month ?? undefined,
    );
    const total = await prisma.movement.aggregate({
      where: {
        userId: req.userId,
        type: "EXPENSE",
        date: { gte: p.from, lte: p.to },
        ...(b.categoryId ? { categoryId: b.categoryId } : {}),
      },
      _sum: { amountCents: true },
    });
    const spentCents = total._sum.amountCents || 0;
    result.push({
      ...b,
      spentCents,
      ...budgetProgress(b.amountCents, spentCents),
    });
  }
  res.json(result);
});
for (const method of ["post", "put"] as const)
  app[method](
    "/api/budgets" + (method === "put" ? "/:id" : ""),
    async (req, res) => {
      const d = budgetSchema.parse(req.body);
      if (
        d.categoryId &&
        !(await prisma.category.findFirst({
          where: { id: d.categoryId, userId: req.userId },
        }))
      )
        fail("Categoría no válida");
      const data = {
        userId: req.userId,
        period: d.period,
        year: d.year,
        month: d.period === "MONTHLY" ? d.month : null,
        categoryId: d.categoryId || null,
        amountCents: cents(d.amount),
      };
      const id = method === "put" ? String(req.params.id) : undefined;
      if (
        id &&
        !(await prisma.budget.findFirst({ where: { id, userId: req.userId } }))
      )
        fail("Presupuesto no encontrado", 404);
      if (
        await prisma.budget.findFirst({
          where: {
            userId: req.userId,
            period: data.period,
            year: data.year,
            month: data.month,
            categoryId: data.categoryId,
            ...(id ? { id: { not: id } } : {}),
          },
        })
      )
        fail("Ya existe un presupuesto para ese periodo y categoría");
      res.json(
        id
          ? await prisma.budget.update({ where: { id }, data })
          : await prisma.budget.create({ data }),
      );
    },
  );
app.delete("/api/budgets/:id", async (req, res) =>
  res.json(
    await prisma.budget.deleteMany({
      where: { id: String(req.params.id), userId: req.userId },
    }),
  ),
);
app.post("/api/budgets/copy", async (req, res) => {
  const d = z
    .object({
      fromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      toMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    })
    .parse(req.body);
  const [fy, fm] = d.fromMonth.split("-").map(Number),
    [year, month] = d.toMonth.split("-").map(Number);
  const source = await prisma.budget.findMany({
    where: { userId: req.userId, year: fy, month: fm, period: "MONTHLY" },
  });
  const copied = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const b of source) {
      if (
        !(await tx.budget.findFirst({
          where: {
            userId: req.userId,
            year,
            month,
            period: "MONTHLY",
            categoryId: b.categoryId,
          },
        }))
      ) {
        await tx.budget.create({
          data: {
            userId: req.userId,
            year,
            month,
            period: "MONTHLY",
            categoryId: b.categoryId,
            amountCents: b.amountCents,
          },
        });
        n++;
      }
    }
    return n;
  });
  res.json({ copied });
});
const recurrenceSchema = movementSchema
  .omit({ date: true, reviewPending: true })
  .extend({
    frequency: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]),
    nextDate: dateSchema,
    active: z.boolean().default(true),
  });
app.get("/api/recurrences", async (req, res) =>
  res.json(
    await prisma.recurrence.findMany({
      where: { userId: req.userId },
      include: { category: true, account: true },
    }),
  ),
);
for (const method of ["post", "put"] as const)
  app[method](
    "/api/recurrences" + (method === "put" ? "/:id" : ""),
    async (req, res) => {
      const d = recurrenceSchema.parse(req.body);
      await ownership(req.userId, d.accountId, d.categoryId);
      const { amount, ...fields } = d;
      const data = {
        ...fields,
        userId: req.userId,
        amountCents: cents(amount),
        anchorDay: Number(d.nextDate.slice(8, 10)),
      };
      const id = String(req.params.id || "");
      if (
        method === "put" &&
        !(await prisma.recurrence.findFirst({
          where: { id, userId: req.userId },
        }))
      )
        fail("Recurrencia no encontrada", 404);
      res.json(
        method === "put"
          ? await prisma.recurrence.update({ where: { id }, data })
          : await prisma.recurrence.create({ data }),
      );
    },
  );
app.delete("/api/recurrences/:id", async (req, res) =>
  res.json(
    await prisma.recurrence.deleteMany({
      where: { id: String(req.params.id), userId: req.userId },
    }),
  ),
);
export async function runDue(userId?: string) {
  const today = new Date().toISOString().slice(0, 10);
  let generated = 0;
  const items = await prisma.recurrence.findMany({
    where: { userId, active: true, nextDate: { lte: today } },
  });
  for (const r of items) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.recurrence.findUnique({ where: { id: r.id } });
      if (!current) return;
      let date = current.nextDate,
        n = 0;
      while (date <= today && n < 500) {
        const existing = await tx.movement.findUnique({
          where: {
            recurrenceId_occurrenceDate: {
              recurrenceId: r.id,
              occurrenceDate: date,
            },
          },
        });
        if (!existing) {
          await tx.movement.create({
            data: {
              userId: r.userId,
              date,
              concept: r.concept,
              amountCents: r.amountCents,
              type: r.type,
              categoryId: r.categoryId,
              accountId: r.accountId,
              notes: r.notes,
              hash: movementHash(
                date,
                r.amountCents,
                r.type,
                r.concept,
                r.accountId,
              ),
              recurrenceId: r.id,
              occurrenceDate: date,
            },
          });
          generated++;
        }
        date = advanceDate(date, r.frequency, r.anchorDay);
        n++;
      }
      await tx.recurrence.update({
        where: { id: r.id },
        data: { nextDate: date },
      });
    });
  }
  return generated;
}
app.post("/api/recurrences/run", async (req, res) =>
  res.json({ generated: await runDue(req.userId) }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});
app.get("/api/import/profiles", (_req, res) => res.json(profiles));
app.post("/api/import/preview", upload.single("file"), async (req, res) => {
  if (!req.file) fail("Archivo requerido");
  const accountId = z.string().min(1).parse(req.body.accountId);
  await ownership(req.userId, accountId);
  const mapping = req.body.mapping ? JSON.parse(req.body.mapping) : undefined;
  let result;
  try {
    result = await parseStatement(
      req.file.buffer,
      req.file.originalname,
      req.body.profile || "generic",
      mapping,
    );
  } catch (err) {
    fail((err as Error).message);
  }
  if (result.rows.length > 10000) fail("Máximo 10.000 filas por archivo");
  const rules = await prisma.rule.findMany({ where: { userId: req.userId } }),
    seen = new Set<string>();
  const existing = await prisma.movement.findMany({
    where: { userId: req.userId, accountId },
    select: { hash: true },
  });
  existing.forEach((m) => seen.add(m.hash));
  const rows = result.rows.map((row) => {
    const h = movementHash(
        row.date,
        cents(row.amount),
        row.type,
        row.concept,
        accountId,
      ),
      duplicate = seen.has(h);
    seen.add(h);
    return {
      ...row,
      duplicate,
      categoryId: autoCategory(row.concept, rules) || null,
    };
  });
  res.json({ ...result, rows });
});
app.post("/api/import/confirm", async (req, res) => {
  const d = z
    .object({
      accountId: z.string(),
      skipDuplicates: z.boolean().default(true),
      rows: z
        .array(
          movementSchema
            .omit({ accountId: true, reviewPending: true })
            .extend({ duplicate: z.boolean().optional() }),
        )
        .min(1)
        .max(10000),
    })
    .parse(req.body);
  await ownership(req.userId, d.accountId);
  const prepared: Awaited<ReturnType<typeof movementData>>[] = [];
  for (const row of d.rows)
    prepared.push(
      await movementData(
        req.userId,
        { ...row, accountId: d.accountId },
        "IMPORT",
      ),
    );
  const result = await prisma.$transaction(
    async (tx) => {
      let imported = 0,
        skipped = 0;
      for (const data of prepared) {
        if (
          d.skipDuplicates &&
          (await tx.movement.findFirst({
            where: { userId: req.userId, hash: data.hash },
          }))
        ) {
          skipped++;
          continue;
        }
        await tx.movement.create({ data });
        imported++;
      }
      return { imported, skipped };
    },
    { timeout: 60000 },
  );
  res.json(result);
});
app.get("/api/export", async (req, res) => {
  const format = z.enum(["csv", "xlsx"]).parse(req.query.format || "csv");
  const rows = await prisma.movement.findMany({
    where: filters(req),
    include: { category: true, account: true },
    orderBy: { date: "desc" },
  });
  const header = [
    "Fecha",
    "Concepto",
    "Importe",
    "Tipo",
    "Categoría",
    "Cuenta",
    "Notas",
    "Origen",
  ];
  // Prefix formula-like text in both formats to prevent spreadsheet formula injection.
  const safe = (s: string) => (/^[\s]*[=+@\-]/.test(s) ? "'" + s : s);
  const values = rows.map((m) => [
    m.date,
    safe(m.concept),
    (m.type === "EXPENSE" ? -m.amountCents : m.amountCents) / 100,
    m.type === "INCOME" ? "Ingreso" : "Gasto",
    safe(m.category?.name || "Sin categorizar"),
    safe(m.account.name),
    safe(m.notes),
    m.source,
  ]);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="movimientos.${format}"`,
  );
  if (format === "csv") {
    const quote = (v: unknown) => '"' + String(v).replace(/"/g, '""') + '"';
    res
      .type("text/csv")
      .send(
        "\uFEFF" +
          [
            header,
            ...values.map((r) =>
              r.map((v, i) =>
                i === 2 ? Number(v).toFixed(2).replace(".", ",") : v,
              ),
            ),
          ]
            .map((r) => r.map(quote).join(";"))
            .join("\r\n"),
      );
  } else {
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet("Movimientos");
    sheet.addRow(header);
    values.forEach((r) => sheet.addRow(r));
    sheet.getColumn(3).numFmt = "#,##0.00";
    sheet.columns.forEach((c) => (c.width = 22));
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }
});
app.get("/api/integrations/keys", async (req, res) =>
  res.json(
    await prisma.apiKey.findMany({
      where: { userId: req.userId },
      select: {
        id: true,
        name: true,
        prefix: true,
        createdAt: true,
        lastUsedAt: true,
      },
    }),
  ),
);
app.post("/api/integrations/keys", async (req, res) => {
  const { name } = z
    .object({ name: z.string().trim().min(1).max(80) })
    .parse(req.body);
  const key = newKey();
  const item = await prisma.apiKey.create({
    data: {
      userId: req.userId,
      name,
      keyHash: hash(key),
      prefix: key.slice(0, 12),
    },
  });
  res
    .status(201)
    .json({ id: item.id, name: item.name, prefix: item.prefix, key });
});
app.delete("/api/integrations/keys/:id", async (req, res) =>
  res.json(
    await prisma.apiKey.deleteMany({
      where: { id: String(req.params.id), userId: req.userId },
    }),
  ),
);
app.get("/api/backup", async (req, res) => {
  const where = { userId: req.userId };
  const [accounts, categories, rules, budgets, recurrences, movements] =
    await Promise.all([
      prisma.account.findMany({ where }),
      prisma.category.findMany({ where }),
      prisma.rule.findMany({ where }),
      prisma.budget.findMany({ where }),
      prisma.recurrence.findMany({ where }),
      prisma.movement.findMany({ where }),
    ]);
  const clean = (rows: object[]) =>
    rows.map((row) => {
      const { userId: _, ...rest } = row as { userId: string };
      return rest;
    });
  res
    .attachment("finanzas-backup.json")
    .json({
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: clean(accounts),
      categories: clean(categories),
      rules: clean(rules),
      budgets: clean(budgets),
      recurrences: clean(recurrences),
      movements: clean(movements),
    });
});
const id = z.string().min(1).max(100),
  storedMoney = z.number().int().positive().max(1000000000);
const backupSchema = z.object({
  version: z.literal(1),
  accounts: z
    .array(
      z.object({
        id,
        name: z.string().min(1).max(80),
        initialBalanceCents: z.number().int().min(-1000000000).max(1000000000),
      }),
    )
    .min(1)
    .max(100),
  categories: z.array(categorySchema.extend({ id })).max(1000),
  rules: z.array(ruleSchema.extend({ id })).max(1000),
  budgets: z
    .array(
      budgetBaseSchema
        .omit({ amount: true })
        .extend({ id, amountCents: storedMoney })
        .refine((d) => d.period !== "MONTHLY" || !!d.month, "Mes requerido"),
    )
    .max(10000),
  recurrences: z
    .array(
      recurrenceSchema
        .omit({ amount: true })
        .extend({
          id,
          amountCents: storedMoney,
          anchorDay: z.number().int().min(1).max(31),
        }),
    )
    .max(1000),
  movements: z
    .array(
      movementSchema
        .omit({ amount: true })
        .extend({
          id,
          amountCents: storedMoney,
          source: z.enum(["MANUAL", "IMPORT", "TELEGRAM"]),
          recurrenceId: id.nullable().optional(),
          occurrenceDate: dateSchema.nullable().optional(),
        }),
    )
    .max(100000),
});
app.post("/api/backup", async (req, res) => {
  const d = backupSchema.parse(req.body);
  for (const list of [
    d.accounts,
    d.categories,
    d.rules,
    d.budgets,
    d.recurrences,
    d.movements,
  ])
    if (new Set(list.map((x) => x.id)).size !== list.length)
      fail("IDs duplicados en la copia");
  const accountIds = new Set(d.accounts.map((x) => x.id)),
    categoryIds = new Set(d.categories.map((x) => x.id)),
    recurrenceIds = new Set(d.recurrences.map((x) => x.id));
  const validCategory = (value?: string | null) =>
    !value || categoryIds.has(value);
  if (
    d.categories.some((c) => !validCategory(c.parentId)) ||
    d.rules.some((r) => !categoryIds.has(r.categoryId)) ||
    d.budgets.some((b) => !validCategory(b.categoryId)) ||
    [...d.movements, ...d.recurrences].some(
      (m) => !accountIds.has(m.accountId) || !validCategory(m.categoryId),
    ) ||
    d.movements.some(
      (m) => m.recurrenceId && !recurrenceIds.has(m.recurrenceId),
    )
  )
    fail("Referencias inválidas en la copia");
  for (const c of d.categories) {
    const seen = new Set([c.id]);
    let p = c.parentId;
    while (p) {
      if (seen.has(p)) fail("Jerarquía circular en la copia");
      seen.add(p);
      p = d.categories.find((x) => x.id === p)?.parentId;
    }
  }
  const { randomUUID } = await import("node:crypto");
  const ids = new Map(
    [
      ...d.accounts,
      ...d.categories,
      ...d.rules,
      ...d.budgets,
      ...d.recurrences,
      ...d.movements,
    ].map((x) => [x.id, randomUUID()]),
  );
  const map = (value?: string | null) => (value ? ids.get(value)! : null);
  await prisma.$transaction(
    async (tx) => {
      const where = { userId: req.userId };
      await tx.movement.deleteMany({ where });
      await tx.recurrence.deleteMany({ where });
      await tx.rule.deleteMany({ where });
      await tx.budget.deleteMany({ where });
      await tx.category.deleteMany({ where });
      await tx.account.deleteMany({ where });
      for (const a of d.accounts)
        await tx.account.create({
          data: { ...a, id: map(a.id)!, userId: req.userId },
        });
      for (const c of d.categories)
        await tx.category.create({
          data: { ...c, id: map(c.id)!, userId: req.userId, parentId: null },
        });
      for (const c of d.categories)
        if (c.parentId)
          await tx.category.update({
            where: { id: map(c.id)! },
            data: { parentId: map(c.parentId) },
          });
      for (const r of d.rules)
        await tx.rule.create({
          data: {
            ...r,
            id: map(r.id)!,
            userId: req.userId,
            categoryId: map(r.categoryId)!,
          },
        });
      for (const b of d.budgets)
        await tx.budget.create({
          data: {
            ...b,
            id: map(b.id)!,
            userId: req.userId,
            categoryId: map(b.categoryId),
          },
        });
      for (const r of d.recurrences)
        await tx.recurrence.create({
          data: {
            ...r,
            id: map(r.id)!,
            userId: req.userId,
            categoryId: map(r.categoryId),
            accountId: map(r.accountId)!,
          },
        });
      for (const m of d.movements)
        await tx.movement.create({
          data: {
            ...m,
            id: map(m.id)!,
            userId: req.userId,
            accountId: map(m.accountId)!,
            categoryId: map(m.categoryId),
            recurrenceId: map(m.recurrenceId),
            hash: movementHash(
              m.date,
              m.amountCents,
              m.type,
              m.concept,
              map(m.accountId)!,
            ),
          },
        });
    },
    { timeout: 60000 },
  );
  res.json({ restored: true, movements: d.movements.length });
});
app.use((_req, _res, next) =>
  next(Object.assign(new Error("Ruta no encontrada"), { status: 404 })),
);
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res
      .status(400)
      .json({
        error: "Datos inválidos",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    res
      .status(err.code === "P2002" ? 409 : 400)
      .json({
        error:
          err.code === "P2002"
            ? "Ya existe ese registro"
            : "No se puede completar la operación con los datos relacionados",
      });
    return;
  }
  if (err instanceof multer.MulterError) {
    res
      .status(400)
      .json({ error: "Archivo demasiado grande o no válido (máx. 8 MB)" });
    return;
  }
  const error = err as Error & { status?: number };
  const status = error.status || (err instanceof SyntaxError ? 400 : 500);
  if (status >= 500) console.error(error.message);
  res
    .status(status)
    .json({
      error: status >= 500 ? "Error interno del servidor" : error.message,
    });
});
