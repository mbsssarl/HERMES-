import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { baseCurrencyOf } from "./lib/baseCurrency";
import { companyIdOf, requireAdmin } from "./lib/permissions";

// ---------------------------------------------------------------------------------------------------------
// Devise utilisée par l'entreprise. Seul l'admin la change, et il choisit :
//   - « relabel » : seul le libellé change, les montants restent identiques ;
//   - « convert » : tous les montants enregistrés dans l'ancienne devise sont multipliés par le taux saisi.
// Le travail porte sur beaucoup de lignes : il est fait par lots en arrière-plan (companies.currencyChange sert
// d'indicateur de progression). Chaque lot ne traite que des lignes encore dans l'ancienne devise, donc un lot
// n'est jamais appliqué deux fois.
// ---------------------------------------------------------------------------------------------------------

const BATCH = 250;
const ORDER_BATCH = 40;
const phaseValidator = v.union(v.literal("prices"), v.literal("items"), v.literal("orders"));
const modeValidator = v.union(v.literal("relabel"), v.literal("convert"));

const scale = (n: number, rate: number) => Math.round(n * rate * 1e6) / 1e6;

/** Devise actuelle de l'entreprise et changement en cours éventuel. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const company = await ctx.db.get(companyIdOf(admin));
    return { currency: await baseCurrencyOf(ctx, admin.companyId), change: company?.currencyChange ?? null };
  },
});

export const change = mutation({
  args: { to: v.string(), mode: modeValidator, rate: v.optional(v.number()) },
  handler: async (ctx, { to, mode, rate }) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    if (company.currencyChange) throw new Error("Un changement de devise est déjà en cours.");
    const from = company.baseCurrency ?? "USD";
    const code = to.trim().toUpperCase();
    if (code === from) throw new Error("C'est déjà la devise utilisée.");
    const known = await ctx.db
      .query("currencies")
      .withIndex("by_company_and_code", (q) => q.eq("companyId", companyId).eq("code", code))
      .unique();
    if (!known || !known.active) throw new Error("Cette devise n'est pas dans la liste des devises de l'entreprise.");
    if (mode === "convert" && (rate === undefined || !Number.isFinite(rate) || rate <= 0)) {
      throw new Error("Le taux de conversion doit être strictement positif.");
    }
    const usedRate = mode === "convert" ? rate : undefined;
    await ctx.db.patch(companyId, {
      baseCurrency: code,
      currencyChange: { from, to: code, mode, rate: usedRate, startedAt: Date.now() },
    });
    await logActivity(ctx, {
      userId: admin._id,
      action: "company.currency_changed",
      entityType: "company",
      entityId: companyId,
      metadata: { from, to: code, mode, rate: usedRate },
    });
    await ctx.scheduler.runAfter(0, internal.companyCurrency.step, {
      companyId, phase: "prices", cursor: null, from, to: code, mode, rate: usedRate,
    });
    return null;
  },
});

/** Un lot de la reprise des données ; se replanifie jusqu'à la fin, puis lève l'indicateur de changement en cours. */
export const step = internalMutation({
  args: {
    companyId: v.id("companies"),
    phase: phaseValidator,
    cursor: v.union(v.string(), v.null()),
    from: v.string(),
    to: v.string(),
    mode: modeValidator,
    rate: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, phase, cursor, from, to, mode, rate }): Promise<null> => {
    const convert = mode === "convert";
    const r = convert ? (rate ?? 1) : 1;
    let nextPhase: "prices" | "items" | "orders" | null = phase;
    let nextCursor: string | null = null;

    if (phase === "prices") {
      const page = await ctx.db
        .query("productPrices")
        .withIndex("by_company_and_validTo", (q) => q.eq("companyId", companyId))
        .paginate({ numItems: BATCH, cursor });
      for (const row of page.page) {
        if (row.currency !== from) continue;
        await ctx.db.patch(row._id, convert ? { price: scale(row.price, r), currency: to } : { currency: to });
      }
      if (page.isDone) { nextPhase = "items"; nextCursor = null; } else nextCursor = page.continueCursor;
    } else if (phase === "items") {
      const page = await ctx.db
        .query("orderItems")
        .withIndex("by_company", (q) => q.eq("companyId", companyId))
        .paginate({ numItems: BATCH, cursor });
      for (const item of page.page) {
        const hasMoney = [item.unitPriceOriginal, item.priceAfterQuotation, item.finalUnitPrice, item.unitPriceManual, item.quotationAmountLine, item.total]
          .some((n) => n !== undefined);
        // Une ligne sans devise propre était dans l'ancienne devise de l'entreprise.
        const inOld = item.priceCurrency === from || (item.priceCurrency === undefined && convert && hasMoney);
        if (!inOld) continue;
        const patch: Record<string, number | string> = { priceCurrency: to };
        if (convert) {
          const fields = ["unitPriceOriginal", "priceAfterQuotation", "finalUnitPrice", "unitPriceManual", "quotationAmountLine", "total"] as const;
          for (const f of fields) {
            const value = item[f];
            if (value !== undefined) patch[f] = scale(value, r);
          }
        }
        await ctx.db.patch(item._id, patch);
      }
      if (page.isDone) { nextPhase = "orders"; nextCursor = null; } else nextCursor = page.continueCursor;
    } else {
      const page = await ctx.db
        .query("orders")
        .withIndex("by_company", (q) => q.eq("companyId", companyId))
        .paginate({ numItems: ORDER_BATCH, cursor });
      for (const order of page.page) {
        const patch: Record<string, unknown> = {};
        // Taux « devise du prix -> ancienne devise » : devient « -> nouvelle devise ». La nouvelle devise n'a plus besoin de taux.
        if (order.baseRates) {
          patch.baseRates = order.baseRates
            .filter((e) => e.currency !== to)
            .map((e) => (convert ? { ...e, rate: scale(e.rate, r) } : e));
        }
        const ec = order.exportCurrency;
        if (ec !== undefined) {
          if (ec === from || ec === to) {
            // Fichier exporté dans la devise de l'entreprise : plus de seconde conversion.
            patch.exportCurrency = to;
            patch.usdRate = undefined;
          } else if (convert && order.usdRate) {
            // Ancienne devise -> devise du fichier ; devient nouvelle devise -> devise du fichier.
            patch.usdRate = { ...order.usdRate, rate: scale(order.usdRate.rate, 1 / r) };
          }
          // Taux composé par devise d'origine, comme dans orders.persistPipeline.
          const baseRates = (patch.baseRates ?? order.baseRates) as typeof order.baseRates;
          const usdRate = ("usdRate" in patch ? patch.usdRate : order.usdRate) as typeof order.usdRate;
          const exportCurrency = (patch.exportCurrency ?? ec) as string;
          const toOther = exportCurrency !== to;
          const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect();
          const currencies = new Set<string>();
          for (const item of items) if (item.priceAfterQuotation !== undefined) currencies.add(item.priceCurrency ?? to);
          patch.exportRates = [...currencies].map((currency) => {
            const base = currency === to ? undefined : baseRates?.find((e) => e.currency === currency);
            const stage2 = toOther ? usdRate : undefined;
            return {
              currency,
              rate: (base?.rate ?? 1) * (toOther ? (usdRate?.rate ?? 1) : 1),
              asOf: base?.asOf ?? stage2?.asOf ?? new Date().toISOString().slice(0, 10),
              source: base && stage2 ? `${base.source} puis ${stage2.source}` : (base ?? stage2)?.source ?? to,
            };
          });
        }
        // Frais de transport : exprimés dans la devise du fichier ; seuls ceux en devise de l'entreprise sont convertis.
        if (convert && order.transportFee !== undefined && (ec === undefined || ec === from)) {
          patch.transportFee = scale(order.transportFee, r);
        }
        if (Object.keys(patch).length > 0) await ctx.db.patch(order._id, patch);
      }
      if (page.isDone) nextPhase = null; else nextCursor = page.continueCursor;
    }

    if (nextPhase === null) {
      await ctx.db.patch(companyId, { currencyChange: undefined });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.companyCurrency.step, {
      companyId, phase: nextPhase, cursor: nextCursor, from, to, mode, rate,
    });
    return null;
  },
});
