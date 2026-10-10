"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { buildQuotationWorkbook } from "./lib/export/buildQuotationWorkbook";
import { fillClientWorkbook } from "./lib/export/fillClientWorkbook";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
    // ETA du navire pour CE fichier (saisie à l'envoi à un fournisseur) ; sinon celle de la commande, s'il y en a une.
    eta: v.optional(v.string()),
    // true = envoi au CLIENT : on renvoie son fichier Excel d'origine complété des prix, au lieu du gabarit MBSS
    // (réservé aux fournisseurs et aux téléchargements simples).
    clientFormat: v.optional(v.boolean()),
  },
  handler: async (ctx, { orderId, scope, eta, clientFormat }): Promise<{ fileName: string; base64: string; notice?: string; format: "client" | "standard" }> => {
    const user = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!user) throw new Error("Authentification requise.");

    const data = await ctx.runQuery(internal.exportData.getForExport, { orderId });
    const brand = await ctx.runQuery(api.branding.get, {});
    const brandFile = brand.name.replace(/[\\/:*?"<>|]/g, " ").trim() || "export";
    if (!data) throw new Error("Commande introuvable.");
    const { order, client, country, currency } = data;
    // Taux figés au moment où l'admin a choisi la devise d'export (convex/orders.ts:applyExportCurrency) -
    // pas de conversion si aucune devise cible n'a été appliquée. Une ligne sans priceCurrency propre (prix
    // manuel ancien) retombe sur la devise du pays de cotation.
    const rateFor = (itemCurrency: string | undefined): number => {
      if (!order.exportRates) return 1;
      const match = order.exportRates.find((r) => r.currency === (itemCurrency ?? country?.currency));
      return match?.rate ?? 1;
    };

    const isKnown = (status: string) => status === "matched_impa" || status === "matched_name" || status === "manual";
    const items = data.items.filter((item) => {
      if (scope === "all") return true;
      if (item.excluded) return false;
      if (scope === "known") return isKnown(item.matchStatus);
      // « Sans prix » : aucun prix retenu pour la ligne (même logique que le compteur affiché dans l'application).
      if (scope === "unknown") return item.priceAfterQuotation === undefined;
      return true;
    });
    if (items.length === 0) throw new Error("Aucune ligne à exporter pour ce choix.");
    const suffix = { selected: "", known: " - repertories", unknown: " - non repertories", all: " - tout" }[scope];

    // Envoi au client : le fichier d'origine sert de gabarit. Si c'est impossible (PDF/Word, fichier absent...),
    // on retombe sur le gabarit MBSS en le signalant plutôt que d'échouer.
    let notice: string | undefined;
    if (clientFormat) {
      const original = data.clientFile;
      if (!original) {
        notice = "Aucun fichier d'origine pour cette quotation : le format standard a été utilisé.";
      } else if (original.mimeType !== XLSX_MIME) {
        notice = "Le fichier d'origine n'est pas un classeur Excel (.xlsx) et ne peut pas être complété : le format standard a été utilisé.";
      } else {
        try {
          const blob = await ctx.storage.get(original.storageId);
          if (!blob) throw new Error("Fichier d'origine introuvable dans le stockage.");
          const { buffer, filled, unplaced } = await fillClientWorkbook(
            await blob.arrayBuffer(),
            items.map((item) => ({
              sourceRow: item.sourceRow,
              lineNo: item.lineNo,
              rawDescription: item.rawDescription,
              quantity: item.quotedQuantity ?? item.rawQuantity ?? 1,
              unitPrice: item.priceAfterQuotation !== undefined ? item.priceAfterQuotation * rateFor(item.priceCurrency) : undefined,
            })),
            {
              currencyLabel: order.exportCurrency,
              // Remise et frais de transport : lignes de récapitulatif sous le tableau du client (prix unitaires bruts).
              footer: { discountPercent: order.globalDiscountPercent ?? 0, transportFee: order.transportFee, currency: currency },
            },
          );
          const base = original.fileName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, " ").trim() || order.reference;
          return {
            fileName: `${base} - cotation ${brandFile}.xlsx`,
            base64: buffer.toString("base64"),
            format: "client" as const,
            notice:
              [
                unplaced > 0
                  ? `${unplaced} ligne(s) n'ont pas pu être retrouvées dans le fichier d'origine et sont restées sans prix (${filled} ligne(s) chiffrée(s)).`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
          };
        } catch (err) {
          notice = `Impossible de compléter le fichier d'origine (${err instanceof Error ? err.message : String(err)}) : le format standard a été utilisé.`;
        }
      }
    }

    const buffer = await buildQuotationWorkbook({
      reference: order.reference,
      currency,
      vessel: order.vessel,
      eta: eta ?? order.eta,
      port: order.supplyPlace,
      city: country?.city,
      category: order.documentInfo?.category,
      paymentDays: order.documentInfo?.paymentDays,
      discountPercent: order.globalDiscountPercent ?? 0,
      transportFee: order.transportFee,
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
      fileName: `${brandFile} RFQ ${order.reference}${safeClient ? ` ${safeClient}` : ""}${suffix}.xlsx`,
      base64: buffer.toString("base64"),
      notice,
      format: "standard" as const,
    };
  },
});
