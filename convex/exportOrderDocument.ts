"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { ExportCompany } from "./lib/export/buildQuotationWorkbook";
import { fetchCompanyLogo } from "./lib/export/logoImage";
import { renderOrderTemplate, type OrderExportData } from "./lib/export/templateEngine";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Exporte un Purchase Order (prix d'achat = prix client moins la marge de la cotation) ou un Delivery Note (même
 * document sans prix) au format Excel, en remplissant le modèle importé par l'entreprise pour ce type de document
 * (voir convex/exportTemplates.ts::resolve). Contrairement à la quotation, il n'y a pas de secours « intégré » ici :
 * c'est à l'appelant (src/components/ValidationDetails.tsx) de n'appeler cette action que si un modèle existe, et
 * de garder l'impression du document actuel sinon (voir convex/lib/export/templateTokens.ts pour les repères).
 */
export const exportOrderDocumentXlsx = action({
  args: {
    orderId: v.id("orders"),
    kind: v.union(v.literal("purchase_order"), v.literal("delivery_note")),
    itemIds: v.array(v.id("orderValidatedItems")),
    // Remise (%) du Purchase Order (sans effet sur un Delivery Note, qui n'a pas de prix).
    discountPercent: v.optional(v.number()),
    templateId: v.optional(v.union(v.id("exportTemplates"), v.null())),
    // En-tête du document, repris de la commande si absent (voir src/lib/printOrderDocument.ts::OrderDocumentInfo).
    info: v.optional(
      v.object({
        vessel: v.optional(v.string()),
        agent: v.optional(v.string()),
        port: v.optional(v.string()),
        orderNo: v.optional(v.string()),
        rfqNo: v.optional(v.string()),
        supplyDate: v.optional(v.string()),
        category: v.optional(v.string()),
        onBehalf: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { orderId, kind, itemIds, discountPercent, templateId, info }): Promise<{ fileName: string; base64: string }> => {
    const user = await ctx.runQuery(api.users.getBusinessUser, {});
    if (!user || !user.companyId) throw new Error("Authentification requise.");

    const data = await ctx.runQuery(internal.exportData.getForExport, { orderId, companyId: user.companyId });
    if (!data) throw new Error("Commande introuvable.");
    const { order, client, country } = data;

    const validation = await ctx.runQuery(api.orderValidation.get, { orderId });
    if (!validation) throw new Error("Aucune validation enregistrée pour cette commande.");
    const wanted = new Set(itemIds);
    const chosen = validation.items.filter((it) => wanted.has(it._id));
    if (chosen.length === 0) throw new Error("Aucune ligne sélectionnée.");

    const template = await ctx.runQuery(internal.exportTemplates.resolve, { companyId: user.companyId, kind, templateId });
    if (!template) {
      const label = kind === "purchase_order" ? "Purchase Order" : "Delivery Note";
      throw new Error(`Aucun modèle d'export n'est configuré pour le ${label} de cette entreprise. Importez-en un depuis Admin > Modèles d'export.`);
    }
    const blob = await ctx.storage.get(template.storageId);
    if (!blob) throw new Error(`Le fichier du modèle « ${template.name} » est introuvable.`);

    const company = ((await ctx.runQuery(api.settings.get, { key: "companyInfo" })) ?? {}) as ExportCompany;
    const brand = await ctx.runQuery(api.branding.get, {});
    const logo = (await fetchCompanyLogo(brand.logoUrl)) ?? undefined;
    const withPrices = kind === "purchase_order";

    const onBehalfRaw = info?.onBehalf !== undefined ? info.onBehalf : order.documentInfo?.issuer ?? "";
    const [onBehalfName = "", ...onBehalfAddressLines] = onBehalfRaw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const exportData: OrderExportData = {
      vessel: info?.vessel !== undefined ? info.vessel : order.vessel,
      agent: info?.agent !== undefined ? info.agent : client?.name,
      port: info?.port !== undefined ? info.port : order.supplyPlace ?? country?.city,
      orderNo: info?.orderNo !== undefined ? info.orderNo : order.clientOrderNumber,
      rfqNo: info?.rfqNo !== undefined ? info.rfqNo : order.documentInfo?.vendorRef ?? order.reference,
      supplyDate: info?.supplyDate !== undefined ? info.supplyDate : order.eta,
      category: info?.category !== undefined ? info.category : order.documentInfo?.category,
      onBehalfName: onBehalfName || undefined,
      onBehalfAddress: onBehalfAddressLines.join("\n") || undefined,
      currency: data.currency,
      company,
      logo,
      discountPercent: withPrices ? discountPercent ?? 0 : 0,
      items: chosen.map((it) => ({
        code: it.rawCode,
        description: it.description,
        unit: it.unit,
        quantity: it.quantity ?? 1,
        unitPrice: withPrices && it.unitPrice !== undefined ? round2(it.unitPrice / (1 + it.marginPercent / 100)) : undefined,
      })),
    };

    const buffer = await renderOrderTemplate(Buffer.from(await blob.arrayBuffer()), exportData);
    const brandFile = brand.name.replace(/[\\/:*?"<>|]/g, " ").trim() || "export";
    const label = kind === "purchase_order" ? "PO" : "DN";
    return { fileName: `${brandFile} ${label} ${order.reference}.xlsx`, base64: buffer.toString("base64") };
  },
});
