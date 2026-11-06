import { describe, expect, it } from "vitest";
import { budgetPeriod, budgetProgress, budgetSpent } from "./budget.js";

describe("budgetPeriod", () => {
  it("returns an inclusive monthly range and handles leap years", () => {
    expect(budgetPeriod("MONTHLY", 2024, 2)).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(budgetPeriod("MONTHLY", 2025, 2).to).toBe("2025-02-28");
    expect(budgetPeriod("MONTHLY", 1900, 2).to).toBe("1900-02-28");
    expect(budgetPeriod("MONTHLY", 2000, 2).to).toBe("2000-02-29");
    expect(budgetPeriod("MONTHLY", 2026, 12)).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("returns the full calendar year", () => {
    expect(budgetPeriod("YEARLY", 2026)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(budgetPeriod("MONTHLY", 1, 1).from).toBe("0001-01-01");
  });

  it("rejects impossible periods instead of silently normalizing dates", () => {
    expect(() => budgetPeriod("MONTHLY", 2026)).toThrow();
    for (const month of [0, 13, 1.5, NaN])
      expect(() => budgetPeriod("MONTHLY", 2026, month)).toThrow();
    for (const year of [0, 10000, 2026.5, Infinity])
      expect(() => budgetPeriod("YEARLY", year)).toThrow();
    expect(() => budgetPeriod("DAILY" as "MONTHLY", 2026, 1)).toThrow();
  });
});

describe("budgetProgress", () => {
  it("changes alerts exactly at 80% and 100%", () => {
    expect(budgetProgress(10000, 7999).status).toBe("ok");
    expect(budgetProgress(10000, 8000)).toEqual({
      percent: 80,
      status: "warning",
      remainingCents: 2000,
    });
    expect(budgetProgress(10000, 9999).status).toBe("warning");
    expect(budgetProgress(10000, 10000)).toEqual({
      percent: 100,
      status: "exceeded",
      remainingCents: 0,
    });
    expect(budgetProgress(10000, 12500)).toEqual({
      percent: 125,
      status: "exceeded",
      remainingCents: -2500,
    });
  });

  it("handles zero spending and rejects invalid money", () => {
    expect(budgetProgress(100, 0)).toEqual({
      percent: 0,
      status: "ok",
      remainingCents: 100,
    });
    for (const limit of [0, -1, 1.5, Infinity])
      expect(() => budgetProgress(limit, 0)).toThrow();
    for (const spent of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => budgetProgress(100, spent)).toThrow();
  });
});

describe("budgetSpent", () => {
  const movements = [
    {
      date: "2026-01-31",
      type: "EXPENSE" as const,
      amountCents: 500,
      categoryId: "food",
    },
    {
      date: "2026-02-01T00:00:00.000Z",
      type: "EXPENSE" as const,
      amountCents: 1000,
      categoryId: "food",
    },
    {
      date: "2026-02-28T23:59:59.999Z",
      type: "EXPENSE" as const,
      amountCents: 2000,
      categoryId: "rent",
    },
    {
      date: "2026-02-12",
      type: "INCOME" as const,
      amountCents: 100000,
      categoryId: "food",
    },
    {
      date: "2026-03-01",
      type: "EXPENSE" as const,
      amountCents: 9999,
      categoryId: "food",
    },
  ];
  const range = budgetPeriod("MONTHLY", 2026, 2);

  it("counts only expenses inside the inclusive range for a global budget", () => {
    expect(budgetSpent(movements, range)).toBe(3000);
  });

  it("restricts category budgets and returns zero for no matching expenses", () => {
    expect(budgetSpent(movements, range, "food")).toBe(1000);
    expect(budgetSpent(movements, range, "other")).toBe(0);
    expect(budgetSpent([], range)).toBe(0);
  });

  it("rejects corrupt or overflowing matching amounts", () => {
    expect(() =>
      budgetSpent(
        [{ date: "2026-02-01", type: "EXPENSE", amountCents: -1 }],
        range,
      ),
    ).toThrow();
    expect(() =>
      budgetSpent(
        [
          {
            date: "2026-02-01",
            type: "EXPENSE",
            amountCents: Number.MAX_SAFE_INTEGER,
          },
          { date: "2026-02-02", type: "EXPENSE", amountCents: 1 },
        ],
        range,
      ),
    ).toThrow();
  });
});
