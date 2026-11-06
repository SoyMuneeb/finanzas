/** All money values are integer euro cents. Date ranges include both endpoints. */
export type BudgetPeriod = "MONTHLY" | "YEARLY";
export type BudgetStatus = "ok" | "warning" | "exceeded";

function requireInteger(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(
      `${name} debe ser un entero seguro mayor o igual que ${minimum}`,
    );
  }
}

export function budgetPeriod(
  period: BudgetPeriod,
  year: number,
  month?: number,
): { from: string; to: string } {
  requireInteger(year, "El año", 1);
  if (year > 9999)
    throw new RangeError("El año debe ser menor o igual que 9999");
  if (period !== "MONTHLY" && period !== "YEARLY")
    throw new RangeError("Periodo no válido");
  if (
    month !== undefined &&
    (!Number.isInteger(month) || month < 1 || month > 12)
  ) {
    throw new RangeError("El mes debe estar entre 1 y 12");
  }
  const yyyy = String(year).padStart(4, "0");
  if (period === "YEARLY")
    return { from: `${yyyy}-01-01`, to: `${yyyy}-12-31` };
  if (month === undefined)
    throw new RangeError("El presupuesto mensual necesita un mes");
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const prefix = `${yyyy}-${String(month).padStart(2, "0")}`;
  return { from: `${prefix}-01`, to: `${prefix}-${days[month - 1]}` };
}

export function budgetProgress(
  limitCents: number,
  spentCents: number,
): { percent: number; status: BudgetStatus; remainingCents: number } {
  requireInteger(limitCents, "El límite", 1);
  requireInteger(spentCents, "El gasto", 0);
  const percent = (spentCents / limitCents) * 100;
  return {
    percent,
    // Compare amounts, not rounded display percentages, at the warning boundaries.
    status:
      spentCents >= limitCents
        ? "exceeded"
        : spentCents / limitCents >= 0.8
          ? "warning"
          : "ok",
    remainingCents: limitCents - spentCents,
  };
}

export interface BudgetMovement {
  date: string;
  type: "INCOME" | "EXPENSE";
  amountCents: number;
  categoryId?: string | null;
}

/** Pass no category for a global budget. ISO dates/UTC timestamps are supported. */
export function budgetSpent(
  movements: readonly BudgetMovement[],
  range: { from: string; to: string },
  categoryId?: string | null,
): number {
  return movements.reduce((total, movement) => {
    const date = movement.date.slice(0, 10);
    if (
      movement.type !== "EXPENSE" ||
      date < range.from ||
      date > range.to ||
      (categoryId != null && movement.categoryId !== categoryId)
    )
      return total;
    requireInteger(movement.amountCents, "El importe", 0);
    const next = total + movement.amountCents;
    if (!Number.isSafeInteger(next))
      throw new RangeError("El gasto acumulado supera el rango seguro");
    return next;
  }, 0);
}
