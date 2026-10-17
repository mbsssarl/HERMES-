"use node";

import ExcelJS from "exceljs";
import { QUOTATION_TEMPLATE_BASE64 } from "./templateData";
import { adaptiveNumFmt, roundMoney } from "../pricing";
import { adaptNumberFormats } from "./numberFormats";

export interface ExportItem {
  code?: string;
  description: string;
  unit?: string;
  quantity: number;
  /** Unit price after cotation, before discount (the "PRICE UNIT" column). Undefined = not priced. */
  unitPrice?: number;
  remarks?: string;
}

export interface ExportData {
  reference: string;
  currency: string;
  vessel?: string;
  eta?: string;
  port?: string;
  /** Ville du pays de cotation (voir countries.city) : prioritaire sur `port` pour le titre d'en-tête. */
  city?: string;
  /** Texte après « Request for » (ex. Provisions, Material). Chaîne vide = ligne laissée vide ; absent = gabarit. */
  category?: string;
  /** Lieu de livraison écrit tel quel dans « SUPPLY AT … » (sinon : ville du pays, puis lieu de la commande + PORT). */
  placeText?: string;
  paymentDays?: string;
  /** Global discount in percent, applied on the total of the whole order. */
  discountPercent: number;
  /** Frais de livraison / mise à l'eau, dans la devise du fichier : ajoutés après le discount quand ils sont définis (> 0). */
  transportFee?: number;
  items: ExportItem[];
}

// Layout of the embedded template (see templateData.ts): header rows 1-16, one model item row (17),
// then the totals block on rows 18-21 and, in the template, the conditions/contacts boxes on rows 22-29.
// Columns: A N°, B CODE, C DESCRIPTION, D UNIT, E QUANTITY, F PRICE UNIT, G TOTAL AMOUNT, H REMARKS.
// Ces deux encadrés du bas (Payment Time / Delivery time / Offer Validity et Contacts) sont repris en EN-TÊTE,
// à gauche du logo : seuls les totaux restent sous le tableau.
const FIRST_ITEM_ROW = 17;
const FOOTER_FIRST = 18;
const FOOTER_LAST = 21;
const TEMPLATE_LAST = 29;
const COLS = 8;
// En-tête : une ligne par élément, de la ligne 2 à la ligne 7, dans les colonnes B à D.
const HEADER_FIRST_LINE = 2;

// Footer rows, relative to FOOTER_FIRST.
const F_GROSS = 0;
const F_DISCOUNT = 1;
const F_TRANSPORT = 2;
const F_NET = 3;


type CellStyle = Partial<ExcelJS.Style>;
interface CapturedCell {
  value: ExcelJS.CellValue;
  style: CellStyle;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function formatDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** "ENGINE STORES" -> "Engine Stores" */
function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * Nombre de lignes qu'occupe un texte retourné à la ligne dans une colonne de `width` (unités Excel, police 10 pt :
 * environ 1 caractère par unité). Sert à agrandir la ligne : Excel ne le fait pas seul quand une hauteur est fixée.
 */
function wrappedLines(text: string, width: number): number {
  const perLine = Math.max(Math.floor(width), 1);
  return text.split(/\r?\n/).reduce((total, paragraph) => {
    // Retour à la ligne par mots : on simule le découpage plutôt que de diviser la longueur (un mot long déborde).
    let lines = 1;
    let used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let len = word.length;
      if (used > 0 && used + 1 + len <= perLine) { used += 1 + len; continue; }
      if (used > 0) { lines++; used = 0; }
      while (len > perLine) { lines++; len -= perLine; }
      used = len;
    }
    return total + lines;
  }, 0);
}

/** Largeur et hauteur d'un PNG, lues dans son en-tête (octets 16 à 23) ; undefined si ce n'est pas un PNG. */
function pngSize(buffer: Uint8Array | undefined): { width: number; height: number } | undefined {
  if (!buffer || buffer.length < 24) return undefined;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0) !== 0x89504e47) return undefined;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Largeur d'une colonne Excel en pixels (police par défaut : 7 px par unité + 5 px de marge). */
const columnPx = (width: number | undefined) => Math.round((width ?? 8.43) * 7 + 5);

function currencyFormat(format: string | undefined, currency: string): string | undefined {
  if (!format) return format;
  const safe = currency.replace(/[\[\]"]/g, "");
  return format.replace(/\[\$[^\]]*\]/, `[$${safe}]`);
}

/**
 * Builds the exported quotation by filling the exact MBSS template: same letterhead, title, table
 * styling, totals block and contacts. Only the data changes: the header line (port / ETA / vessel),
 * the article rows, and the totals (gross, discount, transportation, net).
 */
export async function buildQuotationWorkbook(data: ExportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(QUOTATION_TEMPLATE_BASE64, "base64") as unknown as ArrayBuffer);
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("Gabarit d'export invalide.");

  // --- capture the model item row and the footer block before touching anything
  const captureRow = (rowNumber: number): CapturedCell[] => {
    const row = ws.getRow(rowNumber);
    const cells: CapturedCell[] = [];
    for (let c = 1; c <= COLS; c++) {
      const cell = row.getCell(c);
      cells.push({ value: clone(cell.value), style: clone(cell.style) });
    }
    return cells;
  };
  // Conditions et contacts du gabarit, repris tels quels (libellés, courriel, téléphone, site) dans l'en-tête.
  const labelOf = (address: string, fallback: string) => String(ws.getCell(address).value ?? fallback).trim() || fallback;
  const conditions = {
    payment: labelOf("B24", "Payment Time:"),
    delivery: labelOf("B27", "Delivery time:"),
    validity: labelOf("B29", "Offer Validity :"),
  };
  const contacts = {
    mail: clone(ws.getCell("G24").value),
    operation: clone(ws.getCell("G26").value),
    site: clone(ws.getCell("G29").value),
  };
  const itemModel = captureRow(FIRST_ITEM_ROW);
  const itemHeight = ws.getRow(FIRST_ITEM_ROW).height;
  const footer: { cells: CapturedCell[]; height?: number }[] = [];
  for (let r = FOOTER_FIRST; r <= FOOTER_LAST; r++) {
    footer.push({ cells: captureRow(r), height: ws.getRow(r).height });
  }
  const rowOfMerge = (m: string) => parseInt(m.replace(/^[A-Z]+/, ""), 10);
  const templateMerges = (ws.model.merges as string[]).filter((m) => rowOfMerge(m) >= FOOTER_FIRST);
  const footerMerges = templateMerges.filter((m) => rowOfMerge(m) <= FOOTER_LAST);

  // --- clear the model rows (articles, totaux et anciens encadrés du bas)
  for (const m of templateMerges) ws.unMergeCells(m);
  ws.unMergeCells("A1:H12");
  for (let r = FIRST_ITEM_ROW; r <= TEMPLATE_LAST; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= COLS; c++) {
      const cell = row.getCell(c);
      cell.value = null;
      cell.style = {};
    }
  }

  // --- header lines
  // La ville du pays de cotation prime sur le lieu de livraison en texte libre (souvent un placeholder non
  // renseigné, ex. "DELIVERY PORT") : "SUPPLY AT ABIDJAN" plutôt que "SUPPLY AT DELIVERY PORT PORT".
  const customPlace = data.placeText?.trim();
  const place = data.placeText !== undefined
    ? (customPlace ? customPlace.toUpperCase() : undefined)
    : data.city ? data.city.toUpperCase() : (data.port ? `${data.port.toUpperCase()} PORT` : undefined);
  const vesselName = data.vessel?.trim();
  const supplies = ["SUPPLY AT", place, formatDate(data.eta) ? `ETA ${formatDate(data.eta)}` : undefined, vesselName ? `${vesselName.toUpperCase()} VESSEL` : undefined]
    .filter(Boolean)
    .join(" ");
  ws.getCell("B13").value = supplies;
  // The band uses the light tint of the table header's green (the template's own theme colour is orange).
  for (let c = 2; c <= COLS; c++) {
    ws.getRow(13).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3ECB9" } };
  }
  if (data.category !== undefined) ws.getCell("B15").value = data.category.trim() ? `Request for ${titleCase(data.category.trim())}` : null;

  // --- en-tête : les 6 éléments (conditions puis contacts), une ligne chacun, à gauche
  const plain: Partial<ExcelJS.Font> = { name: "Calibri", size: 10, color: { argb: "FF000000" } };
  const bold: Partial<ExcelJS.Font> = { ...plain, bold: true };
  const headerLines: ExcelJS.CellValue[] = [
    { richText: [{ font: bold, text: conditions.payment }, { font: plain, text: data.paymentDays ? ` ${data.paymentDays}` : "" }] },
    { richText: [{ font: bold, text: conditions.delivery }] },
    { richText: [{ font: bold, text: conditions.validity }] },
    contacts.mail as ExcelJS.CellValue,
    contacts.operation as ExcelJS.CellValue,
    contacts.site as ExcelJS.CellValue,
  ];
  headerLines.forEach((value, i) => {
    const r = HEADER_FIRST_LINE + i;
    ws.mergeCells(`B${r}:D${r}`);
    const cell = ws.getCell(`B${r}`);
    cell.value = value;
    const isLink = typeof value === "object" && value !== null && "hyperlink" in value;
    // Courriel : libellé en gras (déjà dans le texte riche) ; lien : bleu souligné ; téléphone : tout en gras.
    cell.font = isLink ? { ...plain, underline: true, color: { argb: "FF0563C1" } } : i === 4 ? bold : plain;
    cell.alignment = { horizontal: "left", vertical: "middle" };
  });

  // --- logo : même image, reculée à droite (alignée sur le bord droit du tableau) ; elle était centrée sur C-G
  const letterhead = ws.getImages()[0];
  if (letterhead) {
    const size = pngSize(workbook.getImage(Number(letterhead.imageId))?.buffer as Uint8Array | undefined);
    const height = 128; // hauteur d'origine (lignes 3 à 9)
    const width = size ? Math.round((height * size.width) / size.height) : 384;
    const widths = Array.from({ length: COLS }, (_, i) => columnPx(ws.getColumn(i + 1).width));
    const total = widths.reduce((a, b) => a + b, 0);
    let x = Math.max(total - width - 8, 0); // position horizontale du coin haut-gauche, en pixels
    let col = 0;
    while (col < COLS - 1 && x >= widths[col]) { x -= widths[col]; col++; }
    // L'image du gabarit est ré-ancrée : on retire l'ancienne puis on pose la même image à sa nouvelle place.
    (ws as unknown as { _media: unknown[] })._media = [];
    // Ancrage exact (colonne + décalage en EMU, 9525 EMU par pixel) : une position fractionnaire serait approximative.
    const anchor = { nativeCol: col, nativeColOff: Math.round(x * 9525), nativeRow: 2, nativeRowOff: 0 };
    ws.addImage(Number(letterhead.imageId), { tl: anchor as unknown as ExcelJS.Anchor, ext: { width, height }, editAs: "oneCell" });
  }

  // --- article rows
  const currency = data.currency;
  let row = FIRST_ITEM_ROW;
  let gross = 0;

  data.items.forEach((item, index) => {
    const r = ws.getRow(row);
    const unitPrice = item.unitPrice !== undefined ? roundMoney(item.unitPrice) : undefined;
    const lineGross = item.unitPrice !== undefined ? roundMoney(item.unitPrice * item.quantity) : 0;
    if (unitPrice !== undefined) {
      gross += lineGross;
    }

    const values: ExcelJS.CellValue[] = [
      index + 1,
      item.code ?? "",
      item.description,
      item.unit ?? "",
      item.quantity,
      unitPrice ?? null,
      { formula: `F${row}*E${row}`, result: lineGross },
      item.remarks ?? "",
    ];
    for (let c = 0; c < COLS; c++) {
      const cell = r.getCell(c + 1);
      cell.value = values[c];
      const style = clone(itemModel[c].style);
      if (style.numFmt) style.numFmt = currencyFormat(style.numFmt, currency);
      // Décimales seulement quand elles existent (pas de « 1,00 ») : prix unitaire (F) et total de ligne (G).
      if (c === 5 && style.numFmt) style.numFmt = adaptiveNumFmt(style.numFmt, unitPrice);
      if (c === 6 && style.numFmt) style.numFmt = adaptiveNumFmt(style.numFmt, lineGross);
      cell.style = style;
    }
    // La hauteur du gabarit (une seule ligne) coupait les noms longs : elle s'adapte au texte le plus long de la ligne
    // (code, description, unité, remarques), avec la hauteur du gabarit comme minimum.
    const textLines = Math.max(
      wrappedLines(String(values[1] ?? ""), ws.getColumn(2).width ?? 16),
      wrappedLines(String(values[2] ?? ""), ws.getColumn(3).width ?? 57),
      wrappedLines(String(values[3] ?? ""), ws.getColumn(4).width ?? 14),
      wrappedLines(String(values[7] ?? ""), ws.getColumn(8).width ?? 56),
    );
    r.height = Math.max(itemHeight ?? 16.5, textLines * 13.5 + 4);
    row++;
  });

  const lastItemRow = row - 1;
  const footerStart = row;
  gross = roundMoney(gross);
  const discountAmount = roundMoney((gross * data.discountPercent) / 100);
  // La ligne « (+) DELIVERY + LAUNCH SERVICE » est toujours affichée, même à 0.
  const fee = data.transportFee && data.transportFee > 0 ? roundMoney(data.transportFee) : 0;

  // --- footer block, copied below the last article
  footer.forEach((f, i) => {
    const r = ws.getRow(footerStart + i);
    f.cells.forEach((captured, c) => {
      const cell = r.getCell(c + 1);
      let value = captured.value;
      if (typeof value === "string") value = value.replace(/USD/g, currency);
      cell.value = value;
      const style = clone(captured.style);
      if (style.numFmt) style.numFmt = currencyFormat(style.numFmt, currency);
      cell.style = style;
    });
    if (f.height) r.height = f.height;
  });

  const at = (i: number) => footerStart + i;
  ws.getCell(`G${at(F_GROSS)}`).value = {
    formula: data.items.length > 0 ? `SUM(G${FIRST_ITEM_ROW}:G${lastItemRow})` : "0",
    result: gross,
  };
  const discountRow = at(F_DISCOUNT);
  ws.getCell(`E${discountRow}`).value = "DISCOUNT";
  ws.getCell(`F${discountRow}`).value = data.discountPercent / 100;
  ws.getCell(`F${discountRow}`).numFmt = "0%";
  ws.getCell(`F${discountRow}`).alignment = { horizontal: "center" };
  ws.getCell(`F${discountRow}`).style = { ...clone(ws.getCell(`E${discountRow}`).style), numFmt: "0%", alignment: { horizontal: "center" } };
  ws.getCell(`G${discountRow}`).value = { formula: `G${at(F_GROSS)}*F${discountRow}`, result: discountAmount };
  ws.getCell(`E${at(F_TRANSPORT)}`).value = "(+) DELIVERY + LAUNCH SERVICE";
  ws.getCell(`G${at(F_TRANSPORT)}`).value = fee;
  ws.getCell(`G${at(F_NET)}`).value = {
    formula: `G${at(F_GROSS)}-G${at(F_DISCOUNT)}+G${at(F_TRANSPORT)}`,
    result: roundMoney(gross - discountAmount + fee),
  };
  // Montants du pied de page : décimales seulement quand elles existent.
  const adaptG = (rowNumber: number, amount: number) => {
    const cell = ws.getCell(`G${rowNumber}`);
    if (cell.numFmt) cell.numFmt = adaptiveNumFmt(cell.numFmt, amount);
  };
  adaptG(at(F_GROSS), gross);
  adaptG(discountRow, discountAmount);
  adaptG(at(F_TRANSPORT), fee);
  adaptG(at(F_NET), roundMoney(gross - discountAmount + fee));

  for (const m of footerMerges) {
    // La ligne de remise doit garder E = libellé et F = cellule de pourcentage modifiable.
    if (m === "E19:F19") continue;
    ws.mergeCells(m.replace(/\d+/g, (n) => String(footerStart + parseInt(n, 10) - FOOTER_FIRST)));
  }

  // Impression compacte : A4 paysage, une page en largeur, hauteur libre pour conserver la lisibilité.
  ws.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
    printArea: `A1:H${Math.max(footerStart + FOOTER_LAST - FOOTER_FIRST, lastItemRow)}`,
  };
  ws.pageSetup.scale = undefined;
  workbook.calcProperties.fullCalcOnLoad = true;
  // Propriétés absentes des typings d'ExcelJS (types incomplets) : on les pose via un cast.
  Object.assign(workbook.calcProperties as object, { forceFullCalc: true, calcMode: "auto" });

  // Sheet name: quotation reference + date (Excel: 31 chars max, no []:*?/\).
  const today = new Date();
  const stamp = `${String(today.getDate()).padStart(2, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}-${today.getFullYear()}`;
  ws.name = `${data.reference}-${stamp}`.replace(/[\[\]:*?/\\]/g, "-").slice(0, 31);

  adaptNumberFormats(ws);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
