"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { mapRowsToValidationItems } from "./lib/extraction/columnMapping";
import { parseFileToTable } from "./lib/extraction/parseFile";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * « Valider la commande » : lit le fichier final du client (le même document que sa demande de cotation, mais
 * avec seulement les articles qu'il veut recevoir, leurs quantités et leurs prix) et en enregistre les lignes.
 * Rien n'est enregistré si le fichier est illisible ou ne contient aucun article.
 */
export const importValidationFile = action({
  args: { orderId: v.id("orders"), storageId: v.id("_storage"), mimeType: v.string(), fileName: v.string() },
  handler: async (ctx, { orderId, storageId, mimeType, fileName }): Promise<{ lines: number; matched: number }> => {
    const user = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!user) {
      await ctx.storage.delete(storageId);
      throw new Error("Authentification requise.");
    }

    try {
      if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error("Type de fichier non autorisé (PDF, Excel ou Word uniquement).");
      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new Error("Fichier introuvable dans le stockage.");
      if (blob.size > MAX_FILE_SIZE_BYTES) throw new Error("Fichier trop volumineux (15 Mo max).");

      const table = await parseFileToTable(mimeType, await blob.arrayBuffer());
      const items = mapRowsToValidationItems(table.headerRow, table.dataRows);
      if (items.length === 0) throw new Error("Aucun article n'a pu être lu dans ce fichier.");

      return await ctx.runMutation(internal.orderValidation.saveValidation, {
        orderId,
        userId: user._id,
        storageId,
        fileName,
        mimeType,
        size: blob.size,
        items: items.map((it) => ({
          lineRef: it.lineRef,
          rawCode: it.rawCode,
          description: it.rawDescription,
          quantity: it.rawQuantity ?? it.quotedQuantity,
          unit: it.rawUnit,
          unitPrice: it.unitPrice,
        })),
      });
    } catch (err) {
      // Le fichier n'a pas été retenu : on ne laisse pas traîner l'envoi temporaire.
      await ctx.storage.delete(storageId).catch(() => {});
      throw err;
    }
  },
});
