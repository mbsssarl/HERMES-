import ExcelJS from "exceljs";
import type { ExportData } from "./buildQuotationWorkbook";
import type { OrderExportData } from "./templateEngine";

/** Données fictives pour l'essai d'un modèle (bouton « Tester »). */
export const SAMPLE_EXPORT: ExportData = {
  reference: "Q-2026-0001",
  currency: "USD",
  requestFor: "PROVISIONS",
  country: "Côte d'Ivoire",
  deliveryPort: "Abidjan",
  vessel: "MV EXEMPLE",
  imo: "9000000",
  eta: new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10),
  refNo: "REF-001",
  company: { name: "Votre entreprise", address: "Rue du Port", postal: "BP 100, Douala, Cameroun", email: "contact@exemple.com", phones: "+237 600 000 000", website: "www.exemple.com" },
  discountPercent: 5,
  transportFee: 50,
  items: [
    { code: "A-100", description: "FARINE DE BLÉ 50 KG", unit: "BAG", quantity: 10, unitPrice: 32.5 },
    { code: "A-101", description: "HUILE DE CUISSON 20 L", unit: "TIN", quantity: 6, unitPrice: 41 },
    { code: "B-200", description: "TOMATES FRAÎCHES", unit: "KG", quantity: 40, remarks: "Prix à confirmer" },
    { code: "C-300", description: "EAU MINÉRALE 1,5 L (CARTON DE 12)", unit: "CTN", quantity: 25, unitPrice: 6.8 },
  ],
};

/** Données fictives pour l'essai d'un modèle de Purchase Order / Delivery Note. */
export const SAMPLE_ORDER_DOCUMENT: OrderExportData = {
  vessel: "MV EXEMPLE",
  agent: "Exemple Shipping Agency",
  port: "Abidjan",
  orderNo: "PO-2026-0001",
  rfqNo: "Q-2026-0001",
  supplyDate: new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10),
  category: "PROVISIONS",
  onBehalfName: "MV EXEMPLE",
  onBehalfAddress: "Owners / Charterers",
  currency: "USD",
  company: { name: "Votre entreprise", address: "Rue du Port", postal: "BP 100, Douala, Cameroun", email: "contact@exemple.com", phones: "+237 600 000 000", website: "www.exemple.com" },
  discountPercent: 5,
  items: [
    { code: "A-100", description: "FARINE DE BLÉ 50 KG", unit: "BAG", quantity: 10, unitPrice: 32.5 },
    { code: "A-101", description: "HUILE DE CUISSON 20 L", unit: "TIN", quantity: 6, unitPrice: 41 },
    { code: "C-300", description: "EAU MINÉRALE 1,5 L (CARTON DE 12)", unit: "CTN", quantity: 25, unitPrice: 6.8 },
  ],
};

/**
 * Modèle de départ, déjà balisé, pour un Purchase Order / Delivery Note : l'admin le télécharge, le met en forme
 * à sa façon en gardant les repères {{...}}, puis le réimporte. Même repère de prix sur les deux documents : un
 * modèle de Delivery Note laisse simplement {{item_unit_price}}/{{item_total}} vides à l'export (aucun prix transmis).
 */
export async function buildBaseOrderTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PO-DN", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 6 }, { width: 16 }, { width: 52 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 16 }];

  const thin: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF9CA3AF" } };
  const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
  const label = { font: { name: "Calibri", size: 10, bold: true, color: { argb: "FF374151" } } } as const;

  ws.mergeCells("A1:B5");
  ws.getCell("A1").value = "{{logo}}";
  const lines: [string, number, boolean][] = [["{{company_name}}", 1, true], ["{{company_address}}", 2, false], ["{{company_postal}}", 3, false], ["{{company_email}}", 4, false], ["{{company_phones}}", 5, false]];
  for (const [text, row, bold] of lines) {
    ws.mergeCells(`C${row}:G${row}`);
    const c = ws.getCell(`C${row}`);
    c.value = text;
    c.font = { name: "Calibri", size: bold ? 14 : 10, bold };
  }

  ws.mergeCells("A7:G7");
  const title = ws.getCell("A7");
  title.value = "PURCHASE ORDER / DELIVERY NOTE";
  title.font = { name: "Arial", size: 14, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3ECB9" } };
  ws.getRow(7).height = 24;

  const grid: [string, string, string, string][] = [
    ["Vessel name", "{{vessel}}", "Agent", "{{agent}}"],
    ["Delivery port", "{{port}}", "Supply date", "{{supply_date}}"],
    ["Order no", "{{order_no}}", "RFQ no", "{{rfq_no}}"],
    ["Category", "{{category}}", "On behalf", "{{on_behalf_name}}"],
  ];
  grid.forEach(([l1, v1, l2, v2], i) => {
    const r = 9 + i;
    ws.getCell(`A${r}`).value = l1; ws.getCell(`A${r}`).font = label.font;
    ws.getCell(`B${r}`).value = v1;
    ws.getCell(`E${r}`).value = l2; ws.getCell(`E${r}`).font = label.font;
    ws.getCell(`F${r}`).value = v2;
  });

  const head = ["NO", "CODE", "DESCRIPTION", "UNIT", "QTY", "UNIT PRICE", "TOTAL"];
  head.forEach((h, i) => {
    const c = ws.getRow(14).getCell(i + 1);
    c.value = h;
    c.font = { name: "Calibri", size: 10, bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3ECB9" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = box;
  });
  const model = ["{{item_no}}", "{{item_code}}", "{{item_description}}", "{{item_unit}}", "{{item_quantity}}", "{{item_unit_price}}", { formula: "F15*E15" }];
  model.forEach((v, i) => {
    const c = ws.getRow(15).getCell(i + 1);
    c.value = v as ExcelJS.CellValue;
    c.border = box;
    c.alignment = { vertical: "middle", wrapText: i === 2, horizontal: i === 0 || i === 3 ? "center" : i >= 4 && i <= 6 ? "right" : "left" };
    if (i === 5 || i === 6) c.numFmt = "#,##0.00";
  });

  const totals: [number, string, ExcelJS.CellValue][] = [
    [17, "SUBTOTAL", { formula: "SUM(G15:G15)" }],
    [18, "DISCOUNT (%)", { formula: "G17*F18/100" }],
    [19, "TOTAL", { formula: "G17-G18" }],
  ];
  for (const [r, text, value] of totals) {
    ws.mergeCells(`D${r}:E${r}`);
    ws.getCell(`D${r}`).value = text;
    ws.getCell(`D${r}`).font = { name: "Calibri", size: 10, bold: true };
    ws.getCell(`D${r}`).alignment = { horizontal: "right" };
    const g = ws.getCell(`G${r}`);
    g.value = value;
    g.numFmt = "#,##0.00";
    g.border = box;
    g.font = { name: "Calibri", size: 10, bold: r === 19 };
  }
  ws.getCell("F18").value = "{{discount_percent}}";
  ws.getCell("F18").border = box;
  ws.getCell("F18").alignment = { horizontal: "center" };

  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: "A1:G19" };

  for (let r = 15; r <= 19; r++) for (let c = 1; c <= 7; c++) ws.getRow(r).getCell(c).protection = { locked: false };
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Modèle de départ, déjà balisé : l'admin le télécharge, le met en forme à sa façon (couleurs, colonnes, texte) en
 * gardant les repères {{...}}, puis le réimporte.
 */
export async function buildBaseTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RFQ", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 6 }, { width: 16 }, { width: 52 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 34 }];

  const thin: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF9CA3AF" } };
  const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
  const label = { font: { name: "Calibri", size: 10, bold: true, color: { argb: "FF374151" } } } as const;

  // En-tête : logo à gauche, coordonnées à droite
  ws.mergeCells("A1:B5");
  ws.getCell("A1").value = "{{logo}}";
  const lines: [string, number, boolean][] = [["{{company_name}}", 1, true], ["{{company_address}}", 2, false], ["{{company_postal}}", 3, false], ["{{company_email}}", 4, false], ["{{company_phones}}", 5, false]];
  for (const [text, row, bold] of lines) {
    ws.mergeCells(`C${row}:H${row}`);
    const c = ws.getCell(`C${row}`);
    c.value = text;
    c.font = { name: "Calibri", size: bold ? 14 : 10, bold };
  }

  ws.mergeCells("A7:H7");
  const title = ws.getCell("A7");
  title.value = "REQUEST FOR {{request_for}}";
  title.font = { name: "Arial", size: 14, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3ECB9" } };
  ws.getRow(7).height = 24;

  const grid: [string, string, string, string][] = [
    ["Reference", "{{reference}}", "Date", "{{date}}"],
    ["Vessel", "{{vessel}}", "IMO", "{{vessel_imo}}"],
    ["Country", "{{country}}", "ETA", "{{eta}}"],
    ["Delivery port", "{{port}}", "Currency", "{{currency}}"],
  ];
  grid.forEach(([l1, v1, l2, v2], i) => {
    const r = 9 + i;
    ws.mergeCells(`A${r}:B${r}`); ws.mergeCells(`C${r}:D${r}`); ws.mergeCells(`E${r}:F${r}`); ws.mergeCells(`G${r}:H${r}`);
    ws.getCell(`A${r}`).value = l1; ws.getCell(`A${r}`).font = label.font;
    ws.getCell(`C${r}`).value = v1;
    ws.getCell(`E${r}`).value = l2; ws.getCell(`E${r}`).font = label.font;
    ws.getCell(`G${r}`).value = v2;
    ws.getCell(`G${r}`).alignment = { horizontal: "left" };
    ws.getCell(`C${r}`).alignment = { horizontal: "left" };
  });

  // Tableau : en-tête puis LIGNE MODÈLE (repétée pour chaque article)
  const head = ["NO", "CODE", "DESCRIPTION", "UNIT", "QTY", "UNIT PRICE", "TOTAL", "REMARKS"];
  head.forEach((h, i) => {
    const c = ws.getRow(14).getCell(i + 1);
    c.value = h;
    c.font = { name: "Calibri", size: 10, bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3ECB9" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = box;
  });
  const model = ["{{item_no}}", "{{item_code}}", "{{item_description}}", "{{item_unit}}", "{{item_quantity}}", "{{item_unit_price}}", { formula: "F15*E15" }, "{{item_remarks}}"];
  model.forEach((v, i) => {
    const c = ws.getRow(15).getCell(i + 1);
    c.value = v as ExcelJS.CellValue;
    c.border = box;
    c.alignment = { vertical: "middle", wrapText: i === 2 || i === 7, horizontal: i === 0 || i === 3 ? "center" : i >= 4 && i <= 6 ? "right" : "left" };
    if (i === 5 || i === 6) c.numFmt = "#,##0.00";
  });

  // Totaux : les formules suivent le tableau (SUM(G15:G15) s'étend à toutes les lignes)
  const totals: [number, string, ExcelJS.CellValue, string?][] = [
    [17, "SUBTOTAL", { formula: "SUM(G15:G15)" }],
    [18, "DISCOUNT (%)", { formula: "G17*F18/100" }],
    [19, "DELIVERY CHARGES", "{{transport}}"],
    [20, "TOTAL", { formula: "G17-G18+G19" }],
  ];
  for (const [r, text, value] of totals) {
    ws.mergeCells(`D${r}:E${r}`);
    ws.getCell(`D${r}`).value = text;
    ws.getCell(`D${r}`).font = { name: "Calibri", size: 10, bold: true };
    ws.getCell(`D${r}`).alignment = { horizontal: "right" };
    const g = ws.getCell(`G${r}`);
    g.value = value;
    g.numFmt = "#,##0.00";
    g.border = box;
    g.font = { name: "Calibri", size: 10, bold: r === 20 };
  }
  ws.getCell("F18").value = "{{discount_percent}}";
  ws.getCell("F18").border = box;
  ws.getCell("F18").alignment = { horizontal: "center" };

  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: "A1:H20" };

  // En-tête verrouillé ; seuls le tableau et les totaux restent modifiables (feuille protégée sans mot de passe).
  for (let r = 15; r <= 20; r++) for (let c = 1; c <= 8; c++) ws.getRow(r).getCell(c).protection = { locked: false };
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
