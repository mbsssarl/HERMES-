"use node";

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { mapRowsToSupplierItems } from "./lib/extraction/columnMapping";
import { parseFileToTable } from "./lib/extraction/parseFile";

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
      const table = await parseFileToTable(mimeType, await blob.arrayBuffer());
      const rows = mapRowsToSupplierItems(table.headerRow, table.dataRows);
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
      const matches: Array<{ existingName?: string; existingCode?: string; currentPrice?: number }> = [];
      for (let i = 0; i < cleaned.length; i += 200) {
        const chunk = cleaned.slice(i, i + 200).map((r) => ({ code: r.code, name: r.name }));
        matches.push(...(await ctx.runQuery(api.products.previewCatalogRows, { countryId, rows: chunk })));
      }
      return cleaned.map((r, i) => ({ ...r, ...matches[i] }));
    } finally {
      await ctx.storage.delete(storageId);
    }
  },
});
