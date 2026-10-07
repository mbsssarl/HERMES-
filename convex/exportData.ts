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
    // Currency label of the exported file: the one chosen on the quotation, else the pricing country's.
    const currency = order.exportCurrency ?? country?.currency ?? "";
    // Fichier d'origine du client (le premier importé) : sert de gabarit à l'envoi au client.
    const files = await ctx.db.query("uploadedFiles").withIndex("by_order", (q) => q.eq("orderId", orderId)).order("asc").collect();
    const clientFile = files.find((f) => f.kind === "client_request") ?? null;
    return { order, client, country, currency, items, clientFile };
  },
});
