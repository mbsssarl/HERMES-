import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { insertProduct } from "./products";
import { normalizeCode, normalizeName } from "./lib/normalize";
import { rematchOrderItem } from "./lib/matching";
import { getCurrentPrice, setCurrentPrice } from "./lib/productPricing";
import { requireUser } from "./lib/permissions";
import { logActivity } from "./lib/audit";
import { internalMutation, mutation, query } from "./_generated/server";

export const listByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("supplierItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();
  },
});

export const update = mutation({
  args: {
    supplierItemId: v.id("supplierItems"),
    rawCode: v.optional(v.string()),
    rawName: v.optional(v.string()),
    rawDescription: v.optional(v.string()),
    rawUnit: v.optional(v.string()),
    rawPrice: v.optional(v.number()),
  },
  handler: async (ctx, { supplierItemId, ...patch }) => {
    await requireUser(ctx);
    await ctx.db.patch(supplierItemId, patch);
  },
});

export const reject = mutation({
  args: { supplierItemId: v.id("supplierItems") },
  handler: async (ctx, { supplierItemId }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(supplierItemId, { status: "rejected", validatedBy: user._id, validatedAt: Date.now() });
  },
});

/**
 * Validates staged supplier lines: creates catalogue products (or, when the
 * product already exists but has no price yet for the order's country,
 * simply adds that price), then re-matches/re-prices the whole order.
 */
export const saveToCatalog = mutation({
  args: { supplierItemIds: v.array(v.id("supplierItems")) },
  handler: async (ctx, { supplierItemIds }) => {
    const user = await requireUser(ctx);
    const affectedOrderIds = new Set<Id<"orders">>();

    for (const id of supplierItemIds) {
      const item = await ctx.db.get(id);
      if (!item || item.status !== "pending_validation") continue;

      if (!item.rawUnit || item.rawPrice === undefined) {
        throw new Error(`Ligne "${item.rawName}" : unité et prix sont requis avant enregistrement.`);
      }

      const order = await ctx.db.get(item.orderId);
      if (!order) continue;
      const country = await ctx.db.get(order.countryId);
      if (!country) continue;

      const productId =
        item.duplicateOfProductId ??
        (await insertProduct(
          ctx,
          {
            impaId: item.rawCode,
            code: item.rawCode,
            name: item.rawName,
            description: item.rawDescription,
            unit: item.rawUnit,
          },
          user._id,
          "supplier_import",
          item.orderId,
        ));

      await setCurrentPrice(ctx, {
        productId,
        countryId: order.countryId,
        price: item.rawPrice,
        currency: country.currency,
        actorId: user._id,
      });

      await ctx.db.patch(id, { status: "validated", validatedBy: user._id, validatedAt: Date.now() });
      await logActivity(ctx, {
        userId: user._id,
        action: item.duplicateOfProductId ? "product.price_set" : "product.created_from_supplier",
        entityType: "product",
        entityId: productId,
        metadata: { name: item.rawName, orderId: item.orderId, countryId: order.countryId },
      });
      affectedOrderIds.add(item.orderId);
    }

    // Re-match/re-price every line of every affected order - a freshly
    // added product or price may resolve lines other than the one it came
    // from. rematchOrderItem no-ops on lines that need neither.
    for (const orderId of affectedOrderIds) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) => q.eq("orderId", orderId))
        .collect();
      for (const orderItem of items) {
        await rematchOrderItem(ctx, orderItem);
      }
    }
  },
});

export const saveExtractedSupplierItemsInternal = internalMutation({
  args: {
    orderId: v.id("orders"),
    uploadedFileId: v.id("uploadedFiles"),
    items: v.array(
      v.object({
        rawCode: v.optional(v.string()),
        rawName: v.string(),
        rawDescription: v.optional(v.string()),
        rawUnit: v.optional(v.string()),
        rawPrice: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { orderId, uploadedFileId, items }) => {
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Commande introuvable.");

    const orderItems = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();

    for (const raw of items) {
      let existingProductId: Id<"products"> | undefined;
      if (raw.rawCode) {
        const existing = await ctx.db
          .query("products")
          .withIndex("by_normalizedImpaId", (q) => q.eq("normalizedImpaId", normalizeCode(raw.rawCode!)))
          .filter((q) => q.eq(q.field("deletedAt"), undefined))
          .unique();
        existingProductId = existing?._id;
      }

      // A matching product already exists: only a true "duplicate" (nothing
      // to do) if it already has a price for this order's country - if not,
      // this line still needs processing (to add that missing price).
      let status: "pending_validation" | "duplicate" = "pending_validation";
      if (existingProductId) {
        const existingPrice = await getCurrentPrice(ctx, existingProductId, order.countryId);
        if (existingPrice) status = "duplicate";
      }

      const normalizedRawName = normalizeName(raw.rawName);
      const linkedItem = orderItems.find(
        (oi) =>
          (raw.rawCode && oi.rawCode === raw.rawCode) ||
          normalizeName(oi.rawDescription) === normalizedRawName,
      );

      await ctx.db.insert("supplierItems", {
        orderId,
        uploadedFileId,
        orderItemId: linkedItem?._id,
        rawCode: raw.rawCode,
        rawName: raw.rawName,
        rawDescription: raw.rawDescription,
        rawUnit: raw.rawUnit,
        rawPrice: raw.rawPrice,
        status,
        duplicateOfProductId: existingProductId,
        createdAt: Date.now(),
      });
    }
  },
});
