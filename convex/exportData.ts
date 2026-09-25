import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

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
    return { order, client, country, items };
  },
});
