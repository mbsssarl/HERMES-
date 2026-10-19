"use node";

import JSZip from "jszip";
import * as XLSX from "xlsx";

import { parseExcelToTable, parseExcelToTables, type RawTable } from "./excel";
import { UNSUPPORTED_MESSAGE, type FileKind } from "./fileKinds";
import { extractPdfTable } from "./pdf";
import { extractWordTable } from "./word";

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((b, i) => buffer[i] === b);
}

/** Détecte le vrai format d'après le contenu (le type MIME du navigateur est souvent vide ou faux). */
async function detectKind(mimeType: string, buffer: Buffer): Promise<FileKind | null> {
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";

  if (startsWith(buffer, [0x50, 0x4b])) {
    // Fichier zip : classeur Excel (.xlsx) ou document Word (.docx).
    try {
      const zip = await JSZip.loadAsync(buffer);
      if (zip.file("xl/workbook.xml")) return "xlsx";
      if (zip.file("word/document.xml")) return "docx";
    } catch {
      return null;
    }
    return null;
  }

  if (startsWith(buffer, OLE_SIGNATURE)) {
    // Ancien format Office : accepté seulement s'il contient un flux « Workbook » / « Book » (ancien Excel .xls).
    try {
      const cfb = XLSX.CFB.read(buffer, { type: "buffer" });
      return XLSX.CFB.find(cfb, "Workbook") || XLSX.CFB.find(cfb, "Book") ? "xls" : null;
    } catch {
      return mimeType.includes("excel") ? "xls" : null;
    }
  }

  return null;
}

/** Ancien Excel (.xls) : converti en .xlsx pour réutiliser la lecture existante. */
function toXlsxBuffer(buffer: Buffer): ArrayBuffer {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Fichier Excel illisible (${reason}). Il est peut-être protégé par un mot de passe ou corrompu.`);
  }
  const out = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** Dispatches an uploaded document to the right extractor (PDF / Excel / Word / scan) and returns its raw table. */
export async function parseFileToTable(mimeType: string, buffer: ArrayBuffer): Promise<RawTable> {
  const buf = Buffer.from(buffer);
  const kind = await detectKind(mimeType, buf);
  switch (kind) {
    case "pdf":
      return await extractPdfTable(buf);
    case "xlsx":
      return await parseExcelToTable(buffer);
    case "xls":
      return await parseExcelToTable(toXlsxBuffer(buf));
    case "docx":
      return await extractWordTable(buf);
    default:
      throw new Error(UNSUPPORTED_MESSAGE);
  }
}

/** Same as parseFileToTable, but an Excel workbook yields one table per sheet (used for catalogue imports). */
export async function parseFileToTables(mimeType: string, buffer: ArrayBuffer): Promise<RawTable[]> {
  const buf = Buffer.from(buffer);
  const kind = await detectKind(mimeType, buf);
  if (kind === "xlsx") return await parseExcelToTables(buffer);
  if (kind === "xls") return await parseExcelToTables(toXlsxBuffer(buf));
  return [await parseFileToTable(mimeType, buffer)];
}
