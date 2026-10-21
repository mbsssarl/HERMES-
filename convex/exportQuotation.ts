"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { buildQuotationWorkbook, type ExportCompany } from "./lib/export/buildQuotationWorkbook";
import { fillClientWorkbook } from "./lib/export/fillClientWorkbook";
import { fetchCompanyLogo } from "./lib/export/logoImage";
import * as XLSX from "xlsx";
import { XLSX_MIME } from "./lib/extraction/fileKinds";

const SPREADSHEET_MIMES = new Set([XLSX_MIME, "application/vnd.ms-excel"]);

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
    // Informations de l'en-tête du gabarit, demandées à l'export : « REQUEST FOR … », pays, port de livraison, navire, réf.
    // Absentes = valeurs de la commande.
    header: v.optional(
      v.object({
        requestFor: v.optional(v.string()),
        country: v.optional(v.string()),
        port: v.optional(v.string()),
        vessel: v.optional(v.string()),
        refNo: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { orderId, scope, eta, clientFormat, header }): Promise<{ fileName: string; base64: string; notice?: string; format: "client" | "standard" }> => {
    const user = await ctx.runQuery(api.users.getBusinessUser, {});
    if (!user) throw new Error("Authentification requise.");

    // Étape 1 de la conversion (devises des lignes -> devise de l'entreprise) : complète les taux manquants avant de lire les montants.
    await ctx.runAction(api.orders.ensureBaseRates, { orderId });
    const data = await ctx.runQuery(internal.exportData.getForExport, { orderId, companyId: user.companyId! });
    const brand = await ctx.runQuery(api.branding.get, {});
    const brandFile = brand.name.replace(/[\\/:*?"<>|]/g, " ").trim() || "export";
    if (!data) throw new Error("Commande introuvable.");
    const { order, client, country, currency, baseCurrency } = data;
    // Taux figés au moment où l'admin a choisi la devise d'export (convex/orders.ts:applyExportCurrency) -
    // pas de conversion si aucune devise cible n'a été appliquée. Une ligne sans priceCurrency propre (prix
    // manuel ancien) retombe sur la devise du pays de cotation.
    const rateFor = (itemCurrency: string | undefined): number => {
      if (!order.exportRates) return 1;
      const match = order.exportRates.find((r) => r.currency === (itemCurrency ?? baseCurrency));
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
      } else if (!SPREADSHEET_MIMES.has(original.mimeType)) {
        notice = "Le fichier d'origine n'est pas un classeur Excel (.xlsx) et ne peut pas être complété : le format standard a été utilisé.";
      } else {
        try {
          const blob = await ctx.storage.get(original.storageId);
          if (!blob) throw new Error("Fichier d'origine introuvable dans le stockage.");
          let source = await blob.arrayBuffer();
          if (original.mimeType !== XLSX_MIME) {
            // Ancien Excel (.xls) : converti en .xlsx pour pouvoir y écrire les prix.
            const converted = XLSX.write(XLSX.read(Buffer.from(source), { type: "buffer", cellDates: true }), { type: "buffer", bookType: "xlsx" }) as Buffer;
            source = converted.buffer.slice(converted.byteOffset, converted.byteOffset + converted.byteLength) as ArrayBuffer;
          }
          const { buffer, filled, unplaced } = await fillClientWorkbook(
            source,
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
          // Un client ne doit jamais recevoir le gabarit fournisseur par erreur : on signale l'échec.
          throw new Error(`Impossible de compléter le fichier d'origine du client (${err instanceof Error ? err.message : String(err)}).`);
        }
      }
    }

    // Coordonnées de l'entreprise (réglage « companyInfo », modifiable par son admin) : bloc à droite du logo.
    const company = ((await ctx.runQuery(api.settings.get, { key: "companyInfo" })) ?? {}) as ExportCompany;

    // Logo de l'entreprise (Admin > Personnalisation), sinon logo neutre : jamais celui d'une autre entreprise.
    const logo = (await fetchCompanyLogo(brand.logoUrl)) ?? undefined;

    const buffer = await buildQuotationWorkbook({
      logo,
      reference: order.reference,
      currency,
      requestFor: header?.requestFor?.trim() || "Quotation",
      country: header?.country !== undefined ? header.country : country?.name,
      deliveryPort: header?.port !== undefined ? header.port : order.supplyPlace || country?.city,
      vessel: header?.vessel !== undefined ? header.vessel : order.vessel,
      eta: eta ?? order.eta,
      refNo: header?.refNo !== undefined ? header.refNo : order.documentInfo?.vendorRef ?? order.reference,
      company,
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

    // Le nom du client n'apparaît que pour un envoi au client : un fichier à destination d'un fournisseur ne
    // doit pas révéler l'identité du client final.
    const safeClient = clientFormat ? (client?.name ?? "").replace(/[\\/:*?"<>|]/g, " ").trim() : "";
    return {
      fileName: `${brandFile} RFQ ${order.reference}${safeClient ? ` ${safeClient}` : ""}${suffix}.xlsx`,
      base64: buffer.toString("base64"),
      notice,
      format: "standard" as const,
    };
  },
});
