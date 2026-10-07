import { v } from "convex/values";
import { logActivity } from "./lib/audit";
import { requireAdmin, requireUser } from "./lib/permissions";
import { COMPANY_INFO_KEY } from "./settings";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const listByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("quotations")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .order("desc")
      .collect();
  },
});

export const getQuotationBuildDataInternal = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    const client = await ctx.db.get(order.clientId);
    const country = await ctx.db.get(order.countryId);

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
      .withIndex("by_key", (q) => q.eq("key", COMPANY_INFO_KEY))
      .unique();

    return {
      order,
      client,
      matchedItems,
      companyInfo: companyInfoSetting?.value as
        | { name?: string; address?: string; email?: string }
        | undefined,
      currency: country?.currency ?? "XAF",
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
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, { quotationId }) => {
    return await ctx.db.get(quotationId);
  },
});

export const approve = mutation({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, { quotationId }) => {
    const admin = await requireAdmin(ctx);
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
    await requireUser(ctx);
    return await ctx.db
      .query("emailLogs")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .order("desc")
      .collect();
  },
});
