import { z } from "zod";
import type { ParsedMovement } from "./parser.js";

export class ApiError extends Error {
  constructor(public status: number) {
    super(
      status === 401 || status === 403
        ? "La clave de integración no es válida o ha sido revocada."
        : `La API respondió con estado ${status}.`,
    );
  }
}

export function createApi(baseUrl: string, apiKey: string) {
  const base = new URL(baseUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error(
      "FINANZAS_API_URL debe ser el origen, sin credenciales, rutas ni parámetros.",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && local))
    throw new Error("Usa HTTPS para una API remota.");
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(new URL(path, base), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        ...init?.headers,
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok) throw new ApiError(response.status);
    return response.json();
  }
  return {
    addMovement: (movement: ParsedMovement) =>
      request("/api/integrations/telegram/movements", {
        method: "POST",
        body: JSON.stringify(movement),
      }),
    summary: () => request("/api/integrations/telegram/summary"),
  };
}

const cents = z.number().finite();
export function summaryText(value: unknown): string {
  const outer = z.record(z.string(), z.unknown()).parse(value);
  const source = (outer.summary ?? outer.totals ?? outer) as Record<
    string,
    unknown
  >;
  const totals = z
    .object({
      incomeCents: cents,
      expenseCents: cents,
      balanceCents: cents,
    })
    .parse({
      incomeCents: source.incomeCents ?? source.income,
      expenseCents:
        source.expenseCents ?? source.expensesCents ?? source.expenses,
      balanceCents: source.balanceCents ?? source.balance,
    });
  const money = (n: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
    }).format(n / 100);
  return `Este mes\nIngresos: ${money(totals.incomeCents)}\nGastos: ${money(totals.expenseCents)}\nBalance: ${money(totals.balanceCents)}`;
}
