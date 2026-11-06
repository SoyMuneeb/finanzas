import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  autoCategory,
  movementHash,
  parseAmount,
  parseDate,
  parseStatement,
} from "./importer.js";

const mapping = { date: "Fecha", concept: "Concepto", amount: "Importe" };

describe("bank money parsing", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["-1.234,56", -1234.56],
    ["2,50", 2.5],
    ["-1234.56", -1234.56],
    ["1 234,56 €", 1234.56],
    [1800, 1800],
    ["0,00", 0],
  ])("parses %s without losing cents", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "12,34,56",
    "1.23,45",
    "1,234.5.6",
    "12 euros blah",
    "Infinity",
    "1e3",
  ])("rejects malformed money %s", (input) => {
    expect(() => parseAmount(input)).toThrow();
  });
});

describe("calendar dates", () => {
  it("supports Spanish dates and ISO dates", () => {
    expect(parseDate("06/11/2026")).toBe("2026-11-06");
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
    expect(parseDate(new Date("2026-11-06T12:00:00Z"))).toBe("2026-11-06");
    expect(parseDate(59)).toBe("1900-02-28");
    expect(parseDate(61)).toBe("1900-03-01");
    expect(parseDate(45351)).toBe("2024-02-29");
  });

  it.each([
    "31/02/2026",
    "29/02/2025",
    "2026-13-01",
    "2026-04-31",
    "not a date",
    "",
  ])("rejects invalid date %s", (input) => {
    expect(() => parseDate(input)).toThrow();
  });
});

describe("statement import", () => {
  it("rejects the fictitious Excel leap day", () => {
    expect(() => parseDate(60)).toThrow();
  });

  it.each([
    ["bbva", "F. VALOR;DESCRIPCIÓN;IMPORTE (€)"],
    ["ing", "F. VALOR;Descripción;Importe (€)"],
    ["sabadell", "F. Operación;Concepto;Importe"],
  ])(
    "detects real %s export headings after metadata",
    async (profile, header) => {
      const file = Buffer.from(
        `Extracto de movimientos\nCuenta: ES00 0000\n${header}\n06/11/2026;Compra supermercado;-25,35\n`,
      );
      const result = await parseStatement(file, `${profile}.csv`, profile);
      expect(result.errors).toEqual([]);
      expect(result.rows).toEqual([
        {
          date: "2026-11-06",
          concept: "Compra supermercado",
          amount: 25.35,
          type: "EXPENSE",
        },
      ]);
    },
  );

  it("detects Revolut dates and descriptions without treating transaction Type as a sign", async () => {
    const csv =
      "Type,Product,Started Date,Completed Date,Description,Amount,Currency\nCard Payment,Current,2026-11-05 14:20:00,2026-11-06 14:20:00,Café,-2.50,EUR\n";
    const result = await parseStatement(
      Buffer.from(csv),
      "revolut.csv",
      "revolut",
    );
    expect(result.errors).toEqual([]);
    expect(result.mapping.sign).toBeUndefined();
    expect(result.rows).toEqual([
      { date: "2026-11-06", concept: "Café", amount: 2.5, type: "EXPENSE" },
    ]);
  });

  it("reports non-EUR Revolut amounts instead of adding another currency as euros", async () => {
    const csv =
      "Type,Product,Started Date,Completed Date,Description,Amount,Currency\nCard Payment,Current,2026-11-05,2026-11-06,Coffee,-3.50,USD\n";
    const result = await parseStatement(
      Buffer.from(csv),
      "revolut.csv",
      "revolut",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("USD");
  });

  it("uses the N26 payee even when the payment reference is empty", async () => {
    const csv =
      "Date;Payee;Payment reference;Amount (EUR)\n2026-11-06;Acme SL;;1800.00\n";
    const result = await parseStatement(Buffer.from(csv), "n26.csv", "n26");
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.concept).toBe("Acme SL");
  });

  it("rejects XLSX formulas rather than trusting cached formula values", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Movimientos");
    sheet.addRows([
      ["Fecha", "Concepto", "Importe"],
      ["06/11/2026", "Untrusted formula", { formula: "1+1", result: 2 }],
    ]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(
      parseStatement(file, "formula.xlsx", "generic"),
    ).rejects.toThrow(/fórmulas/);
  });

  it("detects Spanish headers and semicolons while respecting quoted concepts", async () => {
    const csv =
      'Fecha;Concepto;Importe\n06/11/2026;"CAFÉ; desayuno";-2,50\n07/11/2026;Nómina;1.800,00\n';
    const result = await parseStatement(Buffer.from(csv), "bbva.csv", "bbva");
    expect(result.headers).toEqual(["Fecha", "Concepto", "Importe"]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        date: "2026-11-06",
        concept: "CAFÉ; desayuno",
        amount: 2.5,
        type: "EXPENSE",
      },
      { date: "2026-11-07", concept: "Nómina", amount: 1800, type: "INCOME" },
    ]);
  });

  it("does not confuse commas inside amounts with the CSV delimiter", async () => {
    const csv =
      "Día;Texto;Valor\n" +
      Array.from(
        { length: 15 },
        (_, i) => `06/11/2026;Compra ${i};1,234.56`,
      ).join("\n");
    const result = await parseStatement(
      Buffer.from(csv),
      "custom.csv",
      "generic",
      { date: "Día", concept: "Texto", amount: "Valor" },
    );
    expect(result.rows).toHaveLength(15);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.amount).toBe(1234.56);
  });

  it("decodes legacy Spanish Latin-1 files", async () => {
    const csv = Buffer.from(
      "Fecha;Concepto;Importe\n06/11/2026;Peña cafetería;-3,20\n",
      "latin1",
    );
    const result = await parseStatement(
      csv,
      "santander.csv",
      "santander",
      mapping,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.concept).toBe("Peña cafetería");
  });

  it("returns each rejected row instead of silently discarding invalid transactions", async () => {
    const csv =
      "Fecha;Concepto;Importe\n06/11/2026;Bien;-2,50\n31/02/2026;Fecha errónea;-3,00\n07/11/2026;Importe erróneo;12,34,56\n08/11/2026;;-1,00\n";
    const result = await parseStatement(
      Buffer.from(csv),
      "bank.csv",
      "generic",
      mapping,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(3);
    expect(
      result.errors.every((error) => error.row > 1 && error.message.length > 0),
    ).toBe(true);
  });

  it("returns unknown generic headers so manual mapping can repair detection", async () => {
    const file = Buffer.from("Día;Texto;Valor\n06/11/2026;Compra;-2,50");
    const preview = await parseStatement(file, "custom.csv", "generic");
    expect(preview.headers).toEqual(["Día", "Texto", "Valor"]);
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toHaveLength(1);
    const repaired = await parseStatement(file, "custom.csv", "generic", {
      date: "Día",
      concept: "Texto",
      amount: "Valor",
    });
    expect(repaired.errors).toEqual([]);
    expect(repaired.rows).toEqual([
      { date: "2026-11-06", concept: "Compra", amount: 2.5, type: "EXPENSE" },
    ]);
  });

  it("uses a manually mapped sign column", async () => {
    const csv =
      "Día;Texto;Valor;Signo\n06/11/2026;Supermercado;24,50;-\n07/11/2026;Abono;20,00;+\n";
    const result = await parseStatement(
      Buffer.from(csv),
      "custom.csv",
      "generic",
      {
        date: "Día",
        concept: "Texto",
        amount: "Valor",
        sign: "Signo",
      },
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.type)).toEqual(["EXPENSE", "INCOME"]);
  });

  it("imports distinct income and expense columns", async () => {
    const csv =
      "Fecha;Concepto;Haber;Debe\n06/11/2026;Compra;;24,50\n07/11/2026;Nómina;1800,00;\n";
    const result = await parseStatement(
      Buffer.from(csv),
      "columns.csv",
      "generic",
      {
        date: "Fecha",
        concept: "Concepto",
        amount: "",
        income: "Haber",
        expense: "Debe",
      },
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map(({ amount, type }) => ({ amount, type }))).toEqual([
      { amount: 24.5, type: "EXPENSE" },
      { amount: 1800, type: "INCOME" },
    ]);
  });

  it.each([
    "bbva",
    "santander",
    "caixabank",
    "sabadell",
    "ing",
    "revolut",
    "n26",
    "generic",
  ])(
    "supports the %s profile with manual column overrides",
    async (profile) => {
      const result = await parseStatement(
        Buffer.from("Fecha;Concepto;Importe\n06/11/2026;Compra;-1,25\n"),
        `${profile}.csv`,
        profile,
        mapping,
      );
      expect(result.errors).toEqual([]);
      expect(result.rows[0]?.amount).toBe(1.25);
    },
  );

  it("parses XLSX using the same validated mapping", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Movimientos").addRows([
      ["Fecha", "Concepto", "Importe"],
      ["06/11/2026", "Mercadona", -25.35],
      ["07/11/2026", "Nómina", 1800],
    ]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await parseStatement(
      file,
      "extracto.xlsx",
      "generic",
      mapping,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        date: "2026-11-06",
        concept: "Mercadona",
        amount: 25.35,
        type: "EXPENSE",
      },
      { date: "2026-11-07", concept: "Nómina", amount: 1800, type: "INCOME" },
    ]);
  });
});

describe("deduplication and automatic categories", () => {
  it("normalizes equivalent descriptions and dates into a stable duplicate key", () => {
    expect(
      movementHash("2026-11-06", 250, "EXPENSE", " Café   central ", "bank-1"),
    ).toBe(
      movementHash(
        "2026-11-06T00:00:00.000Z",
        250,
        "EXPENSE",
        "CAFE CENTRAL",
        "bank-1",
      ),
    );
  });

  it("keeps different accounts, dates, amounts, and types distinct", () => {
    const original = movementHash(
      "2026-11-06",
      250,
      "EXPENSE",
      "Café",
      "bank-1",
    );
    expect(
      new Set([
        original,
        movementHash("2026-11-06", 250, "EXPENSE", "Café", "bank-2"),
        movementHash("2026-11-07", 250, "EXPENSE", "Café", "bank-1"),
        movementHash("2026-11-06", 251, "EXPENSE", "Café", "bank-1"),
        movementHash("2026-11-06", 250, "INCOME", "Café", "bank-1"),
      ]).size,
    ).toBe(5);
  });

  it("applies the first matching keyword ignoring case and accents", () => {
    const rules = [
      { keyword: "cafE", categoryId: "food" },
      { keyword: "central", categoryId: "other" },
    ];
    expect(autoCategory("CAFÉ Central", rules)).toBe("food");
    expect(autoCategory("Nómina", rules)).toBeUndefined();
  });
});
