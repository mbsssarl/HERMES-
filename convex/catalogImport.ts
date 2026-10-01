"use node";

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { mapRowsToSupplierItems } from "./lib/extraction/columnMapping";
import { normalizeCode } from "./lib/normalize";
import { parseFileToTables } from "./lib/extraction/parseFile";

/**
 * Step 1 of a catalogue import: reads an uploaded file (Excel/PDF/Word), maps its
 * columns (code/IMPA, name, unit, price - headers may vary) and returns the rows
 * for the user to review. Nothing is written to the catalogue here - that is
 * `products.importCatalog`. The temporary upload is deleted once parsed.
 */
export const analyzeCatalogFile = action({
  args: { storageId: v.id("_storage"), mimeType: v.string(), countryId: v.optional(v.id("countries")) },
  handler: async (ctx, { storageId, mimeType, countryId }) => {
    const user = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!user || user.role !== "admin") {
      await ctx.storage.delete(storageId);
      throw new Error("Action réservée aux administrateurs.");
    }

    try {
      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new Error("Fichier introuvable dans le stockage.");
      const tables = await parseFileToTables(mimeType, await blob.arrayBuffer());
      const rows = tables.flatMap((table) => mapRowsToSupplierItems(table.headerRow, table.dataRows));
      if (rows.length === 0) throw new Error("Aucun produit n'a pu être extrait de ce fichier.");
      // Footer / label lines of a document ("Payment Term :", "Remarks:") are not products: a label ends
      // with ":" or repeats its own text as the unit (a merged cell read across several columns).
      const productRows = rows.filter((r) => {
        const name = r.rawName.trim();
        if (/[:：]\s*$/.test(name)) return false;
        if (r.rawUnit && r.rawUnit.trim().toLowerCase() === name.toLowerCase()) return false;
        return true;
      });
      if (productRows.length === 0) throw new Error("Aucun produit n'a pu être extrait de ce fichier.");

      const cleaned = productRows.map((r) => ({
        code: r.rawCode,
        name: r.rawName,
        description: r.rawDescription,
        unit: r.rawUnit,
        price: r.rawPrice === undefined ? undefined : Math.round(r.rawPrice * 100) / 100,
      }));

      // Same lookup as the real import, so the preview never disagrees with the result.
      const matches: Array<{ existingName?: string; existingCode?: string; currentPrice?: number; matchedBy: "code" | "name" | null }> = [];
      for (let i = 0; i < cleaned.length; i += 200) {
        const chunk = cleaned.slice(i, i + 200).map((r) => ({ code: r.code, name: r.name }));
        matches.push(...(await ctx.runQuery(api.products.previewCatalogRows, { countryId, rows: chunk })));
      }
      // Regroupement des doublons DANS LE FICHIER : uniquement par code IMPA, comparé indépendamment de sa
      // ponctuation ("23.30-34" = "23/30/34" = "233034", voir lib/normalize.ts) - deux lignes qui partagent un
      // code désignent forcément le même article, une seule sera importée. Deux lignes qui ne partagent PAS de
      // code (même si leur nom se ressemble) sont volontairement laissées distinctes : ça peut être deux
      // articles différents, chacune est importable séparément ou peut être décochée. "groupOf" = index de la
      // première ligne du groupe (elle-même si elle n'a pas de code, ou si c'est la première occurrence de son code).
      const rootByCode = new Map<string, number>();
      const flagged = cleaned.map((r, i) => {
        const key = r.code ? normalizeCode(r.code) : undefined;
        const root = key ? (rootByCode.get(key) ?? i) : i;
        if (key && root === i) rootByCode.set(key, i);
        return { ...r, ...matches[i], groupOf: root, duplicate: root !== i };
      });
      return {
        rows: flagged,
        stats: {
          sheets: tables.length,
          read: rows.length,
          ignored: rows.length - productRows.length,
          duplicates: flagged.filter((r) => r.duplicate).length,
        },
      };
    } finally {
      await ctx.storage.delete(storageId);
    }
  },
});
