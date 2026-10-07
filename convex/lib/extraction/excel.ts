"use node";

import ExcelJS from "exceljs";

import { findHeaderRowIndex } from "./columnMapping";

export interface RawTable {
  headerRow: string[];
  dataRows: (string | number | null)[][];
  // Rows before the detected header - the letterhead/vessel/reference block
  // real enquiry documents carry. Used to pre-fill order metadata.
  preambleRows: (string | number | null)[][];
  // N° de ligne de la feuille Excel pour chaque entrée de dataRows (Excel uniquement) : permet de retrouver où
  // réécrire le prix d'un article dans le fichier d'origine du client.
  dataRowNumbers?: number[];
}

function cellToPrimitive(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellToPrimitive((value as { result: ExcelJS.CellValue }).result);
    return String(value);
  }
  return value as string | number;
}

export function sheetRowsWithNumbers(worksheet: ExcelJS.Worksheet): { rows: (string | number | null)[][]; numbers: number[] } {
  const rows: (string | number | null)[][] = [];
  const numbers: number[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    // exceljs returns sparse arrays (holes for empty cells): make them dense so every column has a value.
    rows.push(Array.from({ length: Math.max(values.length - 1, 0) }, (_, i) => cellToPrimitive(values[i + 1])));
    numbers.push(row.number);
  });
  return { rows, numbers };
}

function sheetRows(worksheet: ExcelJS.Worksheet): (string | number | null)[][] {
  return sheetRowsWithNumbers(worksheet).rows;
}

/**
 * Lit la feuille comme à l'extraction d'une demande client, en gardant le n° de ligne de chaque donnée :
 * en-tête (n° de ligne et libellés) + lignes de données. Même logique que parseExcelToTable.
 */
export function locateTable(worksheet: ExcelJS.Worksheet): { headerRowNumber: number; table: RawTable } | null {
  const { rows, numbers } = sheetRowsWithNumbers(worksheet);
  const table = tableFromRows(rows, numbers);
  if (!table) return null;
  const headerIndex = table.preambleRows.length;
  return { headerRowNumber: numbers[headerIndex], table };
}

function tableFromRows(rows: (string | number | null)[][], numbers?: number[]): RawTable | null {
  if (rows.length < 2) return null;
  // The item table's header is rarely row 1: real documents carry a letterhead/reference block first.
  const headerIndex = findHeaderRowIndex(rows);
  if (headerIndex === -1) return null;
  const headerRow = rows[headerIndex].map((c) => String(c ?? ""));
  return {
    headerRow,
    dataRows: rows.slice(headerIndex + 1),
    preambleRows: rows.slice(0, headerIndex),
    dataRowNumbers: numbers?.slice(headerIndex + 1),
  };
}

/** First sheet only: a client enquiry document is a single table. */
export async function parseExcelToTable(buffer: ArrayBuffer): Promise<RawTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Le fichier Excel ne contient aucune feuille.");

  const { rows, numbers } = sheetRowsWithNumbers(worksheet);
  if (rows.length < 2) {
    throw new Error("Le fichier Excel ne contient pas assez de lignes (en-tête + données attendues).");
  }
  const table = tableFromRows(rows, numbers);
  if (!table) {
    throw new Error(
      "Impossible d'identifier l'en-tête du tableau dans ce fichier Excel. Vérifiez le document ou saisissez les lignes manuellement.",
    );
  }
  return table;
}

/** Every sheet that holds a recognisable table (catalogues are often split by category, one sheet each). */
export async function parseExcelToTables(buffer: ArrayBuffer): Promise<RawTable[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const tables: RawTable[] = [];
  for (const worksheet of workbook.worksheets) {
    const table = tableFromRows(sheetRows(worksheet));
    if (table) tables.push(table);
  }
  if (tables.length === 0) {
    throw new Error("Impossible d'identifier l'en-tête du tableau dans ce fichier Excel.");
  }
  return tables;
}
