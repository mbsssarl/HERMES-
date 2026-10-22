import ExcelJS from "exceljs";
import { QUOTATION_LOGO_PNG_BASE64 } from "./logoData";
import type { ExportData } from "./buildQuotationWorkbook";
import { recalculateWorkbook } from "./recalc";
import { ITEM_TOKENS, SCALAR_TOKENS } from "./templateTokens";

// ---------------------------------------------------------------------------------------------------------
// Modèles d'export importés par l'admin. Un modèle est un fichier Excel ordinaire où chaque endroit à remplir est
// marqué par un repère entre doubles accolades : {{vessel}}, {{item_description}}...
//   - repères simples : n'importe où dans le classeur (une cellule peut mêler texte et repères) ;
//   - repères d'article ({{item_...}}) : sur UNE seule ligne, la « ligne modèle », répétée pour chaque article.
// Tout le reste (mise en forme, fusions, formules, validations, images, protection) est conservé. Les lignes sous la
// ligne modèle descendent d'autant et les formules qui les visent (SUM, SUMIFS...) suivent, comme dans Excel.
// ---------------------------------------------------------------------------------------------------------

const TOKEN_RE = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g;
const WHOLE_TOKEN_RE = /^\s*\{\{\s*([A-Za-z_]\w*)\s*\}\}\s*$/;
const isItemToken = (name: string) => name.startsWith("item_");
const round2 = (n: number) => Math.round(n * 100) / 100;

type Var = string | number | Date | null;
type Vars = Record<string, Var>;
type Cell = ExcelJS.Cell;

// ------------------------------------------------------------------------------------------ lecture des repères

/** Textes d'une cellule susceptibles de contenir des repères (texte, texte riche, lien) - jamais une formule. */
function textsOf(value: ExcelJS.CellValue): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if ("formula" in v || "sharedFormula" in v) return [];
    if (Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((r) => r.text);
    if (typeof v.text === "string") return [v.text, typeof v.hyperlink === "string" ? v.hyperlink : ""];
  }
  return [];
}

function tokensIn(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[1]);
}

interface Found { sheet: string; row: number; tokens: Set<string> }

function scan(workbook: ExcelJS.Workbook): { all: Set<string>; itemRows: Found[] } {
  const all = new Set<string>();
  const itemRows: Found[] = [];
  workbook.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const tokens = new Set<string>();
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.type === ExcelJS.ValueType.Merge) return;
        for (const text of textsOf(cell.value)) for (const t of tokensIn(text)) { tokens.add(t); all.add(t); }
      });
      if ([...tokens].some(isItemToken)) itemRows.push({ sheet: ws.name, row: rowNumber, tokens });
    });
  });
  return { all, itemRows };
}

export interface TemplateReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  tokens: string[];
  sheet?: string;
  itemRow?: number;
}

/** Contrôle un fichier importé comme modèle : lisible, repères connus, une seule ligne d'articles. */
export async function inspectTemplate(buffer: Buffer): Promise<TemplateReport> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { ok: false, errors: ["Ce fichier n'est pas un classeur Excel (.xlsx) lisible."], warnings: [], tokens: [] };
  }
  const { all, itemRows } = scan(workbook);
  const errors: string[] = [];
  const warnings: string[] = [];
  const unknown = [...all].filter((t) => !(t in SCALAR_TOKENS) && !(t in ITEM_TOKENS));
  if (unknown.length > 0) errors.push(`Repère(s) inconnu(s) : ${unknown.map((t) => `{{${t}}}`).join(", ")}.`);
  if (itemRows.length === 0) errors.push("Aucune ligne d'articles : placez des repères {{item_description}}, {{item_quantity}}... sur une ligne du tableau.");
  if (itemRows.length > 1) errors.push(`Les repères d'articles doivent tenir sur une seule ligne (trouvés lignes ${itemRows.map((r) => r.row).join(", ")}).`);
  const model = itemRows[0];
  if (model) {
    const ws = workbook.getWorksheet(model.sheet);
    const spans = ws ? mergeBoxes(ws).some((b) => b.top <= model.row && b.bottom >= model.row && b.bottom > b.top) : false;
    if (spans) errors.push("La ligne d'articles ne doit pas contenir de cellule fusionnée sur plusieurs lignes.");
    if (!model.tokens.has("item_description")) warnings.push("Aucun repère {{item_description}} : les désignations n'apparaîtront pas.");
  }
  return { ok: errors.length === 0, errors, warnings, tokens: [...all].sort(), sheet: model?.sheet, itemRow: model?.row };
}

// ------------------------------------------------------------------------------------------ formules

const FORMULA_REF =
  /(?<![A-Za-z0-9_.$'!])(?:((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*))!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(])/g;

const sheetNameOf = (prefix: string): string => (prefix.startsWith("'") ? prefix.slice(1, -1).replace(/''/g, "'") : prefix);

/**
 * Réécrit les références de ligne d'une formule. `rewrite(row, kind, absolute)` donne la nouvelle ligne ; seules les
 * références à la feuille `target` sont touchées (sans préfixe : celles d'une formule de `target`).
 */
function mapFormulaRows(
  formula: string,
  formulaSheet: string,
  target: string,
  rewrite: (row: number, kind: "start" | "end" | "single", absolute: boolean) => number,
): string {
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) => {
      if (i % 2 === 1) return part; // texte entre guillemets
      return part.replace(FORMULA_REF, (match, prefix, d1, c1, d2, r1, d3, c2, d4, r2) => {
        const applies = prefix ? sheetNameOf(prefix) === target : formulaSheet === target;
        if (!applies) return match;
        const head = prefix ? `${prefix}!` : "";
        const range = r2 !== undefined;
        const a = rewrite(Number(r1), range ? "start" : "single", d2 === "$");
        const first = `${head}${d1}${c1}${d2}${Math.max(a, 1)}`;
        if (!range) return first;
        const b = rewrite(Number(r2), "end", d4 === "$");
        return `${first}:${d3}${c2}${d4}${Math.max(b, 1)}`;
      });
    })
    .join("");
}

/** Une formule copiée `offset` lignes plus bas : ses références relatives (sans $) suivent. */
function translateFormula(formula: string, sheet: string, offset: number): string {
  if (offset === 0) return formula;
  return mapFormulaRows(formula, sheet, sheet, (row, _kind, absolute) => (absolute ? row : row + offset));
}

/** Les formules « partagées » dépendent de leur cellule maîtresse : on les écrit toutes en clair avant de déplacer des lignes. */
function normalizeSharedFormulas(workbook: ExcelJS.Workbook): void {
  workbook.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value as unknown as { sharedFormula?: string; formula?: string; result?: unknown } | null;
        if (v && typeof v === "object" && "sharedFormula" in v) {
          const formula = cell.formula;
          if (formula) cell.value = { formula, result: v.result } as ExcelJS.CellFormulaValue;
        }
      }),
    );
  });
}

// ------------------------------------------------------------------------------------------ redimensionnement de lignes

interface Box { top: number; left: number; bottom: number; right: number }

function mergeBoxes(ws: ExcelJS.Worksheet): Box[] {
  const merges = (ws as unknown as { _merges: Record<string, { model: Box }> })._merges;
  return Object.values(merges).map((m) => ({ top: m.model.top, left: m.model.left, bottom: m.model.bottom, right: m.model.right }));
}

function unmergeAll(ws: ExcelJS.Worksheet): Box[] {
  const boxes = mergeBoxes(ws);
  for (const b of boxes) ws.unMergeCells(b.top, b.left, b.bottom, b.right);
  return boxes;
}

/** Applique à une plage « A1:B9 » (ou une cellule) le même décalage de lignes que celui des formules. */
function mapRangeText(text: string, rewrite: (row: number, kind: "start" | "end" | "single") => number): string {
  return text.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g, (_m, d1, c1, d2, r1, d3, c2, d4, r2) => {
    const first = `${d1}${c1}${d2}${Math.max(rewrite(Number(r1), r2 === undefined ? "single" : "start"), 1)}`;
    return r2 === undefined ? first : `${first}:${d3}${c2}${d4}${Math.max(rewrite(Number(r2), "end"), 1)}`;
  });
}

function copyRowProps(src: ExcelJS.Row, dst: ExcelJS.Row): void {
  dst.height = src.height;
  dst.hidden = src.hidden;
  dst.outlineLevel = src.outlineLevel;
}

/**
 * Le bloc de `oldCount` lignes à partir de `at` devient un bloc de `newCount` lignes : les lignes dessous montent ou
 * descendent, et tout ce qui les vise suit (formules, fusions, validations, mises en forme conditionnelles, images,
 * zone d'impression, filtres, noms). Une référence à l'intérieur du bloc s'étire ou se contracte avec lui (SUM(M21:M21)
 * devient SUM(M21:M120) quand le bloc passe à 100 lignes). Les nouvelles lignes du bloc sont vides : à remplir.
 * `boxes` : fusions du classeur, déjà défusionnées par l'appelant, qui sont reposées à la fin.
 */
function resizeRows(workbook: ExcelJS.Workbook, ws: ExcelJS.Worksheet, at: number, oldCount: number, newCount: number, boxes: Box[]): void {
  const delta = newCount - oldCount;
  const lastOld = at + oldCount - 1;
  const rewrite = (r: number, kind: "start" | "end" | "single"): number => {
    if (r < at) return r;
    if (r > lastOld) return r + delta;
    if (newCount === 0) return kind === "start" ? at : at - 1;
    if (kind === "end" && r === lastOld) return at + newCount - 1;
    return at + Math.min(r - at, newCount - 1);
  };
  const dvRows = (r: number) => (r >= at && r <= lastOld ? (r - at < newCount ? r : -1) : r > lastOld ? r + delta : r);

  // formules de tout le classeur
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value as unknown as { formula?: string; result?: unknown } | null;
        if (v && typeof v === "object" && typeof v.formula === "string") {
          const next = mapFormulaRows(v.formula, sheet.name, ws.name, (r, k) => rewrite(r, k));
          if (next !== v.formula) cell.value = { formula: next, result: v.result } as ExcelJS.CellFormulaValue;
        }
      }),
    );
  });

  // déplacement des lignes situées sous le bloc
  const lastRow = ws.rowCount;
  const move = (from: number, to: number) => {
    const src = ws.getRow(from);
    const dst = ws.getRow(to);
    copyRowProps(src, dst);
    src.eachCell({ includeEmpty: true }, (cell, col) => {
      const target = dst.getCell(col);
      target.value = cell.value;
      target.style = cell.style;
    });
  };
  const clear = (rowNumber: number) => {
    const row = ws.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell) => { cell.value = null; cell.style = {}; });
    row.height = undefined as unknown as number;
    row.hidden = false;
  };
  if (delta > 0) {
    for (let r = lastRow; r > lastOld; r--) move(r, r + delta);
    for (let r = lastOld + 1; r <= lastOld + delta; r++) clear(r);
    for (let r = at; r <= lastOld; r++) if (r - at >= newCount) clear(r);
  } else if (delta < 0) {
    for (let r = at + newCount; r <= lastOld; r++) clear(r);
    for (let r = lastOld + 1; r <= lastRow; r++) move(r, r + delta);
    for (let r = lastRow + delta + 1; r <= lastRow; r++) clear(r);
  }

  // fusions
  for (const b of boxes) {
    const inside = b.top >= at && b.bottom <= lastOld;
    if (inside) {
      if (oldCount === 1) for (let k = 0; k < newCount; k++) ws.mergeCellsWithoutStyle(at + k, b.left, at + k, b.right);
      else if (b.bottom - at < newCount) ws.mergeCellsWithoutStyle(b.top, b.left, b.bottom, b.right);
      continue;
    }
    const top = rewrite(b.top, "start");
    const bottom = rewrite(b.bottom, "end");
    if (bottom >= top) ws.mergeCellsWithoutStyle(top, b.left, bottom, b.right);
  }

  // validations de données (par cellule)
  const dv = (ws as unknown as { dataValidations: unknown }).dataValidations as unknown as { model: Record<string, ExcelJS.DataValidation> };
  const nextDv: Record<string, ExcelJS.DataValidation> = {};
  for (const [address, rule] of Object.entries(dv.model)) {
    const m = /^([A-Z]+)(\d+)$/.exec(address);
    if (!m) { nextDv[address] = rule; continue; }
    const row = Number(m[2]);
    const moved = dvRows(row);
    if (moved > 0) nextDv[`${m[1]}${moved}`] = rule;
    if (oldCount === 1 && row === at) for (let k = 1; k < newCount; k++) nextDv[`${m[1]}${at + k}`] = rule;
  }
  dv.model = nextDv;

  // mises en forme conditionnelles
  const cfs = (ws as unknown as { conditionalFormattings: unknown }).conditionalFormattings as unknown as { ref: string; rules: unknown[] }[];
  const nextCf = cfs
    .map((cf) => ({ ...cf, ref: cf.ref.split(/\s+/).map((part) => mapRangeText(part, rewrite)).join(" ") }))
    .filter((cf) => cf.ref.length > 0);
  (ws as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings = nextCf;

  // images : leurs ancres suivent les lignes
  for (const image of ws.getImages()) {
    const range = image.range as unknown as { tl?: { nativeRow: number }; br?: { nativeRow: number } };
    if (range.tl) range.tl.nativeRow = rewrite(range.tl.nativeRow + 1, "single") - 1;
    if (range.br) range.br.nativeRow = rewrite(range.br.nativeRow + 1, "end") - 1;
  }

  // zone d'impression, titres répétés, filtre automatique
  const setup = ws.pageSetup as unknown as { printArea?: string; printTitlesRow?: string };
  if (setup.printArea) setup.printArea = mapRangeText(setup.printArea, rewrite);
  if (setup.printTitlesRow) setup.printTitlesRow = setup.printTitlesRow.replace(/(\d+):(\d+)/, (_m, a, b) => `${rewrite(Number(a), "start")}:${rewrite(Number(b), "end")}`);
  const filter = ws.autoFilter as unknown;
  if (typeof filter === "string") ws.autoFilter = mapRangeText(filter, rewrite);

  // noms définis qui visent cette feuille
  const names = workbook.definedNames as unknown as { model: { name: string; ranges: string[] }[] };
  names.model = names.model.map((n) => ({ ...n, ranges: n.ranges.map((r) => mapFormulaRows(r, "", ws.name, (row, k) => rewrite(row, k))) }));
}

// ------------------------------------------------------------------------------------------ remplissage

/** Remplace les repères d'une valeur de cellule ; une cellule qui ne contient qu'un repère reçoit la valeur typée (nombre, date). */
function fillValue(value: ExcelJS.CellValue, vars: Vars, unknown: Set<string>): ExcelJS.CellValue {
  const text = (s: string): string =>
    s.replace(TOKEN_RE, (_m, name: string) => {
      if (name === "logo") return "{{logo}}";
      if (!(name in vars)) { unknown.add(name); return ""; }
      const v = vars[name];
      if (v === null) return "";
      if (v instanceof Date) return v.toLocaleDateString("fr-FR");
      return String(v);
    });
  if (typeof value === "string") {
    const whole = WHOLE_TOKEN_RE.exec(value);
    if (whole && whole[1] !== "logo") {
      const name = whole[1];
      if (!(name in vars)) { unknown.add(name); return null; }
      const v = vars[name];
      if (v === null || typeof v === "number" || v instanceof Date) return v;
    }
    return text(value);
  }
  if (value && typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) return { richText: (v.richText as { text: string }[]).map((r) => ({ ...r, text: text(r.text) })) } as ExcelJS.CellRichTextValue;
    if (typeof v.text === "string") {
      return { ...v, text: text(v.text), ...(typeof v.hyperlink === "string" ? { hyperlink: text(v.hyperlink) } : {}) } as unknown as ExcelJS.CellValue;
    }
  }
  return value;
}

const hasToken = (value: ExcelJS.CellValue): boolean => textsOf(value).some((t) => t.includes("{{"));

function formatDmy(iso: string | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function scalarVars(data: ExportData, count: number, gross: number, discountAmount: number, fee: number): Vars {
  const c = data.company;
  return {
    reference: data.reference,
    date: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"),
    request_for: data.requestFor,
    country: data.country ?? null,
    port: data.deliveryPort ?? null,
    vessel: data.vessel ?? null,
    vessel_imo: data.imo ?? null,
    eta: formatDmy(data.eta),
    ref_no: data.refNo ?? null,
    currency: data.currency,
    company_name: c.name ?? null,
    company_address: c.address ?? null,
    company_postal: c.postal ?? null,
    company_email: c.email ?? null,
    company_phones: c.phones ?? null,
    company_website: c.website ?? null,
    items_count: count,
    subtotal: gross,
    discount_percent: data.discountPercent,
    discount_amount: discountAmount,
    transport: fee,
    total: round2(gross - discountAmount + fee),
  };
}

function wrappedLines(text: string, width: number): number {
  const perLine = Math.max(Math.floor(width), 1);
  return text.split(/\r?\n/).reduce((total, paragraph) => {
    let lines = 1;
    let used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const need = used === 0 ? word.length : word.length + 1;
      if (used + need > perLine && used > 0) { lines++; used = word.length; } else used += need;
    }
    return total + lines;
  }, 0);
}

/** Pose le logo sur la cellule (ou la zone fusionnée) qui porte {{logo}}, en conservant ses proportions. */
function placeLogos(workbook: ExcelJS.Workbook, ws: ExcelJS.Worksheet, data: ExportData): void {
  const spots: Cell[] = [];
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.type !== ExcelJS.ValueType.Merge && textsOf(cell.value).some((t) => /\{\{\s*logo\s*\}\}/.test(t))) spots.push(cell);
    }),
  );
  if (spots.length === 0) return;
  const logo = data.logo ?? { base64: QUOTATION_LOGO_PNG_BASE64, extension: "png" as const, width: 1, height: 1 };
  const imageId = workbook.addImage({ base64: logo.base64, extension: logo.extension });
  const boxes = mergeBoxes(ws);
  for (const cell of spots) {
    const r = Number(cell.row);
    const c = Number(cell.col);
    const box = boxes.find((b) => b.top === r && b.left === c) ?? { top: r, left: c, bottom: r, right: c };
    let width = 0;
    for (let col = box.left; col <= box.right; col++) width += Math.round((ws.getColumn(col).width ?? 8.43) * 7 + 5);
    let height = 0;
    for (let row = box.top; row <= box.bottom; row++) height += ((ws.getRow(row).height ?? 15) * 4) / 3;
    const margin = 4;
    const fit = Math.min((width - 2 * margin) / logo.width, (height - 2 * margin) / logo.height);
    const w = Math.max(Math.round(logo.width * fit), 8);
    const h = Math.max(Math.round(logo.height * fit), 8);
    // Ancrage exact : colonne/ligne de départ + décalage en EMU (9525 par pixel), taille fixe en pixels.
    const tl = { nativeCol: box.left - 1, nativeColOff: margin * 9525, nativeRow: box.top - 1, nativeRowOff: margin * 9525 };
    ws.addImage(imageId, { tl: tl as unknown as ExcelJS.Anchor, ext: { width: w, height: h }, editAs: "oneCell" });
    cell.value = null;
  }
}

/** Remplit le modèle avec les données de la quotation et renvoie le fichier Excel. */
export async function renderTemplate(buffer: Buffer, data: ExportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  normalizeSharedFormulas(workbook);

  const unknown = new Set<string>();
  const items = data.items;
  const count = items.length;
  let gross = 0;
  for (const it of items) if (it.unitPrice !== undefined) gross += round2(it.unitPrice * it.quantity);
  gross = round2(gross);
  const discountAmount = round2((gross * data.discountPercent) / 100);
  const fee = data.transportFee && data.transportFee > 0 ? round2(data.transportFee) : 0;
  const scalars = scalarVars(data, count, gross, discountAmount, fee);

  // 1) lignes d'articles
  const model = scan(workbook).itemRows[0];
  if (model) {
    const ws = workbook.getWorksheet(model.sheet)!;
    const at = model.row;
    const boxes = unmergeAll(ws);
    const modelRow = ws.getRow(at);
    const snapshot: { col: number; value: ExcelJS.CellValue; style: Partial<ExcelJS.Style> }[] = [];
    modelRow.eachCell({ includeEmpty: true }, (cell, col) => snapshot.push({ col, value: cell.value, style: cell.style }));
    const baseHeight = modelRow.height;
    const hidden = modelRow.hidden;
    const n = Math.max(count, 1);
    if (n !== 1) resizeRows(workbook, ws, at, 1, n, boxes);
    else for (const b of boxes) ws.mergeCellsWithoutStyle(b.top, b.left, b.bottom, b.right);

    for (let i = 0; i < n; i++) {
      const item = items[i];
      const vars: Vars = { ...scalars };
      if (item) {
        const unitPrice = item.unitPrice !== undefined ? round2(item.unitPrice) : null;
        Object.assign(vars, {
          item_no: i + 1,
          item_code: item.code ?? null,
          item_description: item.description,
          item_unit: item.unit ?? null,
          item_quantity: item.quantity,
          item_unit_price: unitPrice,
          item_total: item.unitPrice !== undefined ? round2(item.unitPrice * item.quantity) : null,
          item_remarks: item.remarks ?? null,
        });
      } else {
        for (const name of Object.keys(ITEM_TOKENS)) vars[name] = null;
      }
      const row = ws.getRow(at + i);
      let lines = 1;
      for (const { col, value, style } of snapshot) {
        const cell = row.getCell(col);
        cell.style = JSON.parse(JSON.stringify(style));
        const v = value as unknown as { formula?: string } | null;
        if (v && typeof v === "object" && typeof v.formula === "string") {
          cell.value = { formula: translateFormula(v.formula, ws.name, i) } as ExcelJS.CellFormulaValue;
          continue;
        }
        const filled = fillValue(value, vars, unknown);
        cell.value = filled;
        if (filled instanceof Date && (!cell.numFmt || cell.numFmt === "General")) cell.numFmt = "dd/mm/yyyy";
        if (typeof filled === "string" && cell.alignment?.wrapText) lines = Math.max(lines, wrappedLines(filled, ws.getColumn(col).width ?? 10));
      }
      row.hidden = hidden;
      // Hauteur du modèle au minimum ; le texte long qui passe à la ligne agrandit la ligne.
      row.height = Math.max(baseHeight ?? 15, lines > 1 ? lines * 13.5 + 4 : 0);
    }
  }

  // 2) repères simples, partout ailleurs
  workbook.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.type === ExcelJS.ValueType.Merge || !hasToken(cell.value)) return;
        const filled = fillValue(cell.value, scalars, unknown);
        cell.value = filled;
        if (filled instanceof Date && (!cell.numFmt || cell.numFmt === "General")) cell.numFmt = "dd/mm/yyyy";
      }),
    );
  });
  workbook.eachSheet((ws) => placeLogos(workbook, ws, data));

  recalculateWorkbook(workbook);
  workbook.calcProperties.fullCalcOnLoad = true;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Pour les tests et la préparation de fichiers d'essai. */
export const internals = { resizeRows, unmergeAll, normalizeSharedFormulas, mergeBoxes };
