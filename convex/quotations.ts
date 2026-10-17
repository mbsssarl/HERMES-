import { v } from "convex/values";
import { logActivity } from "./lib/audit";
import { getOwned, requireAdmin, requireOrder, requireUser } from "./lib/permissions";
import { COMPANY_INFO_KEY } from "./settings";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const listByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const user = await requireUser(ctx);
    await requireOrder(ctx, user, orderId);
    return await ctx.db
      .query("quotations")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .order("desc")
      .collect();
  },
});

export const getQuotationBuildDataInternal = internalQuery({
  args: { orderId: v.id("orders"), companyId: v.id("companies") },
  handler: async (ctx, { orderId, companyId }) => {
    const order = await ctx.db.get(orderId);
    // Une commande d'une autre entreprise est traitée comme absente.
    if (!order || order.companyId !== companyId) return null;
    const client = await ctx.db.get(order.clientId);

    // Only lines with an actual price are included: a matched-but-no-price
    // line ("prix manquant") can't sensibly appear on a priced quotation.
    const allItems = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();
    const matchedItems = await Promise.all(
      allItems
        .filter(
          (i) =>
            !i.excluded &&
            i.unitPriceOriginal !== undefined &&
            ((i.matchStatus !== "unmatched" && i.matchStatus !== "ambiguous") || i.unitPriceManual !== undefined),
        )
        .map(async (i) => ({ ...i, product: i.productId ? await ctx.db.get(i.productId) : null })),
    );

    const companyInfoSetting = await ctx.db
      .query("settings")
      .withIndex("by_company_and_key", (q) => q.eq("companyId", companyId).eq("key", COMPANY_INFO_KEY))
      .unique();

    return {
      order,
      client,
      matchedItems,
      companyInfo: companyInfoSetting?.value as
        | { name?: string; address?: string; email?: string }
        | undefined,
      currency: order.exportCurrency ?? "USD",
    };
  },
});

const snapshotLineValidator = v.object({
  code: v.optional(v.string()),
  description: v.string(),
  unit: v.string(),
  quantity: v.number(),
  unitPrice: v.number(),
  discountPercent: v.number(),
  finalPrice: v.number(),
  total: v.number(),
});

export const saveQuotationInternal = internalMutation({
  args: {
    orderId: v.id("orders"),
    snapshotItems: v.array(snapshotLineValidator),
    grandTotal: v.number(),
    pdfStorageId: v.id("_storage"),
    generatedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const author = await ctx.db.get(args.generatedBy);
    const target = await ctx.db.get(args.orderId);
    if (!author?.companyId || !target || target.companyId !== author.companyId) throw new Error("Commande introuvable.");
    const previous = await ctx.db
      .query("quotations")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();
    const version = previous.length + 1;

    const quotationId = await ctx.db.insert("quotations", {
      orderId: args.orderId,
      version,
      snapshotItems: args.snapshotItems,
      grandTotal: args.grandTotal,
      pdfStorageId: args.pdfStorageId,
      generatedAt: Date.now(),
      generatedBy: args.generatedBy,
    });

    const order = await ctx.db.get(args.orderId);
    if (order && order.status !== "sent" && order.status !== "archived") {
      await ctx.db.patch(args.orderId, { status: "completed", updatedAt: Date.now() });
    }

    await logActivity(ctx, {
      userId: args.generatedBy,
      action: "quotation.generated",
      entityType: "quotation",
      entityId: quotationId,
      metadata: { orderId: args.orderId, version, grandTotal: args.grandTotal },
    });

    return quotationId;
  },
});

export const getQuotationInternal = internalQuery({
  args: { quotationId: v.id("quotations"), companyId: v.id("companies") },
  handler: async (ctx, { quotationId, companyId }) => {
    const quotation = await ctx.db.get(quotationId);
    if (!quotation) return null;
    // Le devis doit appartenir à une commande de l'entreprise de l'appelant.
    const order = await ctx.db.get(quotation.orderId);
    return order && order.companyId === companyId ? quotation : null;
  },
});

export const approve = mutation({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, { quotationId }) => {
    const admin = await requireAdmin(ctx);
    const quotation = await ctx.db.get(quotationId);
    if (!quotation) throw new Error("Devis introuvable.");
    await requireOrder(ctx, admin, quotation.orderId);
    await ctx.db.patch(quotationId, {
      approvedByAdmin: true,
      approvedBy: admin._id,
      approvedAt: Date.now(),
    });
    await logActivity(ctx, {
      userId: admin._id,
      action: "quotation.approved",
      entityType: "quotation",
      entityId: quotationId,
    });
  },
});

export const recordEmailSentInternal = internalMutation({
  args: {
    orderId: v.id("orders"),
    quotationId: v.id("quotations"),
    to: v.string(),
    subject: v.string(),
    message: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    providerMessageId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    sentBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const sender = await ctx.db.get(args.sentBy);
    const target = await ctx.db.get(args.orderId);
    if (!sender?.companyId || !target || target.companyId !== sender.companyId) throw new Error("Commande introuvable.");
    await ctx.db.insert("emailLogs", { ...args, sentAt: Date.now() });

    if (args.status === "sent") {
      await ctx.db.patch(args.orderId, { status: "sent", sentAt: Date.now(), updatedAt: Date.now() });
    }

    await logActivity(ctx, {
      userId: args.sentBy,
      action: args.status === "sent" ? "quotation.emailed" : "quotation.email_failed",
      entityType: "order",
      entityId: args.orderId,
      metadata: { to: args.to, subject: args.subject, status: args.status },
    });
  },
});

export const listEmailLogs = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const user = await requireUser(ctx);
    await requireOrder(ctx, user, orderId);
    return await ctx.db
      .query("emailLogs")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .order("desc")
      .collect();
  },
});
