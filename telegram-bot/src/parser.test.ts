import { describe, expect, it } from "vitest";
import { localDate, movementSchema, parseMovement } from "./parser.js";
import { createApi, summaryText } from "./api.js";

const now = new Date("2026-11-06T12:00:00Z");
describe("parser de mensajes", () => {
  it("interpreta un gasto en español", () => {
    expect(parseMovement("café 2,50", now)).toEqual({
      date: "2026-11-06",
      concept: "café",
      amount: 2.5,
      type: "EXPENSE",
    });
  });
  it("interpreta ingresos y separador de miles", () => {
    expect(parseMovement("nómina 1.800,25 ingreso", now)).toMatchObject({
      concept: "nómina",
      amount: 1800.25,
      type: "INCOME",
    });
    expect(parseMovement("bonus 1.800 ingreso", now).amount).toBe(1800);
  });
  it("acepta fechas explícitas españolas e ISO y decimal punto", () => {
    expect(parseMovement("compra 25.90 5/11/2026", now)).toMatchObject({
      date: "2026-11-05",
      amount: 25.9,
    });
    expect(parseMovement("2026-11-01 cine 12 €", now).date).toBe("2026-11-01");
  });
  it("acepta ayer y calcula el día en Madrid", () => {
    expect(parseMovement("café 2,50 ayer", now).date).toBe("2026-11-05");
    expect(localDate(new Date("2026-11-06T23:30:00Z"))).toBe("2026-11-07");
    expect(
      parseMovement("café 2 ayer", new Date("2026-03-01T12:00:00Z")).date,
    ).toBe("2026-02-28");
  });
  it("normaliza importes negativos como gastos positivos", () => {
    expect(parseMovement("comida -15,20", now)).toMatchObject({
      amount: 15.2,
      type: "EXPENSE",
    });
  });
  it.each([
    "café",
    "2,50",
    "café 0",
    "café 2,505",
    "café 1,2,3",
    "compra 1.23,40",
    "café 2,50 comida 4",
    "café 2 31/02/2026",
    "café 2 2025-02-29",
    "café 2 hoy ayer",
    "café 2 hoy 2026-11-06",
    "café 2 ingreso gasto",
    "café -2 ingreso",
    "café $2",
    "café 2 USD",
    "café 1000000000",
  ])("rechaza mensajes ambiguos o inválidos: %s", (text) => {
    expect(() => parseMovement(text, now)).toThrow();
  });
  it("el esquema también valida fechas y precisión de un agente", () => {
    expect(
      movementSchema.safeParse({
        date: "2026-02-30",
        concept: "a",
        amount: 2,
        type: "EXPENSE",
      }).success,
    ).toBe(false);
    expect(
      movementSchema.safeParse({
        date: "2026-02-20",
        concept: "a",
        amount: 2.001,
        type: "EXPENSE",
      }).success,
    ).toBe(false);
  });
});

describe("cliente de integración", () => {
  it("impide enviar claves por HTTP a servidores remotos o URLs con credenciales", () => {
    expect(() => createApi("http://example.com", "test")).toThrow();
    expect(() =>
      createApi("https://user:password@example.com", "test"),
    ).toThrow();
    expect(() => createApi("https://example.com/path", "test")).toThrow();
    expect(() => createApi("https://example.com", "test")).not.toThrow();
    expect(() => createApi("http://127.0.0.1:3001", "test")).not.toThrow();
  });
  it("formatea resumen en euros a partir de céntimos", () => {
    const text = summaryText({
      summary: {
        incomeCents: 100_000,
        expenseCents: 25_000,
        balanceCents: 75_000,
      },
    });
    expect(text).toContain("Ingresos:");
    expect(text).toContain("250,00");
    expect(text).toContain("750,00");
  });
});
