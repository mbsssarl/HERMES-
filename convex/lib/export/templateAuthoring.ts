import ExcelJS from "exceljs";
import { inspectTemplate, internals } from "./templateEngine";
import { ITEM_TOKENS, SCALAR_TOKENS } from "./templateTokens";

// ---------------------------------------------------------------------------------------------------------
// Préparation d'un fichier Excel QUELCONQUE comme modèle : l'application repère le tableau (ligne d'en-tête, colonnes,
// première et dernière ligne d'articles) et les cases d'information (« VESSEL NAME », « ETA »...), propose une
// association, puis (après correction par l'admin) écrit elle-même les repères {{...}} dans le fichier.
// ---------------------------------------------------------------------------------------------------------

export interface AnalysisColumn { col: string; header: string; sample: string; formula: boolean; token: string }
export interface AnalysisField { label: string; cell: string; current: string; token: string }
export interface AnalysisImage {
  index: number;
  /** Zone couverte par l'image, ex. « B2:C7 ». */
  range: string;
  /** Aperçu (data URL) quand l'image est assez légère. */
  thumbnail?: string;
}
export interface TemplateAnalysis {
  sheet: string;
  headerRow: number;
  modelRow: number;
  endRow: number;
  columns: AnalysisColumn[];
  fields: AnalysisField[];
  images: AnalysisImage[];
}
export interface TemplateMapping {
  sheet: string;
  /** Ligne d'articles conservée comme ligne modèle. */
  modelRow: number;
  /** Dernière ligne d'articles d'exemple : les lignes modelRow+1 à endRow sont supprimées. */
  endRow: number;
  /** Colonne (lettre) -> repère d'article ; absente ou vide = colonne ignorée (vidée, sauf formule). */
  columns: Record<string, string>;
  /** Cellules d'information -> repère. */
  fields: { cell: string; token: string }[];
  /** Sort de chaque image du fichier : conservée, retirée, ou remplacée par le logo de l'entreprise. */
  images?: { index: number; action: "keep" | "remove" | "logo" }[];
}

// PNG transparent de 1 x 1 pixel.
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const norm = (s: string): string =>
  s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9#° ]/g, " ").replace(/\s+/g, " ").trim();

/** Repère d'article suggéré par l'intitulé d'une colonne ("" = aucun). */
function suggestColumn(header: string): string {
  const t = norm(header);
  if (!t) return "";
  if (/\b(DISC|DISCOUNT|REMISE|CNV|CONV|LEAD|CREDIT|CURRENCY|DEVISE)\b/.test(t) && !/PRICE/.test(t)) return "";
  if (/\bRATE\b/.test(t) && !/PRICE|UNIT/.test(t)) return "";
  if (/\b(SUPPLIER|VENDOR|FOURNISSEUR|OFFER)\b/.test(t) && /\b(REMARK|REMARKS|NOTE|NOTES|COMMENT|COMMENTS)\b/.test(t)) return "";
  if (/\b(UNIT PRICE|PRICE|PRIX|COST|PU)\b/.test(t)) return "item_unit_price";
  if (/\b(AMOUNT|TOTAL|MONTANT|VALUE)\b/.test(t)) return "item_total";
  if (/\b(QTY|QUANTITY|QUANTITE|QTE|QTITE)\b/.test(t)) return "item_quantity";
  if (/\b(UNIT|UOM|UNITE|UN)\b/.test(t)) return "item_unit";
  if (/\b(REMARK|REMARKS|NOTE|NOTES|COMMENT|COMMENTS|REMARQUE|REMARQUES|OBSERVATION|OBSERVATIONS)\b/.test(t)) return "item_remarks";
  if (/\b(DESCRIPTION|DESIGNATION|ITEM NAME|PRODUCT|ARTICLE|LIBELLE|NAME)\b/.test(t)) return "item_description";
  if (/\b(CODE|IMPA|REF|REFERENCE|PART)\b/.test(t)) return "item_code";
  if (/^(NO|NR|NUM|N|#|SN|S N|SR NO|ITEM NO|ITEM|LINE|LN|N°)$/.test(t) || /\bNO\b/.test(t)) return "item_no";
  return "";
}

const FIELD_LABELS: Record<string, string> = {
  "VESSEL NAME": "vessel", VESSEL: "vessel", "SHIP NAME": "vessel", SHIP: "vessel", NAVIRE: "vessel",
  "VESSEL IMO": "vessel_imo", IMO: "vessel_imo", "IMO NO": "vessel_imo", "IMO NUMBER": "vessel_imo",
  "DELIVERY PORT": "port", PORT: "port", "SUPPLY AT": "port", "PORT OF DELIVERY": "port", "LIEU DE LIVRAISON": "port",
  ETA: "eta",
  "RFQ NO": "reference", "RFQ NUMBER": "reference", "REF NO": "reference", REFERENCE: "reference", "QUOTATION NO": "reference", "ENQUIRY NO": "reference", REF: "reference",
  DATE: "date", "RFQ DATE": "date", "ENQUIRY DATE": "date",
  COUNTRY: "country", PAYS: "country",
  COMPANY: "company_name", "COMPANY NAME": "company_name", FROM: "company_name",
  EMAIL: "company_email", "E MAIL": "company_email", MAIL: "company_email",
  PHONE: "company_phones", TEL: "company_phones", TELEPHONE: "company_phones", MOBILE: "company_phones",
  ADDRESS: "company_address", WEBSITE: "company_website", WEB: "company_website",
};

function textOf(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
  if (typeof o.text === "string") return o.text;
  if ("result" in o && (typeof o.result === "string" || typeof o.result === "number")) return String(o.result);
  return "";
}

const isFormula = (cell: ExcelJS.Cell): boolean => {
  const v = cell.value as unknown as { formula?: string; sharedFormula?: string } | null;
  return Boolean(v && typeof v === "object" && (v.formula || v.sharedFormula));
};
const isNumber = (cell: ExcelJS.Cell): boolean => typeof cell.value === "number";

function colLetters(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Zone de cellules (1-based) couverte par une image : de la cellule d'ancrage à celle où elle se termine. */
type SheetImage = { imageId: string | number; range: unknown };
const imagesOf = (ws: ExcelJS.Worksheet): SheetImage[] => ws.getImages() as unknown as SheetImage[];

function imageBox(ws: ExcelJS.Worksheet, image: SheetImage): { top: number; left: number; bottom: number; right: number } {
  const range = image.range as {
    tl: { nativeCol: number; nativeRow: number; nativeColOff?: number; nativeRowOff?: number };
    br?: { nativeCol: number; nativeRow: number; nativeColOff?: number; nativeRowOff?: number };
    ext?: { width: number; height: number };
  };
  const left = range.tl.nativeCol + 1;
  const top = range.tl.nativeRow + 1;
  if (range.br) {
    return {
      top,
      left,
      right: Math.max(left, range.br.nativeCol + (range.br.nativeColOff ? 1 : 0)),
      bottom: Math.max(top, range.br.nativeRow + (range.br.nativeRowOff ? 1 : 0)),
    };
  }
  let right = left;
  let remaining = (range.ext?.width ?? 0) - 0;
  for (let c = left; remaining > 0 && c < left + 40; c++) { remaining -= Math.round((ws.getColumn(c).width ?? 8.43) * 7 + 5); right = c; }
  let bottom = top;
  remaining = range.ext?.height ?? 0;
  for (let r = top; remaining > 0 && r < top + 200; r++) { remaining -= ((ws.getRow(r).height ?? 15) * 4) / 3; bottom = r; }
  return { top, left, right, bottom };
}

const rangeText = (b: { top: number; left: number; bottom: number; right: number }): string =>
  b.top === b.bottom && b.left === b.right ? `${colLetters(b.left)}${b.top}` : `${colLetters(b.left)}${b.top}:${colLetters(b.right)}${b.bottom}`;

function mergeMasterOf(ws: ExcelJS.Worksheet, cell: ExcelJS.Cell): ExcelJS.Cell {
  return cell.type === ExcelJS.ValueType.Merge ? cell.master : cell;
}

/** Cherche le tableau et les cases d'information d'un fichier sans repères. */
export async function analyzeTemplate(buffer: Buffer): Promise<TemplateAnalysis> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = workbook.worksheets.find((s) => s.state === "visible") ?? workbook.worksheets[0];
  if (!ws) throw new Error("Le classeur est vide.");
  const rowCount = ws.rowCount;

  // 1) ligne d'en-tête du tableau : celle qui a le plus d'intitulés de colonnes reconnus
  let headerRow = 0;
  let best = 0;
  for (let r = 1; r <= Math.min(rowCount, 80); r++) {
    let hits = 0;
    let hasDescription = false;
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      if (cell.type === ExcelJS.ValueType.Merge) return;
      const token = suggestColumn(textOf(cell));
      if (token) hits++;
      if (token === "item_description") hasDescription = true;
    });
    if (hasDescription && hits > best) { best = hits; headerRow = r; }
  }
  if (headerRow === 0 || best < 3) throw new Error("Impossible de repérer le tableau d'articles (ligne d'en-tête avec Description, Quantité, Prix...). Ajoutez les repères {{...}} à la main.");

  // 2) colonnes
  const headers: { col: number; header: string; token: string }[] = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, col) => {
    if (cell.type === ExcelJS.ValueType.Merge) return;
    const header = textOf(cell).trim();
    if (header) headers.push({ col, header, token: suggestColumn(header) });
  });
  const qtyCol = headers.find((h) => h.token === "item_quantity")?.col;
  const noCol = headers.find((h) => h.token === "item_no")?.col;

  // 3) première et dernière ligne d'articles (une ligne d'article a un numéro ou une quantité numérique)
  const isItem = (r: number): boolean =>
    (qtyCol !== undefined && isNumber(ws.getCell(r, qtyCol))) || (noCol !== undefined && isNumber(ws.getCell(r, noCol)));
  let modelRow = headerRow + 1;
  for (let r = headerRow + 1; r <= Math.min(rowCount, headerRow + 15); r++) if (isItem(r)) { modelRow = r; break; }
  let endRow = modelRow;
  let gap = 0;
  for (let r = modelRow + 1; r <= rowCount; r++) {
    if (isItem(r)) { endRow = r; gap = 0; } else if (++gap > 3) break;
  }

  const columns: AnalysisColumn[] = headers.map(({ col, header, token }) => {
    const sampleCell = ws.getCell(modelRow, col);
    const formula = isFormula(sampleCell);
    return { col: colLetters(col), header, sample: textOf(sampleCell).slice(0, 40), formula, token: formula ? "" : token };
  });

  // 4) cases d'information au-dessus du tableau : un intitulé connu, suivi de sa valeur à droite
  const fields: AnalysisField[] = [];
  const boxes = internals.mergeBoxes(ws);
  for (let r = 1; r < headerRow; r++) {
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      if (cell.type === ExcelJS.ValueType.Merge) return;
      const label = textOf(cell).trim();
      const token = FIELD_LABELS[norm(label)];
      if (!token) return;
      const box = boxes.find((b) => b.top === r && b.left === col);
      const valueCol = (box ? box.right : col) + 1;
      const target = mergeMasterOf(ws, ws.getCell(r, valueCol));
      fields.push({ label, cell: target.address, current: textOf(target).slice(0, 40), token });
    });
  }

  const images: AnalysisImage[] = imagesOf(ws).map((image, index) => {
    const media = workbook.getImage(Number(image.imageId)) as { buffer?: Buffer; extension?: string } | undefined;
    const small = media?.buffer && media.buffer.length <= 250_000;
    return {
      index,
      range: rangeText(imageBox(ws, image)),
      thumbnail: small ? `data:image/${media?.extension === "jpeg" || media?.extension === "jpg" ? "jpeg" : "png"};base64,${Buffer.from(media!.buffer!).toString("base64")}` : undefined,
    };
  });
  return { sheet: ws.name, headerRow, modelRow, endRow, columns, fields, images };
}

/** Écrit les repères dans le fichier selon l'association validée par l'admin ; renvoie le nouveau fichier. */
export async function applyMapping(buffer: Buffer, mapping: TemplateMapping): Promise<Buffer> {
  const known = new Set([...Object.keys(ITEM_TOKENS), ...Object.keys(SCALAR_TOKENS)]);
  for (const token of [...Object.values(mapping.columns), ...mapping.fields.map((f) => f.token)]) {
    if (token && !known.has(token)) throw new Error(`Repère inconnu : ${token}.`);
  }
  if (!Object.values(mapping.columns).includes("item_description")) throw new Error("Choisissez la colonne de la désignation des articles.");
  if (mapping.endRow < mapping.modelRow) throw new Error("La dernière ligne d'articles précède la première.");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  internals.normalizeSharedFormulas(workbook);
  const ws = workbook.getWorksheet(mapping.sheet);
  if (!ws) throw new Error("Feuille introuvable.");

  const boxes = internals.unmergeAll(ws);
  const model = mapping.modelRow;

  // Lignes d'exemple sous la ligne modèle : supprimées (les formules, fusions et zones qui les visent suivent).
  if (mapping.endRow > model) internals.resizeRows(workbook, ws, model + 1, mapping.endRow - model, 0, boxes);
  else for (const b of boxes) ws.mergeCellsWithoutStyle(b.top, b.left, b.bottom, b.right);

  // Ligne modèle : repères dans les colonnes associées ; colonnes ignorées vidées (sauf formules)
  const row = ws.getRow(model);
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const letter = colLetters(col);
    if (mapping.columns[letter]) return;
    if (!isFormula(cell)) cell.value = null;
  });
  for (const [letter, token] of Object.entries(mapping.columns)) {
    if (token) ws.getCell(`${letter}${model}`).value = `{{${token}}}`;
  }

  // Cases d'information
  const finalBoxes = internals.mergeBoxes(ws);
  for (const { cell, token } of mapping.fields) {
    if (!token) continue;
    const target = ws.getCell(cell);
    const box = finalBoxes.find((b) => Number(target.row) >= b.top && Number(target.row) <= b.bottom && Number(target.col) >= b.left && Number(target.col) <= b.right);
    const master = box ? ws.getCell(box.top, box.left) : target;
    master.value = `{{${token}}}`;
  }

  // Images : retirées, ou remplacées par le logo de l'entreprise (repère {{logo}} sur la zone qu'elles couvraient)
  const decisions = mapping.images ?? [];
  if (decisions.some((d) => d.action !== "keep")) {
    const images = imagesOf(ws);
    const dropped = new Set<unknown>();
    for (const { index, action } of decisions) {
      const image = images[index];
      if (!image || action === "keep") continue;
      dropped.add(image);
      if (action === "logo") {
        const box = imageBox(ws, image);
        const boxes = internals.mergeBoxes(ws);
        const exact = boxes.find((b) => b.top === box.top && b.left === box.left);
        const overlaps = boxes.some((b) => b.top <= box.bottom && b.bottom >= box.top && b.left <= box.right && b.right >= box.left);
        const single = box.top === box.bottom && box.left === box.right;
        let free = true;
        for (let r = box.top; r <= box.bottom && free; r++) for (let c = box.left; c <= box.right; c++) {
          if ((r !== box.top || c !== box.left) && ws.getCell(r, c).value !== null) { free = false; break; }
        }
        if (!exact && !single && !overlaps && free) ws.mergeCellsWithoutStyle(box.top, box.left, box.bottom, box.right);
        ws.getCell(box.top, box.left).value = "{{logo}}";
      }
    }
    const media = (ws as unknown as { _media: unknown[] })._media;
    (ws as unknown as { _media: unknown[] })._media = media.filter((m) => !dropped.has(m));
    // Le contenu des images retirées ne reste pas dans le fichier : remplacé par une image minuscule (les numéros d'images restent valides).
    const stillUsed = new Set<string>();
    workbook.eachSheet((sheet) => { for (const im of imagesOf(sheet)) stillUsed.add(String(im.imageId)); });
    for (const image of dropped as Set<SheetImage>) {
      const id = String(image.imageId);
      const entry = workbook.getImage(Number(id)) as { buffer?: Buffer; extension?: string } | undefined;
      if (!stillUsed.has(id) && entry && entry.extension === "png") entry.buffer = Buffer.from(TINY_PNG_BASE64, "base64");
    }
  }

  const out = Buffer.from(await workbook.xlsx.writeBuffer());
  const report = await inspectTemplate(out);
  if (!report.ok) throw new Error(report.errors.join(" "));
  return out;
}
