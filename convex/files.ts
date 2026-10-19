import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getAnyUser, getOwned, requireOrder, requireUser } from "./lib/permissions";
import { isSupportedUpload, normalizedMimeType } from "./lib/extraction/fileKinds";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // Le super admin envoie le logo de la plateforme ; les autres comptes doivent appartenir à une entreprise active.
    const user = await getAnyUser(ctx);
    if (user?.role !== "superadmin") await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const listByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const user = await requireUser(ctx);
    await requireOrder(ctx, user, orderId);
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
    await requireOrder(ctx, user, args.orderId).catch(async (err) => {
      // Fichier déjà envoyé au stockage mais commande refusée : on ne le garde pas.
      await ctx.storage.delete(args.storageId);
      throw err;
    });

    if (args.size > MAX_FILE_SIZE_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Fichier trop volumineux (15 Mo max).");
    }
    if (!isSupportedUpload(args.fileName, args.mimeType)) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Type de fichier non autorisé (PDF, Excel .xlsx/.xls ou Word .docx).");
    }

    const uploadedFileId = await ctx.db.insert("uploadedFiles", {
      orderId: args.orderId,
      kind: args.kind,
      storageId: args.storageId,
      fileName: args.fileName.toLowerCase(), // le nom d'un fichier déposé est toujours en minuscules
      mimeType: normalizedMimeType(args.fileName, args.mimeType),
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

/**
 * Adresse d'un fichier du stockage (fichier déposé ou PDF de quotation), seulement s'il appartient à une commande
 * de l'entreprise de l'utilisateur ; sinon null. Un identifiant de stockage d'une autre entreprise ne donne rien.
 */
export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const user = await requireUser(ctx);
    const file = await ctx.db.query("uploadedFiles").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first();
    const quotation = file ? null : await ctx.db.query("quotations").withIndex("by_pdf", (q) => q.eq("pdfStorageId", storageId)).first();
    const orderId = file?.orderId ?? quotation?.orderId;
    if (!orderId || !(await getOwned(ctx, user, "orders", orderId))) return null;
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
    // Le fichier généré est rattaché à une commande de l'entreprise de l'utilisateur qui l'a demandé.
    const uploader = await ctx.db.get(args.uploadedBy);
    const order = await ctx.db.get(args.orderId);
    if (!uploader?.companyId || !order || order.companyId !== uploader.companyId) throw new Error("Commande introuvable.");
    return await ctx.db.insert("uploadedFiles", {
      ...args,
      status: "extracted",
      uploadedAt: Date.now(),
    });
  },
});
