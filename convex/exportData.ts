import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/** Everything the Excel export of a quotation needs, in display order. */
export const getForExport = internalQuery({
  args: { orderId: v.id("orders"), companyId: v.id("companies") },
  handler: async (ctx, { orderId, companyId }) => {
    const order = await ctx.db.get(orderId);
    // Une commande d'une autre entreprise est traitée comme absente.
    if (!order || order.companyId !== companyId) return null;
    const client = await ctx.db.get(order.clientId);
    const country = await ctx.db.get(order.countryId);
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .order("asc")
      .collect();
    items.sort((a, b) => a.lineNo - b.lineNo);
    // Currency label of the exported file: the one chosen on the quotation, else USD (base currency).
    const currency = order.exportCurrency ?? "USD";
    // Fichier d'origine du client (le premier importé) : sert de gabarit à l'envoi au client.
    const files = await ctx.db.query("uploadedFiles").withIndex("by_order", (q) => q.eq("orderId", orderId)).order("asc").collect();
    // On préfère le premier fichier lu avec succès : un envoi précédent resté en erreur ne doit pas servir de gabarit.
    const clientFiles = files.filter((f) => f.kind === "client_request");
    const clientFile = clientFiles.find((f) => f.status === "extracted") ?? clientFiles[0] ?? null;
    return { order, client, country, currency, items, clientFile };
  },
});
