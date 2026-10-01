export interface NormalizedClientItem {
  rawCode?: string;
  rawDescription: string;
  rawQuantity?: number;
  rawUnit?: string;
  rawOrigin?: string;
  quotedQuantity?: number;
  unitPrice?: number;
  discountPercent?: number;
  reqNotes?: string;
  enqNotes?: string;
}

export interface NormalizedSupplierItem {
  rawCode?: string;
  rawName: string;
  rawDescription?: string;
  rawUnit?: string;
  rawPrice?: number;
}

type CellValue = string | number | null | undefined;

const CLIENT_FIELD_ALIASES: Record<keyof NormalizedClientItem, string[]> = {
  rawCode: ["code", "impa", "impa id", "id", "article no", "article number", "ref", "reference"],
  rawDescription: ["description", "nom", "name", "designation", "article", "article name", "libelle"],
  rawQuantity: ["quantity", "qty", "quantite", "qte"],
  rawUnit: ["unit", "unite", "uom", "u/m"],
  rawOrigin: ["origin", "origine"],
  quotedQuantity: ["quoted qty", "quoted quantity", "qte cotee"],
  unitPrice: ["unit price", "prix unitaire", "price", "prix"],
  discountPercent: ["discount (%)", "discount", "remise (%)", "remise"],
  reqNotes: ["req notes", "requirement notes", "notes demande", "req note"],
  enqNotes: ["enq notes", "enquiry notes", "notes enquete", "enq note"],
};

const SUPPLIER_FIELD_ALIASES: Record<keyof NormalizedSupplierItem, string[]> = {
  rawCode: ["code", "impa", "impa id", "id", "article no", "reference"],
  rawName: ["name", "nom", "description", "designation", "article"],
  rawDescription: ["description", "details", "detail"],
  rawUnit: ["unit", "unite", "uom", "u/m"],
  rawPrice: ["unit price", "price", "prix", "prix unitaire", "unit price (eur)"],
};

// Real enquiry documents (letterhead, enquiry ref, vessel/IMO, port,
// category...) almost always have several metadata rows before the actual
// item table starts - the header is rarely row 1. These keywords are
// specific enough that requiring 3+ matches reliably tells a real header
// row apart from those preamble rows.
const HEADER_ROW_KEYWORDS = [
  "impa",
  "code",
  "description",
  "designation",
  "quantity",
  "qty",
  "unit",
  "origin",
  "article",
  "req notes",
  "enq notes",
  "unit price",
  "final price",
];

/**
 * Locates the header row among a table's rows by content rather than
 * assuming it's row 1. Returns -1 if no row looks like a plausible header.
 *
 * Two checks, both required: (1) at least 3 keyword matches, and (2) at
 * least 3 DISTINCT, SHORT (<=30 chars) non-empty cells. #2 matters because
 * a merged instructional paragraph (e.g. "Kindly advise price... origin,
 * unit price...") can accidentally contain several keywords too - but it
 * shows up as the *same* long string repeated across every underlying
 * cell, which a real header row (one short distinct label per column)
 * never looks like.
 */
export function findHeaderRowIndex(rows: CellValue[][]): number {
  return rows.findIndex((row) => {
    const cells = row
      .map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim()))
      .filter((cell) => cell.length > 0);
    if (cells.length < 3) return false;

    const distinctShortCells = new Set(cells.filter((c) => c.length <= 30));
    if (distinctShortCells.size < 3) return false;

    const joined = cells.join(" ").toLowerCase();
    const matches = HEADER_ROW_KEYWORDS.filter((kw) => joined.includes(kw)).length;
    return matches >= 3;
  });
}

function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_./]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  // Array.from: tolerate sparse header rows (missing cells are treated as empty headers).
  const normalizedHeaders = Array.from(headers, (h) => normalizeHeader(h ?? ""));
  for (const alias of aliases) {
    const idx = normalizedHeaders.findIndex((h) => h === alias);
    if (idx !== -1) return idx;
  }
  for (const alias of aliases) {
    const idx = normalizedHeaders.findIndex((h) => h.includes(alias));
    if (idx !== -1) return idx;
  }
  return -1;
}

function toStringOrUndefined(value: CellValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  return str.length > 0 ? str : undefined;
}

// Real enquiry documents commonly use a placeholder instead of leaving the
// code column blank when the client has no catalogue reference for an item
// (e.g. "XXXX", "XX", "N/A"). Treated as truthy, such a placeholder would
// permanently block name/alias matching (a supplied-but-unresolved code is
// never rescued by a name guess, by design - see lib/matching.ts) even
// though the client never actually gave a real code. Normalize these to
// "no code provided" so the item still gets a chance at name/alias matching.
const CODE_PLACEHOLDER_PATTERN = /^x+$|^n\/?a$|^tbd$|^-+$|^\?+$/i;

function toCodeOrUndefined(value: CellValue): string | undefined {
  const str = toStringOrUndefined(value);
  if (str === undefined) return undefined;
  return CODE_PLACEHOLDER_PATTERN.test(str) ? undefined : str;
}

/**
 * A merged cell's value gets duplicated across every underlying cell when
 * read row-by-row - a footer/signature line ("Enquired: 07/08/2025...")
 * spanning several columns then looks like a fake item with the same text
 * in its code/unit/origin as in its description. Real rows never repeat the
 * exact same string across unrelated columns, so treat that as the tell.
 */
function looksLikeMergedArtifactRow(description: string, otherFields: (string | undefined)[]): boolean {
  const duplicates = otherFields.filter((v) => v !== undefined && v === description).length;
  return duplicates >= 2;
}

/**
 * Reads the number out of a cell, whatever surrounds it: "340 000,00 XAF", "XAF 25000", "1 500 FCFA",
 * "1.234,56", "1,234.56", "12,5", or a plain numeric cell. Currency codes, symbols and units are ignored,
 * spaces (including non-breaking ones) are thousands separators, and the LAST "," or "." is the decimal
 * mark when both appear; a single separator followed by exactly 3 digits is a thousands separator ("1,300").
 */
function toNumberOrUndefined(value: CellValue): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;

  const match = /-?\d[\d\s  .,]*/.exec(String(value));
  if (!match) return undefined;
  const text = match[0].replace(/[\s  ]/g, "");
  if (!text) return undefined;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let decimal: "," | "." | null = null;
  if (lastComma !== -1 && lastDot !== -1) {
    decimal = lastComma > lastDot ? "," : ".";
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const occurrences = text.split(sep).length - 1;
    const digitsAfter = text.length - text.lastIndexOf(sep) - 1;
    decimal = occurrences === 1 && digitsAfter !== 3 ? sep : null;
  }

  let normalized = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "," || ch === ".") {
      if (decimal && ch === decimal && i === text.lastIndexOf(decimal)) normalized += ".";
    } else {
      normalized += ch;
    }
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
}

function isRowEmpty(row: CellValue[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

export function mapRowsToClientItems(
  headerRow: string[],
  dataRows: CellValue[][],
): NormalizedClientItem[] {
  const columns: Record<keyof NormalizedClientItem, number> = {
    rawCode: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.rawCode),
    rawDescription: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.rawDescription),
    rawQuantity: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.rawQuantity),
    rawUnit: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.rawUnit),
    rawOrigin: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.rawOrigin),
    quotedQuantity: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.quotedQuantity),
    unitPrice: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.unitPrice),
    discountPercent: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.discountPercent),
    reqNotes: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.reqNotes),
    enqNotes: findColumnIndex(headerRow, CLIENT_FIELD_ALIASES.enqNotes),
  };

  const items: NormalizedClientItem[] = [];
  for (const row of dataRows) {
    if (isRowEmpty(row)) continue;

    const description =
      columns.rawDescription !== -1 ? toStringOrUndefined(row[columns.rawDescription]) : undefined;
    // A row with no usable description is not a real article line - skip it,
    // but only genuinely empty rows are dropped, never a row with data we
    // simply failed to map to "description".
    if (!description) continue;

    const rawCode = columns.rawCode !== -1 ? toCodeOrUndefined(row[columns.rawCode]) : undefined;
    const rawUnit = columns.rawUnit !== -1 ? toStringOrUndefined(row[columns.rawUnit]) : undefined;
    const rawOrigin = columns.rawOrigin !== -1 ? toStringOrUndefined(row[columns.rawOrigin]) : undefined;

    // A merged footer/signature cell duplicated across columns looks like a
    // fake item ("Enquired: 07/08/2025" as code, unit, AND origin) - not a
    // real client-requested line, so it's excluded rather than kept.
    if (looksLikeMergedArtifactRow(description, [rawCode, rawUnit, rawOrigin])) continue;

    items.push({
      rawCode,
      rawDescription: description,
      rawQuantity: columns.rawQuantity !== -1 ? toNumberOrUndefined(row[columns.rawQuantity]) : undefined,
      rawUnit,
      rawOrigin,
      quotedQuantity: columns.quotedQuantity !== -1 ? toNumberOrUndefined(row[columns.quotedQuantity]) : undefined,
      unitPrice: columns.unitPrice !== -1 ? toNumberOrUndefined(row[columns.unitPrice]) : undefined,
      discountPercent: columns.discountPercent !== -1 ? toNumberOrUndefined(row[columns.discountPercent]) : undefined,
      reqNotes: columns.reqNotes !== -1 ? toStringOrUndefined(row[columns.reqNotes]) : undefined,
      enqNotes: columns.enqNotes !== -1 ? toStringOrUndefined(row[columns.enqNotes]) : undefined,
    });
  }
  return items;
}

export function mapRowsToSupplierItems(
  headerRow: string[],
  dataRows: CellValue[][],
): NormalizedSupplierItem[] {
  // Catalogues often have BOTH a "DESIGNATION" (what the article is) and a "DESCRIPTION" (its size / spec):
  // the product name is the designation followed by the description ("DRILL ELECTRIC PORTABLE 32MM, AC220V").
  // With a single one of the two columns, that column is the name.
  const designationColumn = findColumnIndex(headerRow, ["designation", "name", "nom", "article", "libelle"]);
  const descriptionColumn = findColumnIndex(headerRow, SUPPLIER_FIELD_ALIASES.rawDescription);
  const hasBoth = designationColumn !== -1 && descriptionColumn !== -1 && designationColumn !== descriptionColumn;
  const nameColumn = designationColumn !== -1 ? designationColumn : descriptionColumn;

  const columns = {
    rawCode: findColumnIndex(headerRow, SUPPLIER_FIELD_ALIASES.rawCode),
    rawUnit: findColumnIndex(headerRow, SUPPLIER_FIELD_ALIASES.rawUnit),
    rawPrice: findColumnIndex(headerRow, SUPPLIER_FIELD_ALIASES.rawPrice),
  };

  const items: NormalizedSupplierItem[] = [];
  for (const row of dataRows) {
    if (isRowEmpty(row)) continue;

    const designation = nameColumn !== -1 ? toStringOrUndefined(row[nameColumn]) : undefined;
    let details = hasBoth ? toStringOrUndefined(row[descriptionColumn]) : undefined;
    // A merged title cell repeats the same text in every column: designation === description.
    if (details && designation && details.toLowerCase() === designation.toLowerCase()) details = undefined;
    const name = designation && details ? `${designation} ${details}` : (designation ?? details);
    if (!name) continue;

    const rawCode = columns.rawCode !== -1 ? toCodeOrUndefined(row[columns.rawCode]) : undefined;
    const rawUnit = columns.rawUnit !== -1 ? toStringOrUndefined(row[columns.rawUnit]) : undefined;

    // Merged banner / footer cells: the same text sits in the code (and/or unit) column as in the name.
    if (rawCode && designation && rawCode.toLowerCase() === designation.toLowerCase()) continue;
    if (looksLikeMergedArtifactRow(name, [rawCode, rawUnit])) continue;

    items.push({
      rawCode,
      rawName: name,
      rawDescription: details,
      rawUnit,
      rawPrice: columns.rawPrice !== -1 ? toNumberOrUndefined(row[columns.rawPrice]) : undefined,
    });
  }
  return items;
}
