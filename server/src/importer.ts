import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

export interface ColumnMapping {
  date: string;
  concept: string;
  amount: string;
  sign?: string;
  income?: string;
  expense?: string;
}

export interface ImportRow {
  date: string;
  concept: string;
  amount: number;
  type: "INCOME" | "EXPENSE";
}

export interface ImportResult {
  headers: string[];
  rows: ImportRow[];
  errors: { row: number; message: string }[];
  mapping: ColumnMapping;
}

export const profiles = [
  { id: "bbva", name: "BBVA" },
  { id: "santander", name: "Santander" },
  { id: "caixabank", name: "CaixaBank" },
  { id: "sabadell", name: "Sabadell" },
  { id: "ing", name: "ING" },
  { id: "revolut", name: "Revolut" },
  { id: "n26", name: "N26" },
  { id: "generic", name: "Genérico / mapeo manual" },
] as const;

const normalize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/** Strict money parsing: preserves cents and rejects partially parsed or malformed values. */
export function parseAmount(input: string | number): number {
  if (typeof input === "number") {
    if (
      !Number.isFinite(input) ||
      Math.abs(input) > Number.MAX_SAFE_INTEGER / 100 ||
      Math.abs(input * 100 - Math.round(input * 100)) > 0.00001
    )
      throw new Error("Importe inválido: máximo dos decimales");
    return Math.round(input * 100) / 100;
  }
  let value = String(input)
    .trim()
    .replace(/\u2212/g, "-")
    .replace(/\s|\u00a0/g, "")
    .replace(/(?:EUR|€)/gi, "");
  let negative = false;
  if (/^\(.+\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (/^[+-]/.test(value)) {
    negative = value[0] === "-" || negative;
    value = value.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(value)) throw new Error("Importe inválido");
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma !== -1 && dot !== -1) {
    const decimal = comma > dot ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    const parts = value.split(decimal);
    if (
      parts.length !== 2 ||
      !/^\d{1,2}$/.test(parts[1]!) ||
      !new RegExp(`^\\d{1,3}(?:\\${grouping}\\d{3})+$`).test(parts[0]!)
    )
      throw new Error("Separadores de importe inválidos");
    value = parts[0]!.split(grouping).join("") + "." + parts[1]!;
  } else if (comma !== -1 || dot !== -1) {
    const separator = comma !== -1 ? "," : ".";
    if (new RegExp(`^\\d+\\${separator}\\d{1,2}$`).test(value))
      value = value.replace(separator, ".");
    else if (new RegExp(`^\\d{1,3}(?:\\${separator}\\d{3})+$`).test(value))
      value = value.split(separator).join("");
    else throw new Error("Separadores de importe inválidos");
  }
  const amount = Number(value) * (negative ? -1 : 1);
  if (
    !Number.isFinite(amount) ||
    Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100
  )
    throw new Error("Importe fuera de rango");
  return Math.round(amount * 100) / 100;
}

export function parseDate(input: string | number | Date): string {
  let year: number;
  let month: number;
  let day: number;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new Error("Fecha inválida");
    year = input.getUTCFullYear();
    month = input.getUTCMonth() + 1;
    day = input.getUTCDate();
  } else if (typeof input === "number") {
    const serial = Math.floor(input);
    if (
      !Number.isFinite(input) ||
      serial < 1 ||
      serial === 60 ||
      serial > 110000
    )
      throw new Error("Fecha de Excel inválida");
    // Excel includes the fictitious 29/02/1900 at serial 60.
    const date = new Date(
      Date.UTC(1899, 11, 30) + (serial < 60 ? serial + 1 : serial) * 86_400_000,
    );
    year = date.getUTCFullYear();
    month = date.getUTCMonth() + 1;
    day = date.getUTCDate();
  } else {
    const value = String(input).trim();
    const spanish = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(value);
    const iso =
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
        value,
      );
    if (spanish) {
      day = Number(spanish[1]);
      month = Number(spanish[2]);
      year = Number(spanish[3]);
    } else if (iso) {
      year = Number(iso[1]);
      month = Number(iso[2]);
      day = Number(iso[3]);
    } else throw new Error("Fecha inválida: usa dd/mm/yyyy o yyyy-mm-dd");
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > 2200 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    throw new Error("Fecha de calendario inválida");
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const aliases: Record<keyof ColumnMapping, string[]> = {
  date: [
    "fecha operacion",
    "fecha de operacion",
    "fecha movimiento",
    "fecha contable",
    "fecha contabilizacion",
    "fecha valor",
    "fecha",
    "booking date",
    "value date",
    "completed date",
    "started date",
    "date",
  ],
  concept: [
    "concepto",
    "descripcion",
    "description",
    "detalles",
    "details",
    "payment reference",
    "payment description",
    "beneficiario",
    "merchant",
    "payee",
    "referencia",
  ],
  amount: [
    "importe",
    "amount (eur)",
    "amount",
    "cantidad",
    "importe eur",
    "importe en euros",
    "importe movimiento",
    "importe de la operacion",
    "monto",
  ],
  sign: ["signo", "debe haber", "cargo abono", "credit debit", "direction"],
  income: [
    "abono",
    "abonos",
    "haber",
    "ingreso",
    "ingresos",
    "credit",
    "credit amount",
  ],
  expense: [
    "cargo",
    "cargos",
    "debe",
    "gasto",
    "gastos",
    "debit",
    "debit amount",
  ],
};

const bankAliases: Record<
  string,
  Partial<Record<keyof ColumnMapping, string[]>>
> = {
  bbva: {
    date: ["f. operacion", "f. valor"],
    concept: ["descripcion del movimiento"],
    amount: ["importe (€)", "importe (eur)"],
  },
  santander: {
    date: ["fecha operacion", "fecha de la operacion"],
    concept: ["concepto movimiento"],
  },
  caixabank: {
    date: ["fecha operacion", "fecha de operacion"],
    concept: ["descripcion del movimiento"],
  },
  sabadell: { date: ["f. operacion", "fecha operacion", "f. valor"] },
  ing: { date: ["f. valor", "f. operacion"], amount: ["importe (€)"] },
  revolut: {
    date: [
      "completed date",
      "fecha de finalizacion",
      "started date",
      "fecha de inicio",
    ],
    concept: ["description", "descripcion"],
  },
  n26: {
    date: ["booking date", "date"],
    concept: ["payee", "payment reference"],
    amount: ["amount (eur)"],
  },
};

function detectMapping(headers: string[], profile = "generic"): ColumnMapping {
  const find = (field: keyof ColumnMapping): string => {
    for (const alias of [
      ...(bankAliases[profile]?.[field] ?? []),
      ...aliases[field],
    ]) {
      const index = headers.findIndex(
        (header) =>
          normalize(header).replace(/[():]/g, "").trim() ===
          alias.replace(/[():]/g, ""),
      );
      if (index >= 0) return headers[index]!;
    }
    // Bank exports sometimes append the currency or a date-format hint to headings.
    for (const alias of aliases[field].filter((value) => value.length >= 5)) {
      const index = headers.findIndex(
        (header) =>
          normalize(header).startsWith(`${alias} `) ||
          normalize(header).startsWith(`${alias} (`),
      );
      if (index >= 0) return headers[index]!;
    }
    return "";
  };
  return {
    date: find("date"),
    concept: find("concept"),
    amount: find("amount"),
    sign: find("sign") || undefined,
    income: find("income") || undefined,
    expense: find("expense") || undefined,
  };
}

function decodeCsv(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe)
    return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const copy = Buffer.from(buffer.subarray(2));
    copy.swap16();
    return copy.toString("utf16le");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

type Cell = string | number | Date | boolean | null;

function csvRecords(
  buffer: Buffer,
  profile: string,
  requested?: ColumnMapping,
): Cell[][] {
  const text = decodeCsv(buffer).replace(/^\uFEFF/, "");
  let winner: Cell[][] | undefined;
  let best = -1;
  for (const delimiter of [";", "\t", ","]) {
    try {
      const records = parse(text, {
        delimiter,
        bom: true,
        relax_column_count: true,
        skip_empty_lines: false,
        trim: true,
        max_record_size: 1_000_000,
      }) as string[][];
      const sample = records.slice(0, 30);
      const widths = new Map<number, number>();
      let headerScore = 0;
      for (const record of sample) {
        if (record.length > 1)
          widths.set(record.length, (widths.get(record.length) ?? 0) + 1);
        const detected = detectMapping(record, profile);
        const matches = requested
          ? [
              requested.date,
              requested.concept,
              requested.amount,
              requested.income,
              requested.expense,
            ]
              .filter(Boolean)
              .filter((value) => record.includes(value!)).length
          : Number(Boolean(detected.date)) +
            Number(Boolean(detected.concept)) +
            Number(
              Boolean(detected.amount || detected.income || detected.expense),
            );
        headerScore = Math.max(headerScore, matches);
      }
      const consistency = Math.max(0, ...widths.values());
      const score =
        headerScore * 10_000 + consistency * 100 + (widths.size ? 2 : 0);
      if (score > best) {
        best = score;
        winner = records;
      }
    } catch {
      /* A wrong delimiter may treat valid quoted fields as malformed. */
    }
  }
  if (!winner || best < 2)
    throw new Error(
      "CSV inválido: no se detectaron columnas separadas por coma, punto y coma o tabulador",
    );
  return winner;
}

/** Import preview never silently drops invalid data: each rejected source row is reported. */
export async function parseStatement(
  buffer: Buffer,
  filename: string,
  profile: string,
  requested?: ColumnMapping,
): Promise<ImportResult> {
  if (!profiles.some((item) => item.id === profile))
    throw new Error("Perfil bancario desconocido");
  if (buffer.length > 10 * 1024 * 1024)
    throw new Error("El archivo supera 10 MB");
  let records: Cell[][];
  if (/\.(csv|txt)$/i.test(filename))
    records = csvRecords(buffer, profile, requested);
  else if (/\.xlsx$/i.test(filename)) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as never);
    const sheet = book.worksheets[0];
    if (!sheet) throw new Error("El libro no contiene hojas");
    if (sheet.rowCount > 50_001 || sheet.columnCount > 200)
      throw new Error(
        "La hoja supera los límites de 50.000 filas y 200 columnas",
      );
    records = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values: Cell[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const cell = row.getCell(column);
        const value = cell.value;
        if (
          value == null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value instanceof Date
        )
          values.push(value ?? "");
        else if ("formula" in value || "sharedFormula" in value)
          throw new Error(
            "El archivo contiene fórmulas. Exporta el extracto como valores antes de importar",
          );
        else values.push(cell.text);
      }
      records.push(values);
    });
  } else throw new Error("Formato no admitido. Usa CSV o XLSX");
  if (!records.length) throw new Error("El archivo está vacío");
  if (records.length > 50_001)
    throw new Error("Máximo 50.000 movimientos por archivo");
  let headerIndex = 0;
  let best = -1;
  // Some bank exports start with account metadata before the actual table header.
  for (let i = 0; i < Math.min(records.length, 30); i++) {
    const candidate = records[i]!.map((value) => String(value ?? "").trim());
    const detected = detectMapping(candidate, profile);
    const score = requested
      ? [
          requested.date,
          requested.concept,
          requested.amount,
          requested.income,
          requested.expense,
        ]
          .filter(Boolean)
          .filter((value) => candidate.includes(value!)).length
      : (detected.date ? 3 : 0) +
        (detected.concept ? 3 : 0) +
        (detected.amount || detected.income || detected.expense ? 3 : 0);
    if (score > best) {
      best = score;
      headerIndex = i;
    }
  }
  const used = new Set<string>();
  const headers = records[headerIndex]!.map((value, index) => {
    const original = String(value ?? "").trim() || `Columna ${index + 1}`;
    let name = original;
    let occurrence = 2;
    while (used.has(name)) name = `${original} (${occurrence++})`;
    used.add(name);
    return name;
  });
  const mapping = requested ?? detectMapping(headers, profile);
  const rows: ImportRow[] = [];
  const errors: { row: number; message: string }[] = [];
  if (
    !mapping.date ||
    !mapping.concept ||
    (!mapping.amount && !mapping.income && !mapping.expense)
  ) {
    return {
      headers,
      rows,
      errors: [
        {
          row: headerIndex + 1,
          message:
            "No se detectaron todas las columnas. Mapea fecha, concepto e importe (o cargo/abono).",
        },
      ],
      mapping,
    };
  }
  for (const [key, column] of Object.entries(mapping)) {
    if (column && !headers.includes(column))
      throw new Error(`La columna «${column}» (${key}) no existe`);
  }
  const at = (record: Cell[], column?: string): Cell =>
    column ? (record[headers.indexOf(column)] ?? "") : "";
  const currencyColumn = headers.find((header) =>
    ["currency", "divisa", "moneda"].includes(normalize(header)),
  );
  for (let index = headerIndex + 1; index < records.length; index++) {
    const record = records[index]!;
    if (record.every((value) => value === "" || value == null)) continue;
    try {
      const currency = String(at(record, currencyColumn)).trim().toUpperCase();
      if (currency && !["EUR", "€", "EURO", "EUROS"].includes(currency))
        throw new Error(
          `Divisa no admitida: ${currency}. Convierte el extracto a EUR`,
        );
      const rawDate = at(record, mapping.date);
      const date = parseDate(
        rawDate instanceof Date || typeof rawDate === "number"
          ? rawDate
          : String(rawDate),
      );
      const concept = String(at(record, mapping.concept)).trim();
      if (!concept || concept.length > 500)
        throw new Error(
          "Concepto vacío o demasiado largo (máximo 500 caracteres)",
        );
      let signed: number;
      if (mapping.amount)
        signed = parseAmount(String(at(record, mapping.amount)));
      else {
        const credit = at(record, mapping.income);
        const debit = at(record, mapping.expense);
        const income = credit === "" ? 0 : parseAmount(String(credit));
        const expense = debit === "" ? 0 : parseAmount(String(debit));
        if (income !== 0 && expense !== 0)
          throw new Error("La fila tiene cargo y abono simultáneos");
        signed = Math.abs(income) - Math.abs(expense);
      }
      let type: ImportRow["type"] = signed < 0 ? "EXPENSE" : "INCOME";
      const sign = normalize(String(at(record, mapping.sign)));
      if (sign) {
        if (
          [
            "-",
            "d",
            "debe",
            "cargo",
            "debito",
            "debit",
            "expense",
            "gasto",
            "salida",
          ].includes(sign)
        )
          type = "EXPENSE";
        else if (
          [
            "+",
            "h",
            "haber",
            "abono",
            "credito",
            "credit",
            "income",
            "ingreso",
            "entrada",
          ].includes(sign)
        ) {
          if (signed < 0)
            throw new Error("Importe negativo con signo de ingreso");
          type = "INCOME";
        } else throw new Error(`Signo no reconocido: ${sign}`);
      }
      if (signed === 0) throw new Error("El importe debe ser distinto de cero");
      rows.push({ date, concept, amount: Math.abs(signed), type });
    } catch (error) {
      errors.push({
        row: index + 1,
        message: error instanceof Error ? error.message : "Fila inválida",
      });
    }
  }
  return { headers, rows, errors, mapping };
}

export function movementHash(
  date: string,
  amountCents: number,
  type: string,
  concept: string,
  accountId: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        date.slice(0, 10),
        Math.abs(amountCents),
        type.toUpperCase(),
        normalize(concept),
        accountId,
      ]),
    )
    .digest("hex");
}

export function autoCategory(
  concept: string,
  rules: { keyword: string; categoryId: string }[],
): string | undefined {
  const normalized = normalize(concept);
  return rules.find(
    (rule) =>
      normalize(rule.keyword) !== "" &&
      normalized.includes(normalize(rule.keyword)),
  )?.categoryId;
}
