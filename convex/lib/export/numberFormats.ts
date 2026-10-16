import type ExcelJS from "exceljs";
import { adaptiveNumFmt } from "../pricing";

/**
 * Dernier passage avant l'écriture du fichier : chaque nombre (valeur ou résultat de formule) s'affiche avec au plus
 * 2 décimales, et sans décimales inutiles (« 12 » et non « 12,00 »). Les dates, pourcentages et textes sont laissés tels quels.
 */
export function adaptNumberFormats(ws: ExcelJS.Worksheet): void {
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const n =
        typeof v === "number" ? v
        : v && typeof v === "object" && "result" in v && typeof v.result === "number" ? v.result
        : undefined;
      if (n === undefined || !Number.isFinite(n)) return;

      const fmt = cell.numFmt;
      let next: string | undefined;
      if (!fmt || fmt === "General") {
        // « General » affiche déjà 12 ou 12,5 ; on n'intervient que s'il y a plus de 2 décimales.
        if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) next = adaptiveNumFmt("#,##0.00", n);
      } else {
        const bare = fmt.replace(/\[[^\]]*\]|"[^"]*"|\\./g, "");
        if (/[dmyhs%@]/i.test(bare) || !/0/.test(bare)) return;
        next = adaptiveNumFmt(fmt, n);
      }
      // Nouvel objet de style : ExcelJS partage parfois le même entre plusieurs cellules.
      if (next && next !== fmt) cell.style = { ...cell.style, numFmt: next };
    }),
  );
}
