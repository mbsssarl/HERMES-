"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { buildQuotationWorkbook } from "./lib/export/buildQuotationWorkbook";
import { DEFAULT_CURRENCY } from "./lib/productPricing";

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
    const { order, client, country, currency } = data;
    // Taux figés au moment où l'admin a choisi la devise d'export (convex/orders.ts:applyExportCurrency),
    // un par devise d'origine réellement présente parmi les lignes - pas de conversion si aucune devise
    // cible n'a été appliquée. Une ligne sans priceCurrency propre (prix manuel ancien) retombe sur la
    // devise par défaut de l'entreprise.
    const rateFor = (itemCurrency: string | undefined): number => {
      if (!order.exportRates) return 1;
      const match = order.exportRates.find((r) => r.currency === (itemCurrency ?? DEFAULT_CURRENCY));
      return match?.rate ?? 1;
    };

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
      currency,
      vessel: order.vessel,
      eta: order.eta,
      port: order.supplyPlace,
      city: country?.city,
      category: order.documentInfo?.category,
      paymentDays: order.documentInfo?.paymentDays,
      discountPercent: order.globalDiscountPercent ?? 0,
      items: items.map((item) => ({
        code: item.rawCode,
        description: item.rawDescription,
        unit: item.rawUnit,
        quantity: item.quotedQuantity ?? item.rawQuantity ?? 1,
        unitPrice: item.priceAfterQuotation !== undefined ? item.priceAfterQuotation * rateFor(item.priceCurrency) : item.priceAfterQuotation,
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
