"use node";

import { findHeaderRowIndex } from "./columnMapping";
import type { RawTable } from "./excel";

interface TextItem { str: string; transform: number[]; width: number; height?: number }
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: Array<TextItem | { type?: string }> }>;
    cleanup(): void;
  }>;
}
interface Cell { x: number; x2: number; text: string }
interface Line { page: number; y: number; cells: Cell[] }

const LINE_TOLERANCE = 3; // points : deux fragments à moins de 3 pt de hauteur sont sur la même ligne
const LINE_NUMBER = /^\d{1,4}\.?$/;
const HEADER_LINE_NUMBER = /^(no\.?|n°|#|nr\.?|item no\.?|line|line no\.?|sr\.?\s*no\.?|s\/n)$/i;
// Libellés parasites que certains logiciels impriment sur la ligne du premier article.
const NOISE_CELL = /^form contains \d+ items?$/i;
const PAGE_FOOTER = /^page\s+\d+\s*(of|\/)\s*\d+|produced on|printed on|^-- \d+ of \d+ --$/i;

/** Regroupe les fragments de texte d'une page en lignes de cellules, d'après leur position (colonnes comprises). */
export async function readLines(doc: PdfDoc): Promise<Line[]> {
  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    page.cleanup();
    const items = content.items.filter((i): i is TextItem => "str" in i && i.str.trim().length > 0);

    const rows: { y: number; items: TextItem[] }[] = [];
    for (const item of items.sort((a, b) => b.transform[5] - a.transform[5])) {
      const y = item.transform[5];
      const row = rows.find((r) => Math.abs(r.y - y) <= LINE_TOLERANCE);
      if (row) row.items.push(item);
      else rows.push({ y, items: [item] });
    }

    for (const row of rows) {
      row.items.sort((a, b) => a.transform[4] - b.transform[4]);
      const cells: Cell[] = [];
      for (const item of row.items) {
        const x = item.transform[4];
        const x2 = x + item.width;
        const last = cells[cells.length - 1];
        const charWidth = item.str.length > 0 ? Math.max(item.width / item.str.length, 1) : 3;
        // Même cellule si l'espace avec le fragment précédent ressemble à un espace de mots, nouvelle colonne sinon.
        if (last && x - last.x2 < charWidth * 1.8) {
          last.text += (x - last.x2 > charWidth * 0.3 && !last.text.endsWith(" ") && !item.str.startsWith(" ") ? " " : "") + item.str;
          last.x2 = Math.max(last.x2, x2);
        } else {
          cells.push({ x, x2, text: item.str });
        }
      }
      for (const cell of cells) cell.text = cell.text.replace(/\s+/g, " ").trim();
      lines.push({ page: p, y: row.y, cells: cells.filter((c) => c.text.length > 0 && !NOISE_CELL.test(c.text)) });
    }
  }
  return lines;
}

/**
 * Lecture d'un PDF « formulaire » (réquisition de navire, bon de commande...) d'après la position du texte :
 * l'en-tête du tableau donne les colonnes, chaque ligne d'article y est rangée par position, et les lignes
 * de continuation (description sur plusieurs lignes) sont rattachées à l'article précédent.
 * Retourne null si aucun en-tête de tableau n'est reconnu.
 */
export async function extractPdfTableByLayout(doc: PdfDoc): Promise<RawTable | null> {
  const lines = await readLines(doc);

  const headerIdx = findHeaderRowIndex(lines.map((l) => l.cells.map((c) => c.text)));
  // Repli : en-tête court dont les libellés sont ceux d'un formulaire (« Item Description », « Packing », « Req. »...).
  const fallbackIdx = lines.findIndex(
    (l) => l.cells.length >= 4 && /description|designation|item/i.test(l.cells.map((c) => c.text).join(" ")) &&
      /qty|quantity|req\.?|packing|unit|uom/i.test(l.cells.map((c) => c.text).join(" ")),
  );
  const idx = headerIdx !== -1 ? headerIdx : fallbackIdx;
  if (idx === -1) return inferTableFromItemLines(lines);

  const header = lines[idx];
  const headerCells = header.cells;
  const headerRow = headerCells.map((c) => c.text);
  const centers = headerCells.map((c) => (c.x + c.x2) / 2);
  // Limites entre colonnes : à mi-chemin entre les centres des libellés voisins.
  const edges = centers.slice(1).map((c, i) => (centers[i] + c) / 2);
  const columnOf = (cell: Cell): number => {
    const mid = (cell.x + cell.x2) / 2;
    let col = edges.findIndex((e) => mid < e);
    if (col === -1) col = headerCells.length - 1;
    return col;
  };

  const numbered = HEADER_LINE_NUMBER.test(headerRow[0].trim());
  const dataRows: string[][] = [];
  let current: string[] | null = null;
  let prev: { page: number; y: number } | null = null;
  const headerKey = headerRow.join("|").toLowerCase();

  for (const line of lines.slice(idx + 1)) {
    const texts = line.cells.map((c) => c.text);
    if (texts.length === 0) continue;
    const joined = texts.join(" ");
    if (PAGE_FOOTER.test(joined) || texts.join("|").toLowerCase() === headerKey) continue;
    // Ligne de regroupement (« Catalogue: … », « Group: … ») : ni un article ni la suite d'un article.
    if (texts.length === 1 && /:/.test(texts[0]) && !LINE_NUMBER.test(texts[0])) {
      current = null;
      continue;
    }

    const placed: string[] = headerRow.map(() => "");
    for (const cell of line.cells) {
      const col = columnOf(cell);
      placed[col] = placed[col] ? `${placed[col]} ${cell.text}` : cell.text;
    }

    // Une ligne trop éloignée de la précédente (autre page, bas de page...) n'est pas la suite d'un article.
    const detached = !prev || prev.page !== line.page || prev.y - line.y > 30;
    const startsRow = numbered ? LINE_NUMBER.test(placed[0].trim()) : placed[0].trim().length > 0;
    if (startsRow) {
      current = placed;
      dataRows.push(current);
    } else if (!current || detached) {
      continue; // texte libre : avant le premier article ou détaché du tableau
    } else {
      placed.forEach((text, col) => {
        if (text) current![col] = current![col] ? `${current![col]} ${text}` : text;
      });
    }
    prev = { page: line.page, y: line.y };
  }

  if (dataRows.length === 0) return null;
  const preambleRows = lines.slice(0, idx).map((l) => l.cells.map((c) => c.text));
  return { headerRow, dataRows, preambleRows };
}

const NUMERIC_CELL = /^[\d\s.,]+$/;
const UNIT_CELL = /^(pcs?|pc\s*\/\s*each|each|ea|kgs?|ltrs?|lt|l|mtrs?|m|sets?|box(es)?|rolls?|pairs?|drums?|cans?|tins?|bags?|pkts?|nos?|units?|pack(s|et)?|ctn|cartons?|bottles?|btl|gal|ft)\.?$/i;

/**
 * Pour un document sans en-tête de tableau reconnaissable : repère les lignes d'articles à leur forme
 * (n° de ligne en tête, texte descriptif, nombre = quantité, unité courte) et fabrique les colonnes
 * « No / Code / Description / Unit / Quantity ». Retourne null si aucune ligne d'article n'est trouvée.
 */
export function inferTableFromItemLines(lines: Line[]): RawTable | null {
  const dataRows: string[][] = [];
  let firstItemLine = -1;
  let current: string[] | null = null;
  let prev: { page: number; y: number } | null = null;

  lines.forEach((line, index) => {
    const texts = line.cells.map((c) => c.text);
    if (texts.length === 0 || PAGE_FOOTER.test(texts.join(" "))) return;

    if (LINE_NUMBER.test(texts[0]) && texts.length >= 2) {
      const row = ["", "", "", "", ""]; // No, Code, Description, Unit, Quantity
      row[0] = texts[0];
      const description: string[] = [];
      for (const text of texts.slice(1)) {
        const compact = text.replace(/\s/g, "");
        if (/^\d{6}[A-Za-z]?$/.test(compact) && !row[1]) row[1] = compact;
        else if (NUMERIC_CELL.test(text) && !row[4]) row[4] = text;
        else if (UNIT_CELL.test(text) && !row[3]) row[3] = text;
        else if (!NUMERIC_CELL.test(text)) description.push(text);
      }
      row[2] = description.join(" ");
      if (row[2] === "") return;
      if (firstItemLine === -1) firstItemLine = index;
      current = row;
      dataRows.push(row);
      prev = { page: line.page, y: line.y };
    } else if (current && prev && prev.page === line.page && prev.y - line.y <= 30) {
      // Suite d'un article : texte descriptif, ou quantité / unité tombées sur la ligne suivante.
      for (const text of texts) {
        if (NUMERIC_CELL.test(text)) { if (!current[4]) current[4] = text; }
        else if (UNIT_CELL.test(text)) { if (!current[3]) current[3] = text; }
        else if (!/:/.test(text)) current[2] = `${current[2]} ${text}`;
      }
      prev = { page: line.page, y: line.y };
    } else {
      current = null;
    }
  });

  if (dataRows.length === 0 || !dataRows.some((r) => r[4] !== "")) return null;
  return {
    headerRow: ["No", "Code", "Description", "Unit", "Quantity"],
    dataRows,
    preambleRows: lines.slice(0, Math.max(firstItemLine, 0)).map((l) => l.cells.map((c) => c.text)),
  };
}
