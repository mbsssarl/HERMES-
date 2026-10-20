"use node";

import ExcelJS from "exceljs";
import JSZip from "jszip";

import { findHeaderRowIndex } from "./columnMapping";

/**
 * Copie du .xlsx sans les parties « annexes » qui font planter ExcelJS sur certains fichiers (commentaires,
 * dessins, liens, tableaux structurés : « Cannot read properties of undefined (reading 'comments') »).
 * Les valeurs des cellules ne sont pas touchées ; seules ces annexes disparaissent.
 */
async function stripWorkbookExtras(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  const removed = /^xl\/(comments[^/]*\.xml|threadedComments\/|persons\/|drawings\/|tables\/|worksheets\/_rels\/)/i;
  for (const name of Object.keys(zip.files)) {
    if (removed.test(name)) zip.remove(name);
  }
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
      const xml = await zip.file(name)!.async("string");
      zip.file(
        name,
        xml
          .replace(/<legacyDrawing\b[^>]*\/>/g, "")
          .replace(/<drawing\b[^>]*\/>/g, "")
          .replace(/<hyperlinks>[\s\S]*?<\/hyperlinks>/g, "")
          .replace(/<tableParts\b[\s\S]*?<\/tableParts>/g, ""),
      );
    }
  }
  const types = zip.file("[Content_Types].xml");
  if (types) {
    const xml = await types.async("string");
    zip.file(
      "[Content_Types].xml",
      xml.replace(/<Override\b[^>]*PartName="\/xl\/(comments|threadedComments|persons|drawings|tables)[^"]*"[^>]*\/>/gi, ""),
    );
  }
  return await zip.generateAsync({ type: "arraybuffer" });
}

/**
 * Charge un classeur Excel. Si ExcelJS échoue (fichier produit par un autre logiciel, annexes atypiques...),
 * on réessaie sur une copie nettoyée avant d'abandonner avec un message exploitable.
 */
export async function loadWorkbookTolerant(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  } catch (firstError) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await stripWorkbookExtras(buffer));
      return workbook;
    } catch {
      const reason = firstError instanceof Error ? firstError.message : String(firstError);
      throw new Error(
        `Fichier Excel illisible (${reason}). Ouvrez-le dans Excel, enregistrez-le de nouveau au format .xlsx (Enregistrer sous), puis réessayez.`,
      );
    }
  }
}

export interface RawTable {
  headerRow: string[];
  dataRows: (string | number | null)[][];
  // Rows before the detected header - the letterhead/vessel/reference block
  // real enquiry documents carry. Used to pre-fill order metadata.
  preambleRows: (string | number | null)[][];
  // N° de ligne de la feuille Excel pour chaque entrée de dataRows (Excel uniquement) : permet de retrouver où
  // réécrire le prix d'un article dans le fichier d'origine du client.
  dataRowNumbers?: number[];
  // Nombre de lignes non vides masquées dans la feuille (filtre actif, lignes masquées à la main) : elles ne sont pas
  // lues, on importe ce que l'utilisateur voit dans Excel.
  hiddenRowsIgnored?: number;
}

function cellToPrimitive(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // Texte à mise en forme riche (plusieurs polices dans une même cellule) : on en garde le texte.
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    // Erreur de formule (#VALUE!, #REF!...) : pas une valeur lisible, la cellule est traitée comme vide.
    if ("error" in value) return null;
    if ("result" in value) return cellToPrimitive((value as { result: ExcelJS.CellValue }).result);
    return null;
  }
  return value as string | number;
}

export function sheetRowsWithNumbers(worksheet: ExcelJS.Worksheet): { rows: (string | number | null)[][]; numbers: number[]; hidden: number } {
  const rows: (string | number | null)[][] = [];
  const numbers: number[] = [];
  let hidden = 0;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    // Ligne masquée (filtre automatique ou masquage manuel) : ce n'est pas ce que le client voit, on l'ignore.
    if (row.hidden) {
      hidden++;
      return;
    }
    const values = row.values as ExcelJS.CellValue[];
    // exceljs returns sparse arrays (holes for empty cells): make them dense so every column has a value.
    rows.push(Array.from({ length: Math.max(values.length - 1, 0) }, (_, i) => cellToPrimitive(values[i + 1])));
    numbers.push(row.number);
  });
  return { rows, numbers, hidden };
}

function sheetRows(worksheet: ExcelJS.Worksheet): (string | number | null)[][] {
  return sheetRowsWithNumbers(worksheet).rows;
}

/**
 * Lit la feuille comme à l'extraction d'une demande client, en gardant le n° de ligne de chaque donnée :
 * en-tête (n° de ligne et libellés) + lignes de données. Même logique que parseExcelToTable.
 */
export function locateTable(worksheet: ExcelJS.Worksheet): { headerRowNumber: number; table: RawTable } | null {
  const { rows, numbers, hidden } = sheetRowsWithNumbers(worksheet);
  const table = tableFromRows(rows, numbers);
  if (!table) return null;
  table.hiddenRowsIgnored = hidden;
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
  const workbook = await loadWorkbookTolerant(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Le fichier Excel ne contient aucune feuille.");

  const { rows, numbers, hidden } = sheetRowsWithNumbers(worksheet);
  if (rows.length < 2) {
    throw new Error("Le fichier Excel ne contient pas assez de lignes (en-tête + données attendues).");
  }
  const table = tableFromRows(rows, numbers);
  if (!table) {
    throw new Error(
      "Impossible d'identifier l'en-tête du tableau dans ce fichier Excel. Vérifiez le document ou saisissez les lignes manuellement.",
    );
  }
  table.hiddenRowsIgnored = hidden;
  return table;
}

/** Every sheet that holds a recognisable table (catalogues are often split by category, one sheet each). */
export async function parseExcelToTables(buffer: ArrayBuffer): Promise<RawTable[]> {
  const workbook = await loadWorkbookTolerant(buffer);
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
