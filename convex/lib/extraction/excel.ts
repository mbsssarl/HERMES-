"use node";

import ExcelJS from "exceljs";

import { findHeaderRowIndex } from "./columnMapping";

export interface RawTable {
  headerRow: string[];
  dataRows: (string | number | null)[][];
  // Rows before the detected header - the letterhead/vessel/reference block
  // real enquiry documents carry. Used to pre-fill order metadata.
  preambleRows: (string | number | null)[][];
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

export async function parseExcelToTable(buffer: ArrayBuffer): Promise<RawTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Le fichier Excel ne contient aucune feuille.");

  const rows: (string | number | null)[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    rows.push(values.slice(1).map(cellToPrimitive));
  });

  if (rows.length < 2) {
    throw new Error("Le fichier Excel ne contient pas assez de lignes (en-tête + données attendues).");
  }

  // The item table's header is rarely row 1: real enquiry documents carry a
  // letterhead/vessel/reference block first. Locate it by content instead.
  const headerIndex = findHeaderRowIndex(rows);
  if (headerIndex === -1) {
    throw new Error(
      "Impossible d'identifier l'en-tête du tableau dans ce fichier Excel. Vérifiez le document ou saisissez les lignes manuellement.",
    );
  }

  const headerRow = rows[headerIndex].map((c) => String(c ?? ""));
  return { headerRow, dataRows: rows.slice(headerIndex + 1), preambleRows: rows.slice(0, headerIndex) };
}
