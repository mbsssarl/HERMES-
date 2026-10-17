"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { round2 } from "./lib/pricing";
import { renderQuotationPdf } from "./lib/pdf/quotationPdf";

export const generateQuotation = action({
  args: { orderId: v.id("orders") },
  // Explicit return type breaks a circular type-inference loop: this
  // handler calls internal.quotations.saveQuotationInternal, whose type
  // comes from the generated api graph that itself includes this very
  // function - without an annotation here, TS can't resolve the cycle.
  handler: async (ctx, { orderId }): Promise<Id<"quotations">> => {
    const user = await ctx.runQuery(api.users.getBusinessUser, {});
    if (!user) throw new Error("Authentification requise.");

    await ctx.runAction(api.orders.ensureBaseRates, { orderId });
    const data = await ctx.runQuery(internal.quotations.getQuotationBuildDataInternal, { orderId, companyId: user.companyId! });
    if (!data) throw new Error("Commande introuvable.");
    if (data.matchedItems.length === 0) {
      throw new Error("Aucun article répertorié à inclure dans la quotation.");
    }

    // Conversion de devise appliquée sur la quotation (taux figés, un par devise d'origine - voir
    // orders.applyExportCurrency) : le PDF doit ressortir dans la même devise que le fichier exporté.
    // Une devise sans taux enregistré (ligne ajoutée après) reste inchangée, comme dans l'export Excel.
    const exportRates = data.order.exportRates;
    const rateFor = (itemCurrency: string | undefined): number => {
      if (!exportRates) return 1;
      return exportRates.find((r) => r.currency === (itemCurrency ?? data.currency))?.rate ?? 1;
    };
    const outputCurrency = data.order.exportCurrency ?? data.currency;

    const lines = data.matchedItems.map((item) => {
      const quantity = item.quotedQuantity ?? item.rawQuantity ?? 1;
      const rate = rateFor(item.priceCurrency);
      // Line total already computed without intermediate rounding (lib/pricing.ts). The global discount
      // applies to the whole total below, not to lines.
      const total = round2((item.total ?? 0) * rate);
      const finalPrice = round2((item.finalUnitPrice ?? 0) * rate);

      return {
        code: item.rawCode ?? item.product?.impaId,
        description: item.rawDescription,
        unit: item.rawUnit ?? item.product?.unit ?? "",
        quantity,
        unitPrice: (item.finalUnitPrice ?? 0) * rate,
        discountPercent: 0,
        finalPrice,
        total,
      };
    });
    const subtotal = round2(lines.reduce((sum, l) => sum + l.total, 0));
    const discountPercent = data.order.globalDiscountPercent ?? 0;
    const discountAmount = round2((subtotal * discountPercent) / 100);
    const grandTotal = round2(subtotal - discountAmount);

    const pdfBuffer = await renderQuotationPdf({
      reference: data.order.reference,
      date: new Date().toLocaleDateString("fr-FR"),
      clientName: data.client?.name ?? "",
      clientAddress: data.client?.address,
      companyName: data.companyInfo?.name ?? "Notre entreprise",
      companyAddress: data.companyInfo?.address,
      companyEmail: data.companyInfo?.email,
      vessel: data.order.vessel,
      eta: data.order.eta,
      supplyPlace: data.order.supplyPlace,
      lines,
      subtotal,
      discountPercent,
      discountAmount,
      grandTotal,
      currency: outputCurrency,
    });

    const blob = new Blob([Uint8Array.from(pdfBuffer)], { type: "application/pdf" });
    const storageId = await ctx.storage.store(blob);

    const quotationId = await ctx.runMutation(internal.quotations.saveQuotationInternal, {
      orderId,
      snapshotItems: lines,
      grandTotal,
      pdfStorageId: storageId,
      generatedBy: user._id,
    });

    return quotationId;
  },
});
