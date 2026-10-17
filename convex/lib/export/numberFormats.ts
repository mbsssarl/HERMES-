import type ExcelJS from "exceljs";
import { adaptiveNumFmt } from "../pricing";

/**
 * Dernier passage avant l'écriture du fichier : chaque nombre (valeur ou résultat de formule) s'affiche avec au plus
 * 2 décimales, et sans décimales inutiles (« 12 » et non « 12,00 ») - sauf les montants, dont le format affiche déjà
 * 2 décimales : ils les gardent toujours (« 20,00 »). Les dates, pourcentages et textes sont laissés tels quels.
 *
 * Le format de base garde 2 décimales, et une mise en forme conditionnelle retire celles qui sont inutiles : l'affichage
 * suit donc la valeur même quand elle change dans Excel (prix unitaire saisi à la main -> total recalculé décimal).
 */
export function adaptNumberFormats(ws: ExcelJS.Worksheet): void {
  // Cellules à suivre, par colonne et par format : regroupées ensuite en plages verticales continues.
  const groups = new Map<string, { col: number; fmt: string; rows: number[] }>();

  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const n =
        typeof v === "number" ? v
        : v && typeof v === "object" && "result" in v && typeof v.result === "number" ? v.result
        : undefined;
      if (n === undefined || !Number.isFinite(n)) return;

      let fmt = cell.numFmt;
      if (!fmt || fmt === "General") {
        // « General » affiche déjà 12 ou 12,5 ; on n'intervient que s'il y a plus de 2 décimales.
        if (Math.abs(n * 100 - Math.round(n * 100)) <= 1e-9) return;
        fmt = "#,##0.00";
      } else {
        // Parties numériques du format, sans la section texte (« @ », ex. format comptable « _-* #,##0 _€_-;…;_-@_- »)
        // ni les littéraux : crochets, guillemets, caractères échappés (\x), espacements (_x) et remplissages (*x).
        const bare = fmt
          .split(";")
          .filter((section) => !section.includes("@"))
          .join(";")
          .replace(/\[[^\]]*\]|"[^"]*"|\\.|_.|\*./g, "");
        if (/[dmyhs%e]/i.test(bare) || !/0/.test(bare)) return;
        // Format déjà à 2 décimales (montant) : conservé tel quel, sans mise en forme conditionnelle.
        if (/.00/.test(bare)) return;
      }

      const base = adaptiveNumFmt(fmt, 0.01); // 2 décimales
      // Nouvel objet de style : ExcelJS partage parfois le même entre plusieurs cellules.
      if (base !== cell.numFmt) cell.style = { ...cell.style, numFmt: base };
      const col = Number(cell.col);
      const key = `${col}|${base}`;
      const group = groups.get(key) ?? { col, fmt: base, rows: [] };
      group.rows.push(Number(cell.row));
      groups.set(key, group);
    }),
  );

  for (const { col, fmt, rows } of groups.values()) {
    const letter = ws.getColumn(col).letter;
    rows.sort((a, b) => a - b);
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
      const top = `${letter}${rows[i]}`;
      // Formule relative à la première cellule de la plage : Excel l'applique à chaque cellule de la plage.
      const when = (digits: number) => `AND(ISNUMBER(${top}),ROUND(${top},2)=ROUND(${top},${digits}))`;
      ws.addConditionalFormatting({
        ref: rows[i] === rows[j] ? top : `${top}:${letter}${rows[j]}`,
        rules: [
          { type: "expression", formulae: [when(0)], style: { numFmt: adaptiveNumFmt(fmt, 1) } },
          { type: "expression", formulae: [when(1)], style: { numFmt: adaptiveNumFmt(fmt, 0.1) } },
        ],
      } as unknown as ExcelJS.ConditionalFormattingOptions); // priorité attribuée par ExcelJS à l'écriture
      i = j + 1;
    }
  }
}
