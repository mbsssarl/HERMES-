"use node";

import type ExcelJS from "exceljs";
// @ts-ignore le paquet n'a pas de types (utilisé de façon minimale ici)
import FormulaParser from "fast-formula-parser";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { FormulaHelpers: H, Types, FormulaError } = FormulaParser as any;

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * Un fichier Excel écrit par ExcelJS garde pour chaque formule le résultat qu'elle avait dans le fichier d'origine
 * (donc périmé : prix, remise et totaux restent à 0 dans un aperçu ou en « mode protégé »). On recalcule donc toutes
 * les formules ici et on enregistre leur résultat à jour : le fichier est correct même si le lecteur ne recalcule pas.
 */

/** Critère de SUMIFS / AVERAGEIFS : « >0 », « <>x », « » (cellule vide), texte avec * et ?, nombre. */
function matcher(raw: unknown): (cell: unknown) => boolean {
  // Le moteur transmet les cellules vides comme 0 à SUMIFS / AVERAGEIFS : le critère « vide » reconnaît donc aussi 0.
  const isBlank = (c: unknown) => c === undefined || c === null || c === "" || c === 0;
  const asNumber = (s: string) => (s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined);
  if (typeof raw === "number") return (c) => typeof c === "number" && c === raw;
  if (typeof raw === "boolean") return (c) => c === raw;
  const text = raw === undefined || raw === null ? "" : String(raw);
  const op = /^(<>|>=|<=|>|<|=)(.*)$/s.exec(text);
  const operator = op ? op[1] : "=";
  const operand = op ? op[2] : text;
  const n = asNumber(operand);
  const wildcard = /[*?]/.test(operand) && n === undefined
    ? new RegExp("^" + operand.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i")
    : null;
  return (c) => {
    if (operand === "") return operator === "<>" ? !isBlank(c) : isBlank(c);
    if (n !== undefined) {
      if (typeof c !== "number") return operator === "<>";
      return operator === "=" ? c === n : operator === "<>" ? c !== n : operator === ">" ? c > n : operator === "<" ? c < n : operator === ">=" ? c >= n : c <= n;
    }
    const s = isBlank(c) ? "" : String(c);
    const eq = wildcard ? wildcard.test(s) : s.toLowerCase() === operand.toLowerCase();
    return operator === "<>" ? !eq : eq;
  };
}

/** Arguments déjà lus par le moteur : une plage arrive en tableau 2D, un critère en valeur simple. */
const asGrid = (arg: any): unknown[][] => (Array.isArray(arg?.value) ? arg.value : [[arg?.value]]);

function conditionalAggregate(average: boolean) {
  return (_context: unknown, sumArg: any, ...pairs: any[]) => {
    const sums = asGrid(sumArg);
    const conditions: { range: unknown[][]; test: (cell: unknown) => boolean }[] = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      conditions.push({ range: asGrid(pairs[i]), test: matcher(asGrid(pairs[i + 1])[0]?.[0]) });
    }
    let total = 0;
    let count = 0;
    sums.forEach((row, r) =>
      row.forEach((value, c) => {
        if (typeof value !== "number") return;
        if (conditions.every((cond) => cond.test(cond.range[r]?.[c]))) {
          total += value;
          count++;
        }
      }),
    );
    if (!average) return total;
    if (count === 0) throw FormulaError.DIV0;
    return total / count;
  };
}

/* ----- SUMPRODUCT avec calcul entre plages (ex. SUMPRODUCT(L21:L199*J21:J199*(1-K21:K199))) -----
   Le moteur de formules ne calcule pas terme à terme sur des plages : on évalue ces expressions ici. */

type Grid = number[][];
type Operand = number | Grid;

const colIndex = (letters: string) => letters.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

/** Évalue une expression de plages et de nombres (+ - * / et parenthèses) terme à terme ; renvoie la somme de ses termes. */
function sumProductOf(expr: string, readGrid: (from: { row: number; col: number }, to: { row: number; col: number }) => Grid): number | undefined {
  const compact = expr.replace(/\s+/g, "");
  const tokens = compact.match(/\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens || tokens.join("") !== compact) return undefined;
  let i = 0;

  const operand = (token: string): Operand => {
    if (/^\d/.test(token)) return Number(token);
    const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(token);
    if (!m) throw new Error("ref");
    const from = { row: Number(m[2]), col: colIndex(m[1]) };
    const to = m[3] ? { row: Number(m[4]), col: colIndex(m[3]) } : from;
    return readGrid(from, to);
  };
  const apply = (a: Operand, b: Operand, op: string): Operand => {
    const f = (x: number, y: number) => (op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : y === 0 ? NaN : x / y);
    if (typeof a === "number" && typeof b === "number") return f(a, b);
    const shape = (typeof a === "number" ? b : a) as Grid;
    return shape.map((row, r) =>
      row.map((_, c) => f(typeof a === "number" ? a : a[r]?.[c] ?? 0, typeof b === "number" ? b : b[r]?.[c] ?? 0)),
    );
  };
  const primary = (): Operand => {
    const token = tokens[i++];
    if (token === "(") { const v = sum(); if (tokens[i++] !== ")") throw new Error("paren"); return v; }
    if (token === "-") return apply(0, primary(), "-");
    return operand(token);
  };
  const product = (): Operand => {
    let v = primary();
    while (tokens[i] === "*" || tokens[i] === "/") { const op = tokens[i++]; v = apply(v, primary(), op); }
    return v;
  };
  const sum = (): Operand => {
    let v = product();
    while (tokens[i] === "+" || tokens[i] === "-") { const op = tokens[i++]; v = apply(v, product(), op); }
    return v;
  };

  try {
    const value = sum();
    if (i !== tokens.length) return undefined;
    const total = typeof value === "number" ? value : value.reduce((s, row) => s + row.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0), 0);
    return Number.isFinite(total) ? total : undefined;
  } catch {
    return undefined;
  }
}

/** Remplace dans une formule chaque SUMPRODUCT(<calcul entre plages>) par son résultat numérique. */
function inlineSumProducts(formula: string, readGrid: Parameters<typeof sumProductOf>[1]): string {
  let out = formula;
  let from = 0;
  for (;;) {
    const start = out.toUpperCase().indexOf("SUMPRODUCT(", from);
    if (start < 0) return out;
    let depth = 0;
    let end = -1;
    for (let k = start + "SUMPRODUCT".length; k < out.length; k++) {
      if (out[k] === "(") depth++;
      else if (out[k] === ")" && --depth === 0) { end = k; break; }
    }
    if (end < 0) return out;
    const argument = out.slice(start + "SUMPRODUCT(".length, end);
    const value = /[*+/-]/.test(argument) && !argument.includes(",") ? sumProductOf(argument, readGrid) : undefined;
    if (value === undefined) { from = end; continue; }
    out = out.slice(0, start) + String(value) + out.slice(end + 1);
    from = start;
  }
}

function plainValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return (value.getTime() - EXCEL_EPOCH) / 86_400_000;
  if (typeof value === "object") {
    const v = value as any;
    if ("richText" in v) return v.richText.map((p: { text: string }) => p.text).join("");
    if ("text" in v && !("formula" in v) && !("sharedFormula" in v)) return v.text;
    if ("error" in v) return new FormulaError(v.error);
  }
  return value;
}

/** Recalcule toutes les formules du classeur et enregistre leur résultat. Ne lève jamais : au pire, rien ne change. */
export function recalculateWorkbook(workbook: ExcelJS.Workbook): void {
  try {
    const memo = new Map<string, unknown>();
    const running = new Set<string>();
    // Le moteur n'est pas ré-entrant : une formule qui dépend d'une autre formule en cours d'évaluation utilise un
    // second moteur, et ainsi de suite (un par niveau d'imbrication).
    const parsers: any[] = [];
    let depth = 0;

    const key = (sheet: string, row: number, col: number) => `${sheet}!${row}!${col}`;
    const sheetOf = (name: string) => workbook.getWorksheet(name);

    const evaluate = (sheet: string, row: number, col: number): unknown => {
      const k = key(sheet, row, col);
      if (memo.has(k)) return memo.get(k);
      const ws = sheetOf(sheet);
      if (!ws) return undefined;
      const raw = ws.getCell(row, col).value;
      const formula = raw && typeof raw === "object" && "formula" in raw ? (raw as { formula?: string }).formula : undefined;
      if (!formula) {
        const v = plainValue(raw);
        memo.set(k, v);
        return v;
      }
      if (running.has(k)) return FormulaError.REF; // référence circulaire
      running.add(k);
      let result: unknown;
      try {
        const engine = (parsers[depth] ??= makeParser());
        depth++;
        try {
          const readGrid = (a: { row: number; col: number }, b: { row: number; col: number }): number[][] => {
          const ws = sheetOf(sheet);
          const lastRow = Math.min(b.row, ws?.rowCount ?? b.row);
          const grid: number[][] = [];
          for (let r = a.row; r <= lastRow; r++) {
            const line: number[] = [];
            for (let c = a.col; c <= b.col; c++) { const v = evaluate(sheet, r, c); line.push(typeof v === "number" ? v : 0); }
            grid.push(line);
          }
          return grid;
        };
        result = engine.parse(inlineSumProducts(formula, readGrid), { sheet, row, col });
        } finally {
          depth--;
        }
      } catch (err) {
        if (process.env.RECALC_DEBUG) console.error("recalc", sheet, row, col, formula, (err as { details?: unknown })?.details ?? err);
        result = err instanceof FormulaError ? err : FormulaError.VALUE;
      } finally {
        running.delete(k);
      }
      memo.set(k, result);
      return result;
    };

    const makeParser = (): any => new (FormulaParser as any)({
      functionsNeedContext: { SUMIFS: conditionalAggregate(false), AVERAGEIFS: conditionalAggregate(true) },
      // Cellule vide : 0 (comme dans Excel pour une référence seule) ; dans une plage elle reste vide (null), ce qui
      // permet à SUM de l'ignorer et à SUMIFS de la reconnaître avec le critère vide.
      onCell: ({ sheet, row, col }: { sheet: string; row: number; col: number }) => evaluate(sheet, row, col) ?? 0,
      onRange: (ref: { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } }) => {
        const ws = sheetOf(ref.sheet);
        const lastRow = Math.min(ref.to.row, ws?.rowCount ?? ref.to.row);
        const lastCol = Math.min(ref.to.col, ws?.columnCount ?? ref.to.col);
        const out: unknown[][] = [];
        for (let r = ref.from.row; r <= lastRow; r++) {
          const line: unknown[] = [];
          for (let c = ref.from.col; c <= lastCol; c++) line.push(evaluate(ref.sheet, r, c) ?? null);
          out.push(line);
        }
        return out;
      },
      onVariable: () => null,
    });

    workbook.eachSheet((ws) => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const raw = cell.value;
          if (!raw || typeof raw !== "object" || !("formula" in raw) || !(raw as { formula?: string }).formula) return;
          const row = Number(cell.row);
          const col = Number(cell.col);
          const result = evaluate(ws.name, row, col);
          if (result === undefined) return;
          const formula = (raw as { formula: string }).formula;
          if (result instanceof FormulaError) {
            cell.value = { formula, result: { error: (result as { error: string }).error } } as ExcelJS.CellFormulaValue;
          } else if (typeof result === "number" || typeof result === "string" || typeof result === "boolean") {
            // arrondi à 9 décimales : évite les « 33483.049999999996 » dus aux flottants
            const clean = typeof result === "number" ? Math.round(result * 1e9) / 1e9 : result;
            cell.value = { formula, result: clean } as ExcelJS.CellFormulaValue;
          }
        });
      });
    });
  } catch {
    // le recalcul est un plus : en cas de problème, le fichier garde ses formules (Excel les recalcule à l'ouverture)
  }
}
