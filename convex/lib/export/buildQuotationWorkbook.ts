"use node";

import ExcelJS from "exceljs";
import { QUOTATION_TEMPLATE_BASE64 } from "./templateData";
import { QUOTATION_LOGO_PNG_BASE64 } from "./logoData";
import { moneyNumFmt, roundMoney } from "../pricing";
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

/** Coordonnées de l'entreprise, affichées à droite du logo (réglage « companyInfo » de l'entreprise). */
export interface ExportCompany {
  name?: string;
  address?: string;
  /** Ligne « BP : … ville, pays ». */
  postal?: string;
  email?: string;
  phones?: string;
  website?: string;
}

export interface ExportData {
  reference: string;
  currency: string;
  /** Texte du bandeau « REQUEST FOR … » (ex. QUOTATION, PROVISIONS, MATERIAL). */
  requestFor: string;
  country?: string;
  deliveryPort?: string;
  vessel?: string;
  eta?: string;
  /** Référence de la demande (case « REF NO »). */
  refNo?: string;
  company: ExportCompany;
  /** Global discount in percent, applied on the total of the whole order. */
  discountPercent: number;
  /** Frais de livraison / mise à l'eau, dans la devise du fichier : ajoutés après le discount quand ils sont définis (> 0). */
  transportFee?: number;
  items: ExportItem[];
}

// Layout of the embedded template (see templateData.ts): header rows 1-16, one model item row (17),
// then the totals block on rows 18-21 and, in the template, the conditions/contacts boxes on rows 22-29.
// Columns: A N°, B CODE, C DESCRIPTION, D UNIT, E QUANTITY, F PRICE UNIT, G TOTAL AMOUNT, H REMARKS.
// Les deux encadrés du bas du gabarit (conditions et contacts) ne sont pas repris : l'en-tête est reconstruit (logo à
// gauche, coordonnées de l'entreprise à sa droite, grille Country / Delivery port / Vessel / ETA et Ref / conditions,
// mention en rouge, bandeau « REQUEST FOR … ») ; seuls les totaux restent sous le tableau.
const FIRST_ITEM_ROW = 17;
const FOOTER_FIRST = 18;
const FOOTER_LAST = 21;
const TEMPLATE_LAST = 29;
const COLS = 8;
// En-tête : coordonnées de l'entreprise sur les lignes 2 à 7 (colonnes C-D, à droite du logo) ; grille de la demande
// sur les lignes 3 à 6 (libellés en E et G, valeurs en F et H).
const HEADER_FIRST_LINE = 2;
const NOTICE_ROW = 10;
const TITLE_ROW = 13;
// Logo : carré, posé à gauche (colonnes A-B), à hauteur des 6 lignes.
const LOGO_SIZE_PX = 150;
const LOGO_LEFT_PX = 16;
const LOGO_TOP_PX = 6;

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
  ws.unMergeCells(`B${TITLE_ROW}:H${TITLE_ROW}`);
  ws.unMergeCells("B15:H15");
  for (let r = FIRST_ITEM_ROW; r <= TEMPLATE_LAST; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= COLS; c++) {
      const cell = row.getCell(c);
      cell.value = null;
      cell.style = {};
    }
  }

  // --- en-tête : coordonnées de l'entreprise à droite du logo
  const plain: Partial<ExcelJS.Font> = { name: "Calibri", size: 10, color: { argb: "FF000000" } };
  const bold: Partial<ExcelJS.Font> = { ...plain, bold: true };
  const company = data.company;
  const companyLines: Array<{ value: string; link?: boolean }> = [];
  const addLine = (value: string | undefined, link = false) => {
    if (value && value.trim()) companyLines.push({ value: value.trim(), link });
  };
  addLine(company.name);
  addLine(company.address);
  addLine(company.postal);
  addLine(company.email ? `Email : ${company.email.trim()}` : undefined);
  addLine(company.phones ? `Operation Dept : ${company.phones.trim()}` : undefined);
  addLine(company.website, true);
  companyLines.forEach((line, i) => {
    const r = HEADER_FIRST_LINE + i;
    ws.mergeCells(`C${r}:D${r}`);
    const cell = ws.getCell(`C${r}`);
    cell.value = line.link ? { text: line.value, hyperlink: line.value } : line.value;
    cell.font = line.link ? { ...plain, underline: true, color: { argb: "FF0563C1" } } : bold;
    cell.alignment = { horizontal: "left", vertical: "middle" };
  });

  // --- grille de la demande : libellé (E, G) + valeur en gras (F, H) ; conditions laissées vides pour le fournisseur
  const upper = (text?: string) => (text?.trim() ? text.trim().toUpperCase() : "");
  const grid: Array<[string, string, string, string]> = [
    ["COUNTRY :", upper(data.country), "REF NO:", data.refNo?.trim() ?? ""],
    ["DELIVERY PORT :", upper(data.deliveryPort), "Payment terms:", ""],
    ["VESSEL NAME :", upper(data.vessel), "Delivery time:", ""],
    ["ETA :", formatDate(data.eta) ?? "", "Offer Validity :", ""],
  ];
  grid.forEach(([leftLabel, leftValue, rightLabel, rightValue], i) => {
    const r = HEADER_FIRST_LINE + 1 + i;
    const cells: Array<[string, string, boolean]> = [["E", leftLabel, false], ["F", leftValue, true], ["G", rightLabel, false], ["H", rightValue, true]];
    for (const [col, text, isValue] of cells) {
      const cell = ws.getCell(`${col}${r}`);
      cell.value = text || null;
      cell.font = isValue ? bold : plain;
      cell.alignment = { horizontal: "left", vertical: "middle" };
    }
  });

  // --- mention en rouge, sous le bloc d'en-tête
  ws.mergeCells(`C${NOTICE_ROW}:G${NOTICE_ROW}`);
  const notice = ws.getCell(`C${NOTICE_ROW}`);
  notice.value = "PLEASE USE OUR OWN FORMAT";
  notice.font = { name: "Calibri", size: 16, color: { argb: "FFFF0000" } };
  notice.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(NOTICE_ROW).height = 26;

  // --- bandeau titre « REQUEST FOR … » sur toute la largeur (teinte claire du vert de l'en-tête du tableau)
  ws.mergeCells(`A${TITLE_ROW}:H${TITLE_ROW}`);
  for (let c = 1; c <= COLS; c++) {
    ws.getRow(TITLE_ROW).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3ECB9" } };
  }
  const title = ws.getCell(`A${TITLE_ROW}`);
  title.value = `REQUEST FOR ${(data.requestFor.trim() || "QUOTATION").toUpperCase()}`;
  title.font = { name: "Arial", size: 14, bold: true, color: { argb: "FF000000" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(TITLE_ROW).height = 24;
  // Lignes 14 et 15 (espace sous le bandeau, ancienne ligne « Request for … ») : vides, sans fond ni bordure hérités du gabarit.
  for (const blankRow of [14, 15]) {
    for (let c = 1; c <= COLS; c++) {
      const cell = ws.getRow(blankRow).getCell(c);
      cell.value = null;
      cell.style = {};
    }
  }

  // --- logo : l'image du gabarit (slogan + logo) est remplacée par le logo seul, à gauche des 6 lignes
  (ws as unknown as { _media: unknown[] })._media = [];
  (workbook as unknown as { media: unknown[] }).media = [];
  const logoId = workbook.addImage({ base64: QUOTATION_LOGO_PNG_BASE64, extension: "png" });
  // Ancrage exact (colonne A + décalage en EMU, 9525 EMU par pixel), taille fixe en pixels.
  const logoAnchor = { nativeCol: 0, nativeColOff: LOGO_LEFT_PX * 9525, nativeRow: 0, nativeRowOff: LOGO_TOP_PX * 9525 };
  ws.addImage(logoId, { tl: logoAnchor as unknown as ExcelJS.Anchor, ext: { width: LOGO_SIZE_PX, height: LOGO_SIZE_PX }, editAs: "oneCell" });

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
      // Montants (prix unitaire F, total de ligne G) : toujours 2 décimales.
      if ((c === 5 || c === 6) && style.numFmt) style.numFmt = moneyNumFmt(style.numFmt);
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
  // Bloc des totaux entièrement fermé : libellé (E-F) et montant (G) encadrés sur leurs quatre côtés, y compris le côté droit.
  const thin: Partial<ExcelJS.Border> = { style: "thin" };
  const boxed: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
  for (let i = F_GROSS; i <= F_NET; i++) {
    for (const col of ["E", "F", "G"]) ws.getCell(`${col}${at(i)}`).border = boxed;
  }

  // Montants du pied de page : toujours 2 décimales.
  for (const rowNumber of [at(F_GROSS), discountRow, at(F_TRANSPORT), at(F_NET)]) {
    const cell = ws.getCell(`G${rowNumber}`);
    if (cell.numFmt) cell.numFmt = moneyNumFmt(cell.numFmt);
  }

  for (const m of footerMerges) {
    // La ligne de remise doit garder E = libellé et F = cellule de pourcentage modifiable.
    if (m === "E19:F19") continue;
    ws.mergeCells(m.replace(/\d+/g, (n) => String(footerStart + parseInt(n, 10) - FOOTER_FIRST)));
  }

  // Aucun quadrillage à l'écran hors du tableau : seules les bordures des cellules du tableau restent visibles.
  ws.views = [{ ...(ws.views[0] ?? {}), showGridLines: false } as ExcelJS.WorksheetView];

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
