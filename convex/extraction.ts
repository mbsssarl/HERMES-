"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { mapRowsToClientItems, mapRowsToSupplierItems } from "./lib/extraction/columnMapping";
import { extractDocumentMetadata } from "./lib/extraction/documentMetadata";
import { parseFileToTable } from "./lib/extraction/parseFile";

export const extractClientDocument = internalAction({
  args: { uploadedFileId: v.id("uploadedFiles") },
  handler: async (ctx, { uploadedFileId }) => {
    const file = await ctx.runQuery(internal.files.getFileInternal, { uploadedFileId });
    if (!file) return;

    await ctx.runMutation(internal.files.setFileStatusInternal, {
      uploadedFileId,
      status: "extracting",
    });

    try {
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) throw new Error("Fichier introuvable dans le stockage.");
      const buffer = await blob.arrayBuffer();

      const table = await parseFileToTable(file.mimeType, buffer);
      const items = mapRowsToClientItems(table.headerRow, table.dataRows);
      if (items.length === 0) {
        throw new Error("Aucune ligne d'article n'a pu être extraite de ce document.");
      }
      const metadata = extractDocumentMetadata(table.preambleRows);

      await ctx.runMutation(internal.orderItems.saveExtractedItemsInternal, {
        orderId: file.orderId,
        items,
        metadata,
      });

      await ctx.runMutation(internal.files.setFileStatusInternal, {
        uploadedFileId,
        status: "extracted",
      });
    } catch (err) {
      await ctx.runMutation(internal.files.setFileStatusInternal, {
        uploadedFileId,
        status: "error",
        extractionError: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

export const extractSupplierFile = internalAction({
  args: { uploadedFileId: v.id("uploadedFiles") },
  handler: async (ctx, { uploadedFileId }) => {
    const file = await ctx.runQuery(internal.files.getFileInternal, { uploadedFileId });
    if (!file) return;

    await ctx.runMutation(internal.files.setFileStatusInternal, {
      uploadedFileId,
      status: "extracting",
    });

    try {
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) throw new Error("Fichier introuvable dans le stockage.");
      const buffer = await blob.arrayBuffer();

      const table = await parseFileToTable(file.mimeType, buffer);
      const items = mapRowsToSupplierItems(table.headerRow, table.dataRows);
      if (items.length === 0) {
        throw new Error("Aucune ligne n'a pu être extraite de ce fichier fournisseur.");
      }

      await ctx.runMutation(internal.supplierItems.saveExtractedSupplierItemsInternal, {
        orderId: file.orderId,
        uploadedFileId,
        items,
      });

      await ctx.runMutation(internal.files.setFileStatusInternal, {
        uploadedFileId,
        status: "extracted",
      });
    } catch (err) {
      await ctx.runMutation(internal.files.setFileStatusInternal, {
        uploadedFileId,
        status: "error",
        extractionError: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

export const generateSupplierTemplate = action({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const user = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!user) throw new Error("Authentification requise.");

    const ExcelJS = await import("exceljs");
    const unmatchedItems = await ctx.runQuery(internal.orderItems.listUnmatchedInternal, { orderId });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Articles non répertoriés");
    sheet.columns = [
      { header: "No.", key: "no", width: 6 },
      { header: "Code", key: "code", width: 14 },
      { header: "Description", key: "description", width: 40 },
      { header: "Quantity", key: "quantity", width: 10 },
      { header: "Unit", key: "unit", width: 10 },
      { header: "Origin", key: "origin", width: 12 },
      { header: "Quoted Qty", key: "quotedQty", width: 12 },
      { header: "Unit Price", key: "unitPrice", width: 12 },
      { header: "Total", key: "total", width: 12 },
      { header: "Discount (%)", key: "discount", width: 12 },
      { header: "Final Price", key: "finalPrice", width: 12 },
      { header: "Req Notes", key: "reqNotes", width: 24 },
      { header: "Enq Notes", key: "enqNotes", width: 24 },
    ];
    sheet.getRow(1).font = { bold: true };

    unmatchedItems.forEach((item, index) => {
      sheet.addRow({
        no: index + 1,
        code: item.rawCode ?? "",
        description: item.rawDescription,
        quantity: item.rawQuantity ?? "",
        unit: item.rawUnit ?? "",
        origin: item.rawOrigin ?? "",
        quotedQty: "",
        unitPrice: "",
        total: "",
        discount: "",
        finalPrice: "",
        reqNotes: item.reqNotes ?? "",
        enqNotes: item.enqNotes ?? "",
      });
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([arrayBuffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const storageId = await ctx.storage.store(blob);

    const fileId: Id<"uploadedFiles"> = await ctx.runMutation(
      internal.files.registerGeneratedFileInternal,
      {
        orderId,
        storageId,
        kind: "generated_supplier_template",
        fileName: "articles_non_repertories.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: (arrayBuffer as ArrayBuffer).byteLength,
        uploadedBy: user._id,
      },
    );

    return fileId;
  },
});
