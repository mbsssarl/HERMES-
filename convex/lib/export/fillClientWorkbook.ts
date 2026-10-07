"use node";

import ExcelJS from "exceljs";
import { locateClientColumns, mapRowsToClientItems } from "../extraction/columnMapping";
import { locateTable } from "../extraction/excel";
import { normalizeName } from "../normalize";

export interface ClientFillItem {
  /** N° de ligne de la feuille d'origine, quand il a été retenu à l'import. */
  sourceRow?: number;
  lineNo: number;
  rawDescription: string;
  quantity: number;
  /** Prix unitaire à écrire dans le fichier ; absent = ligne non chiffrée, la cellule n'est pas touchée. */
  unitPrice?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isEmptyCell = (value: ExcelJS.CellValue) => value === null || value === undefined || value === "";

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Renvoie le fichier Excel D'ORIGINE du client avec les prix de la cotation écrits sur les lignes d'articles :
 * même mise en page, mêmes lignes, seule la colonne des prix est complétée (ainsi que la colonne « total »
 * si elle existe et est vide). Si le fichier n'a pas de colonne de prix, elle est ajoutée à droite du tableau.
 * Une ligne n'est pas touchée si on ne sait pas la retrouver avec certitude.
 */
export async function fillClientWorkbook(
  source: ArrayBuffer,
  items: ClientFillItem[],
  opts: { currencyLabel?: string } = {},
): Promise<{ buffer: Buffer; filled: number; unplaced: number }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(source);
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("Le fichier d'origine ne contient aucune feuille.");

  const located = locateTable(ws);
  if (!located) throw new Error("Impossible de retrouver le tableau d'articles dans le fichier d'origine.");
  const { headerRowNumber, table } = located;
  const columns = locateClientColumns(table.headerRow);

  // Lignes d'articles dans l'ordre du fichier : sert de repli pour les commandes importées avant que le n° de
  // ligne soit retenu (n-ième article <-> n-ième ligne, vérifié sur la description).
  const extracted = mapRowsToClientItems(table.headerRow, table.dataRows, table.dataRowNumbers);

  // Colonne des prix (à partir de 1) : celle du fichier, sinon une nouvelle colonne à droite.
  let priceCol: number;
  let styleFromCol: number;
  const headerCellAt = (col: number) => ws.getRow(headerRowNumber).getCell(col);
  if (columns.unitPrice !== -1) {
    priceCol = columns.unitPrice + 1;
    styleFromCol = priceCol;
  } else {
    const lastCol = Math.max(table.headerRow.length, ws.columnCount);
    priceCol = lastCol + 1;
    styleFromCol = Math.max(lastCol, 1);
    const header = headerCellAt(priceCol);
    header.value = "Unit Price";
    header.style = clone(headerCellAt(styleFromCol).style);
    ws.getColumn(priceCol).width = 14;
  }
  if (opts.currencyLabel) {
    const header = headerCellAt(priceCol);
    const current = String(header.value ?? "").trim();
    if (!current.toUpperCase().includes(opts.currencyLabel.toUpperCase())) header.value = `${current || "Unit Price"} (${opts.currencyLabel})`;
  }

  let filled = 0;
  let unplaced = 0;
  for (const item of items) {
    if (item.unitPrice === undefined) continue;

    let rowNumber = item.sourceRow;
    if (rowNumber === undefined) {
      const guess = extracted[item.lineNo - 1];
      rowNumber = guess && normalizeName(guess.rawDescription) === normalizeName(item.rawDescription) ? guess.sourceRow : undefined;
    }
    if (rowNumber === undefined || rowNumber <= headerRowNumber) {
      unplaced++;
      continue;
    }

    const row = ws.getRow(rowNumber);
    const cell = row.getCell(priceCol);
    const price = round2(item.unitPrice);
    cell.value = price;
    if (columns.unitPrice === -1) cell.style = clone(row.getCell(styleFromCol).style);
    if (!cell.numFmt || cell.numFmt === "General") cell.numFmt = "#,##0.00";

    if (columns.total !== -1) {
      const totalCell = row.getCell(columns.total + 1);
      if (isEmptyCell(totalCell.value)) {
        totalCell.value = round2(price * item.quantity);
        if (!totalCell.numFmt || totalCell.numFmt === "General") totalCell.numFmt = "#,##0.00";
      }
    }
    filled++;
  }

  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filled, unplaced };
}
