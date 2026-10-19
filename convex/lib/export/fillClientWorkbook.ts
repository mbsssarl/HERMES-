"use node";

import ExcelJS from "exceljs";
import { locateClientColumns, mapRowsToClientItems } from "../extraction/columnMapping";
import { loadWorkbookTolerant, locateTable } from "../extraction/excel";
import { normalizeName } from "../normalize";
import { moneyNumFmt, roundMoney } from "../pricing";

// Montants : toujours 2 décimales (« 20,00 », « 62,50 »), en gardant le reste du format du fichier du client.
const numFmtFor = (existing: string | undefined, _value: number) => moneyNumFmt(!existing || existing === "General" ? "#,##0.00" : existing);
import { recalculateWorkbook } from "./recalc";
import { adaptNumberFormats } from "./numberFormats";

export interface ClientFooter {
  /** Remise globale en % (0 = aucune ligne de remise). */
  discountPercent: number;
  /** Frais de livraison + mise à l'eau, dans la devise du fichier (absent ou 0 = aucune ligne). */
  transportFee?: number;
  currency?: string;
}

export interface ClientFillItem {
  /** N° de ligne de la feuille d'origine, quand il a été retenu à l'import. */
  sourceRow?: number;
  lineNo: number;
  rawDescription: string;
  quantity: number;
  /** Prix unitaire à écrire dans le fichier ; absent = ligne non chiffrée, la cellule n'est pas touchée. */
  unitPrice?: number;
}

const isEmptyCell = (value: ExcelJS.CellValue) => value === null || value === undefined || value === "";

/** Texte d'une cellule (chaîne ou texte riche), sinon undefined. */
function cellText(value: ExcelJS.CellValue): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  return undefined;
}

interface SupplierFields {
  discount?: ExcelJS.Cell;
  delivery?: ExcelJS.Cell;
  currency?: ExcelJS.Cell;
}

/**
 * Beaucoup de demandes de prix ont, au-dessus du tableau, des champs que le fournisseur complète (« DELIVERY
 * EXPENSES », « DISCOUNT (%) », « CURRENCY »...) dont les formules du fichier dépendent. On les retrouve par leur
 * libellé : la cellule à remplir est celle juste en dessous du libellé (la cellule de tête si elle est fusionnée).
 */
function findSupplierFields(ws: ExcelJS.Worksheet, lastRow: number): SupplierFields {
  const fields: SupplierFields = {};
  const targets: [keyof SupplierFields, RegExp][] = [
    ["discount", /^discount\b/i],
    ["delivery", /^delivery\s+expenses?\b/i],
    ["currency", /^currency\b/i],
  ];
  for (let r = 1; r < lastRow; r++) {
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const text = cellText(cell.value)?.trim();
      if (!text) return;
      for (const [key, re] of targets) {
        if (fields[key] || !re.test(text)) continue;
        const below = ws.getCell(cell.row + 1, Number(cell.col));
        fields[key] = below.isMerged ? below.master : below;
      }
    });
  }
  return fields;
}

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
  opts: { currencyLabel?: string; footer?: ClientFooter } = {},
): Promise<{ buffer: Buffer; filled: number; unplaced: number }> {
  const workbook = await loadWorkbookTolerant(source);
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("Le fichier d'origine ne contient aucune feuille.");

  const located = locateTable(ws);
  if (!located) throw new Error("Impossible de retrouver le tableau d'articles dans le fichier d'origine.");
  const { headerRowNumber, table } = located;
  const columns = locateClientColumns(table.headerRow);
  const fields = opts.footer ? findSupplierFields(ws, headerRowNumber) : {};

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
  // Si le fichier a un champ « CURRENCY », la devise y est écrite : on ne touche pas à l'en-tête de la colonne des prix.
  if (opts.currencyLabel && !fields.currency) {
    const header = headerCellAt(priceCol);
    const current = String(header.value ?? "").trim();
    if (!current.toUpperCase().includes(opts.currencyLabel.toUpperCase())) header.value = `${current || "Unit Price"} (${opts.currencyLabel})`;
  }

  let filled = 0;
  let unplaced = 0;
  let lastExportedRow = headerRowNumber;
  for (const item of items) {
    if (item.sourceRow !== undefined && item.sourceRow > lastExportedRow) lastExportedRow = item.sourceRow;
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
    const price = roundMoney(item.unitPrice);
    cell.value = price;
    if (columns.unitPrice === -1) cell.style = clone(row.getCell(styleFromCol).style);
    cell.numFmt = numFmtFor(cell.numFmt, price);

    if (columns.total !== -1) {
      const totalCell = row.getCell(columns.total + 1);
      if (isEmptyCell(totalCell.value)) {
        const lineTotal = roundMoney(price * item.quantity);
        totalCell.value = lineTotal;
        totalCell.numFmt = numFmtFor(totalCell.numFmt, lineTotal);
      }
    }
    filled++;
  }

  // Le tableau s'arrête au dernier article exporté : les lignes numérotées restées vides en dessous (gabarit du
  // client prévu pour plus d'articles) sont masquées. On ne supprime pas de lignes : cela décalerait les cellules
  // fusionnées du pied de page du client.
  if (columns.rawDescription !== -1 && lastExportedRow > headerRowNumber) {
    const lastTableRow = Math.max(...(table.dataRowNumbers ?? [lastExportedRow]));
    const lastTableCol = Math.max(priceCol, columns.total + 1, columns.quantity + 1, columns.rawDescription + 1);
    for (let r = lastExportedRow + 1; r <= lastTableRow; r++) {
      const row = ws.getRow(r);
      // Emplacement vide = aucun texte dans les colonnes du tableau (seulement un numéro de ligne préimprimé ou une
      // formule). Une ligne de pied de page (« Grand Total », « Discount »...) porte un libellé : on n'y touche pas.
      let blankSlot = true;
      for (let c = 1; c <= lastTableCol && blankSlot; c++) {
        const v = row.getCell(c).value;
        if (typeof v === "string" && v.trim() !== "") blankSlot = false;
        else if (v !== null && v !== undefined && typeof v === "object" && !("formula" in v) && !("sharedFormula" in v)) blankSlot = false;
      }
      if (!blankSlot) continue;
      // Plus aucune bordure, ni numéro, ni formule dans les colonnes du tableau : il ne se prolonge pas au-delà des
      // articles. Les colonnes situées à droite du tableau (listes de choix, devises...) ne sont pas touchées.
      for (let c = 1; c <= lastTableCol; c++) {
        const cell = row.getCell(c);
        cell.value = null;
        cell.style = {};
      }
      row.hidden = true;
    }
  }

  // Préparation impression : la feuille d'origine est ramenée à la largeur d'une page A4.
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
    printArea: `A1:${ws.getColumn(Math.max(ws.columnCount, priceCol)).letter}${Math.max(ws.rowCount, headerRowNumber)}`,
  };
  ws.pageSetup.scale = undefined;
  workbook.calcProperties.fullCalcOnLoad = true;
  // Propriétés absentes des typings d'ExcelJS (types incomplets) : on les pose via un cast.
  Object.assign(workbook.calcProperties as object, { forceFullCalc: true, calcMode: "auto" });

  if (opts.footer) {
    const { discountPercent, transportFee, currency } = opts.footer;
    const fee = transportFee && transportFee > 0 ? roundMoney(transportFee) : 0;
    const hasPrices = items.some((it) => it.unitPrice !== undefined);

    // 1) Champs prévus par le fichier du client : remise, frais de livraison, devise. Les formules du fichier
    //    (remise par ligne, total, grand total) s'en servent, les prix unitaires écrits sont donc bruts.
    let discountDone = discountPercent <= 0;
    let feeDone = false; // les frais de transport sont toujours affichés, même à 0
    if (hasPrices) {
      if (fields.discount && discountPercent > 0) {
        fields.discount.value = discountPercent / 100; // les formules attendent une fraction (10 % = 0,1)
        if (!fields.discount.numFmt || fields.discount.numFmt === "General") fields.discount.numFmt = "0.0%";
        discountDone = true;
      }
      if (fields.delivery) {
        fields.delivery.value = fee;
        fields.delivery.numFmt = numFmtFor(fields.delivery.numFmt, fee);
        feeDone = true;
      }
      if (fields.currency && currency) fields.currency.value = currency.toUpperCase();
    }

    // 2) Sinon (fichier sans ces champs) : récapitulatif sous le tableau.
    if (hasPrices && (!discountDone || !feeDone)) {
      const gross = roundMoney(
        items.reduce((sum, it) => (it.unitPrice === undefined ? sum : sum + roundMoney(roundMoney(it.unitPrice) * it.quantity)), 0),
      );
      const discount = discountDone ? 0 : roundMoney((gross * discountPercent) / 100);
      const net = roundMoney(gross - discount + (feeDone ? 0 : fee));
      const cur = currency ? ` ${currency}` : "";

      const lines: [string, number][] = [[`GROSS TOTAL${cur}`, gross]];
      if (!discountDone) lines.push([`DISCOUNT ${discountPercent}%`, -discount]);
      if (!feeDone) lines.push(["(+) DELIVERY + LAUNCH SERVICE", fee]);
      lines.push([`TOTAL NET${cur}`, net]);

      // Emplacement : juste sous le dernier article si les lignes sont libres, sinon tout en bas de la feuille
      // (on ne décale jamais de lignes : cela casserait les cellules fusionnées du pied de page du client).
      const lastItemRow = Math.max(headerRowNumber, ...(table.dataRowNumbers ?? []));
      const merged = Object.values((ws as unknown as { _merges: Record<string, { model: { top: number; bottom: number } }> })._merges ?? {}).map((m) => m.model);
      const isFree = (rowNumber: number) =>
        !ws.getRow(rowNumber).hasValues && !merged.some((m) => rowNumber >= m.top && rowNumber <= m.bottom);
      let start = lastItemRow + 2;
      for (let i = 0; i < lines.length; i++) {
        if (!isFree(start + i)) { start = ws.rowCount + 2; break; }
      }

      const labelCol = columns.rawDescription !== -1 ? columns.rawDescription + 1 : 1;
      const amountCol = columns.total !== -1 ? columns.total + 1 : priceCol;
      lines.forEach(([label, amount], i) => {
        const row = ws.getRow(start + i);
        const isNet = i === lines.length - 1;
        const labelCell = row.getCell(labelCol);
        labelCell.value = label;
        labelCell.font = { bold: true };
        labelCell.alignment = { horizontal: "right" };
        const amountCell = row.getCell(amountCol);
        amountCell.value = amount;
        amountCell.numFmt = numFmtFor(undefined, amount);
        amountCell.font = { bold: true };
        if (isNet) {
          labelCell.border = { top: { style: "thin" } };
          amountCell.border = { top: { style: "thin" } };
        }
        row.commit();
      });
    }
  }

  // Les formules du fichier du client gardent le résultat périmé du fichier d'origine : on les recalcule ici, et on
  // demande aussi à Excel de tout recalculer à l'ouverture.
  recalculateWorkbook(workbook);
  workbook.eachSheet((sheet) => adaptNumberFormats(sheet));
  workbook.calcProperties.fullCalcOnLoad = true;
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filled, unplaced };
}
