"use node";

import { parseExcelToTable, parseExcelToTables, type RawTable } from "./excel";
import { extractPdfTable } from "./pdf";
import { extractWordTable } from "./word";

/** Dispatches an uploaded document to the right extractor (PDF / Excel / Word) and returns its raw table. */
export async function parseFileToTable(mimeType: string, buffer: ArrayBuffer): Promise<RawTable> {
  if (mimeType === "application/pdf") {
    return await extractPdfTable(Buffer.from(buffer));
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    return await parseExcelToTable(buffer);
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return await extractWordTable(Buffer.from(buffer));
  }
  throw new Error(`Type de fichier non pris en charge pour l'extraction : ${mimeType}`);
}

/** Same as parseFileToTable, but an Excel workbook yields one table per sheet (used for catalogue imports). */
export async function parseFileToTables(mimeType: string, buffer: ArrayBuffer): Promise<RawTable[]> {
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    return await parseExcelToTables(buffer);
  }
  return [await parseFileToTable(mimeType, buffer)];
}
