"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { buildQuotationWorkbook } from "./lib/export/buildQuotationWorkbook";

/**
 * Exports the quotation (after cotation and discounts) as an Excel file that reproduces the MBSS
 * template exactly. Returned as base64 so the browser can save it under a proper file name.
 */
export const exportQuotationXlsx = action({
  args: {
    orderId: v.id("orders"),
    // selected: checked lines · known: checked lines matched to the catalogue · unknown: checked lines not
    // matched (or still to confirm) · all: every line, checked or not.
    scope: v.union(v.literal("selected"), v.literal("known"), v.literal("unknown"), v.literal("all")),
  },
  handler: async (ctx, { orderId, scope }): Promise<{ fileName: string; base64: string }> => {
    const user = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!user) throw new Error("Authentification requise.");

    const data = await ctx.runQuery(internal.exportData.getForExport, { orderId });
    if (!data) throw new Error("Commande introuvable.");
    const { order, client, country } = data;

    const isKnown = (status: string) => status === "matched_impa" || status === "matched_name" || status === "manual";
    const items = data.items.filter((item) => {
      if (scope === "all") return true;
      if (item.excluded) return false;
      if (scope === "known") return isKnown(item.matchStatus);
      if (scope === "unknown") return !isKnown(item.matchStatus);
      return true;
    });
    if (items.length === 0) throw new Error("Aucune ligne à exporter pour ce choix.");
    const suffix = { selected: "", known: " - repertories", unknown: " - non repertories", all: " - tout" }[scope];

    const buffer = await buildQuotationWorkbook({
      reference: order.reference,
      currency: country?.currency ?? "",
      vessel: order.vessel,
      eta: order.eta,
      port: order.supplyPlace,
      category: order.documentInfo?.category,
      paymentDays: order.documentInfo?.paymentDays,
      items: items.map((item) => ({
        description: item.rawDescription,
        unit: item.rawUnit,
        quantity: item.quotedQuantity ?? item.rawQuantity ?? 1,
        unitPrice: item.priceAfterQuotation,
        discountPercent: item.lineDiscountPercent ?? 0,
        finalTotal: item.total,
        remarks: [item.reqNotes, item.enqNotes].filter(Boolean).join(" ") || undefined,
      })),
    });

    const safeClient = (client?.name ?? "").replace(/[\\/:*?"<>|]/g, " ").trim();
    return {
      fileName: `MBSS RFQ ${order.reference}${safeClient ? ` ${safeClient}` : ""}${suffix}.xlsx`,
      base64: buffer.toString("base64"),
    };
  },
});
