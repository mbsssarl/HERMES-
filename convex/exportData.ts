import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { DEFAULT_CURRENCY } from "./lib/productPricing";

/** Everything the Excel export of a quotation needs, in display order. */
export const getForExport = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    const client = await ctx.db.get(order.clientId);
    const country = await ctx.db.get(order.countryId);
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .order("asc")
      .collect();
    items.sort((a, b) => a.lineNo - b.lineNo);
    // Currency label of the exported file: the one chosen on the quotation (conversion active - every
    // amount is then in that currency), else the first line's own recorded currency, else the default.
    const currency = order.exportCurrency ?? items.find((i) => i.priceCurrency)?.priceCurrency ?? DEFAULT_CURRENCY;
    return { order, client, country, currency, items };
  },
});
