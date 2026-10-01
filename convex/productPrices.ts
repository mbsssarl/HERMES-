import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { logActivity } from "./lib/audit";
import { requireAdmin, requireUser } from "./lib/permissions";
import { noteCatalogUpdate } from "./lib/catalogUpdates";
import { repriceOrderItem } from "./lib/matching";
import { getCurrentPrice, setCurrentPrice } from "./lib/productPricing";
import { mutation, query } from "./_generated/server";

/** Current (and, optionally, historical) prices of a product, one row per country. */
export const listForProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("productPrices")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();

    const current = rows.filter((r) => r.validTo === undefined);
    return await Promise.all(
      current.map(async (row) => ({ ...row, country: await ctx.db.get(row.countryId) })),
    );
  },
});

export const getCurrentForProductAndCountry = query({
  args: { productId: v.id("products"), countryId: v.id("countries") },
  handler: async (ctx, { productId, countryId }) => {
    await requireUser(ctx);
    return await getCurrentPrice(ctx, productId, countryId);
  },
});

/**
 * Sets (creates or updates) the price of a product for one country. Closes
 * the previous price row instead of overwriting it (history preserved), then
 * re-prices every order line that was waiting on this exact product/country
 * combination - this is what makes a newly-added price appear in real time
 * on commandes that were showing "prix manquant".
 */
export const setPrice = mutation({
  args: {
    productId: v.id("products"),
    countryId: v.id("countries"),
    price: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (!(args.price >= 0)) throw new Error("Prix invalide.");
    const previous = await getCurrentPrice(ctx, args.productId, args.countryId);
    const price = Math.round(args.price * 100) / 100;

    // No new price row when nothing changed.
    if (previous && previous.price === price) return;
    await setCurrentPrice(ctx, { ...args, price, actorId: admin._id });

    await logActivity(ctx, {
      userId: admin._id,
      action: "product.price_set",
      entityType: "product",
      entityId: args.productId,
      metadata: { countryId: args.countryId, oldPrice: previous?.price, newPrice: price },
    });

    const affectedItems = await ctx.db
      .query("orderItems")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();

    const wave = Date.now();
    const repriced = new Map<Id<"orders">, number>();
    for (const item of affectedItems) {
      if (item.unitPriceOriginal !== undefined) continue;
      const order = await ctx.db.get(item.orderId);
      if (order?.countryId === args.countryId) {
        await repriceOrderItem(ctx, item);
        repriced.set(item.orderId, (repriced.get(item.orderId) ?? 0) + 1);
      }
    }
    for (const [orderId, lines] of repriced) await noteCatalogUpdate(ctx, orderId, lines, admin.email ?? undefined, wave);
  },
});

/** Current price of every product for every country (one row each) - feeds the catalogue price grid. */
export const listAllCurrent = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("productPrices").collect();
    return rows.filter((r) => r.validTo === undefined);
  },
});
