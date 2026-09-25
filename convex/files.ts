import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireUser } from "./lib/permissions";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const listByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("uploadedFiles")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .order("desc")
      .collect();
  },
});

export const registerUploadedFile = mutation({
  args: {
    orderId: v.id("orders"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("client_request"), v.literal("supplier_response")),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    if (args.size > MAX_FILE_SIZE_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Fichier trop volumineux (15 Mo max).");
    }
    if (!ALLOWED_MIME_TYPES.has(args.mimeType)) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Type de fichier non autorisé (PDF, Excel ou Word uniquement).");
    }

    const uploadedFileId = await ctx.db.insert("uploadedFiles", {
      orderId: args.orderId,
      kind: args.kind,
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      size: args.size,
      status: "uploaded",
      uploadedBy: user._id,
      uploadedAt: Date.now(),
    });

    const extractAction =
      args.kind === "client_request"
        ? internal.extraction.extractClientDocument
        : internal.extraction.extractSupplierFile;

    await ctx.scheduler.runAfter(0, extractAction, { uploadedFileId });

    return uploadedFileId;
  },
});

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    await requireUser(ctx);
    return await ctx.storage.getUrl(storageId);
  },
});

export const getFileInternal = internalQuery({
  args: { uploadedFileId: v.id("uploadedFiles") },
  handler: async (ctx, { uploadedFileId }) => {
    return await ctx.db.get(uploadedFileId);
  },
});

export const setFileStatusInternal = internalMutation({
  args: {
    uploadedFileId: v.id("uploadedFiles"),
    status: v.union(
      v.literal("uploaded"),
      v.literal("extracting"),
      v.literal("extracted"),
      v.literal("error"),
    ),
    extractionError: v.optional(v.string()),
  },
  handler: async (ctx, { uploadedFileId, status, extractionError }) => {
    await ctx.db.patch(uploadedFileId, { status, extractionError });
  },
});

export const registerGeneratedFileInternal = internalMutation({
  args: {
    orderId: v.id("orders"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("generated_supplier_template"), v.literal("generated_quotation")),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    uploadedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("uploadedFiles", {
      ...args,
      status: "extracted",
      uploadedAt: Date.now(),
    });
  },
});
