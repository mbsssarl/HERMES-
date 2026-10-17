import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { computeItemPricing } from "./lib/matching";
import { requireAdmin, requireUser } from "./lib/permissions";

const ORDER_COUNTER_KEY = "orderReferenceCounter";

async function nextOrderReference(ctx: MutationCtx, actorId: Id<"users">): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", ORDER_COUNTER_KEY))
    .unique();

  const current = counter?.value as { year: number; seq: number } | undefined;
  const seq = current && current.year === year ? current.seq + 1 : 1;

  if (counter) {
    await ctx.db.patch(counter._id, { value: { year, seq }, updatedAt: Date.now() });
  } else {
    // System-owned counter row; updatedBy is best-effort and not used for display.
    await ctx.db.insert("settings", {
      key: ORDER_COUNTER_KEY,
      value: { year, seq },
      updatedAt: Date.now(),
      updatedBy: actorId,
    });
  }

  return `Q-${year}-${String(seq).padStart(4, "0")}`;
}

export const list = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("processing"),
        v.literal("awaiting_supplier"),
        v.literal("po"),
        v.literal("completed"),
        v.literal("sent"),
        v.literal("archived"),
      ),
    ),
    clientId: v.optional(v.id("clients")),
    search: v.optional(v.string()),
    mineOnly: v.optional(v.boolean()),
    // true = only the deleted orders ("Supprimé" filter); otherwise deleted orders are hidden.
    deleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { status, clientId, search, mineOnly, deleted }) => {
    const user = await requireUser(ctx);
    const seenRows = await ctx.db.query("orderSeen").withIndex("by_user_order", (q) => q.eq("userId", user._id)).collect();
    const seenAt = new Map(seenRows.map((r) => [r.orderId as string, r.seenAt]));

    let orders = status
      ? await ctx.db.query("orders").withIndex("by_status", (q) => q.eq("status", status)).collect()
      : clientId
        ? await ctx.db.query("orders").withIndex("by_client", (q) => q.eq("clientId", clientId)).collect()
        : await ctx.db.query("orders").order("desc").collect();

    orders = orders.filter((o) => (deleted ? o.deletedAt !== undefined : o.deletedAt === undefined));
    if (mineOnly) orders = orders.filter((o) => o.createdBy === user._id);

    if (search && search.trim()) {
      const term = search.toLowerCase();
      orders = orders.filter(
        (o) =>
          o.reference.toLowerCase().includes(term) ||
          (o.clientOrderNumber ?? "").toLowerCase().includes(term),
      );
    }

    const withClients = await Promise.all(
      orders.map(async (o) => {
        // Aggregates for list/dashboard screens (row count, running total, lines still to resolve).
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", o._id))
          .collect();
        const included = items.filter((it) => !it.excluded);
        return {
          ...o,
          client: await ctx.db.get(o.clientId),
          country: await ctx.db.get(o.countryId),
          // Badge: the quotation was updated after a catalogue addition and this user has not opened it since.
          catalogUpdate:
            o.catalogUpdatedAt !== undefined && o.catalogUpdatedAt > (seenAt.get(o._id) ?? 0)
              ? { at: o.catalogUpdatedAt, lines: o.catalogUpdatedLines ?? 0, by: o.catalogUpdatedBy ?? null }
              : null,
          itemCount: included.length,
          // Net total: sum of the lines, minus the order's global discount.
          total: Math.round(included.reduce((sum, it) => sum + (it.total ?? 0), 0) * (1 - (o.globalDiscountPercent ?? 0) / 100) * 100) / 100,
          unresolvedCount: included.filter((it) => it.matchStatus === "unmatched" || it.matchStatus === "ambiguous").length,
        };
      }),
    );

    return withClients;
  },
});

export const get = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    await requireUser(ctx);
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    const client = await ctx.db.get(order.clientId);
    const country = await ctx.db.get(order.countryId);
    const owner = await ctx.db.get(order.createdBy);
    return { ...order, client, country, ownerEmail: owner?.email ?? null };
  },
});

export const create = mutation({
  args: {
    clientId: v.id("clients"),
    countryId: v.id("countries"),
    clientOrderNumber: v.optional(v.string()),
    vessel: v.optional(v.string()),
    eta: v.optional(v.string()),
    supplyPlace: v.optional(v.string()),
  },
  handler: async (ctx, { clientId, countryId, clientOrderNumber, vessel, eta, supplyPlace }) => {
    const user = await requireUser(ctx);
    const reference = await nextOrderReference(ctx, user._id);
    const now = Date.now();

    const orderId = await ctx.db.insert("orders", {
      reference,
      clientId,
      countryId,
      clientOrderNumber,
      vessel,
      eta,
      supplyPlace,
      status: "draft",
      createdAt: now,
      createdBy: user._id,
      updatedAt: now,
    });

    await logActivity(ctx, {
      userId: user._id,
      action: "order.created",
      entityType: "order",
      entityId: orderId,
      metadata: { reference, countryId },
    });

    return orderId;
  },
});

/**
 * Vessel/ETA/port/client order number are purely informational (not
 * pricing-sensitive, unlike the country) - editable at any time, including
 * to correct a value auto-filled from an imported document.
 */
const documentInfoKeys = [
  "issuer",
  "instructions",
  "enquiryDate",
  "enquiryTo",
  "replyBy",
  "imoNo",
  "country",
  "category",
  "department",
  "vendorRef",
  "paymentDays",
  "currency",
] as const;

export const updateLogistics = mutation({
  args: {
    orderId: v.id("orders"),
    vessel: v.optional(v.string()),
    eta: v.optional(v.string()),
    supplyPlace: v.optional(v.string()),
    clientOrderNumber: v.optional(v.string()),
    issuer: v.optional(v.string()),
    instructions: v.optional(v.string()),
    enquiryDate: v.optional(v.string()),
    enquiryTo: v.optional(v.string()),
    replyBy: v.optional(v.string()),
    imoNo: v.optional(v.string()),
    country: v.optional(v.string()),
    category: v.optional(v.string()),
    department: v.optional(v.string()),
    vendorRef: v.optional(v.string()),
    paymentDays: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Commande introuvable.");

    // A provided empty string clears the field (an omitted field is left untouched).
    const clean = (value: string) => value.trim() || undefined;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.vessel !== undefined) patch.vessel = clean(args.vessel);
    if (args.eta !== undefined) patch.eta = clean(args.eta);
    if (args.supplyPlace !== undefined) patch.supplyPlace = clean(args.supplyPlace);
    if (args.clientOrderNumber !== undefined) patch.clientOrderNumber = clean(args.clientOrderNumber);

    const info: Record<string, string | undefined> = { ...(order.documentInfo ?? {}) };
    let infoChanged = false;
    for (const key of documentInfoKeys) {
      const value = args[key];
      if (value !== undefined) {
        info[key] = clean(value);
        infoChanged = true;
      }
    }
    if (infoChanged) patch.documentInfo = info;

    await ctx.db.patch(args.orderId, patch);
  },
});

export const updateStatus = mutation({
  args: {
    orderId: v.id("orders"),
    status: v.union(
      v.literal("draft"),
      v.literal("processing"),
      v.literal("awaiting_supplier"),
      v.literal("po"),
      v.literal("completed"),
      v.literal("sent"),
      v.literal("archived"),
    ),
  },
  handler: async (ctx, { orderId, status }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(orderId, { status, updatedAt: Date.now() });
    await logActivity(ctx, {
      userId: user._id,
      action: "order.status_changed",
      entityType: "order",
      entityId: orderId,
      metadata: { status },
    });
  },
});

export const setQuotationOverride = mutation({
  args: { orderId: v.id("orders"), percent: v.optional(v.number()) },
  handler: async (ctx, { orderId, percent }) => {
    const admin = await requireAdmin(ctx);
    await ctx.db.patch(orderId, { quotationPercentOverride: percent, updatedAt: Date.now() });

    // The cotation applies to every priced line that uses a catalogue price.
    const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
    for (const item of items) {
      if (item.unitPriceOriginal === undefined) continue;
      await ctx.db.patch(item._id, await computeItemPricing(ctx, item));
    }
    await logActivity(ctx, {
      userId: admin._id,
      action: "order.quotation_percent_changed",
      entityType: "order",
      entityId: orderId,
      metadata: { percent },
    });
  },
});

export const setGlobalDiscount = mutation({
  args: { orderId: v.id("orders"), percent: v.optional(v.number()) },
  handler: async (ctx, { orderId, percent }) => {
    const admin = await requireAdmin(ctx);
    await ctx.db.patch(orderId, { globalDiscountPercent: percent, updatedAt: Date.now() });
    await logActivity(ctx, {
      userId: admin._id,
      action: "order.discount_changed",
      entityType: "order",
      entityId: orderId,
      metadata: { percent },
    });
  },
});

/**
 * Applies a global cotation (markup) and/or a global discount to EVERY line at once. Both are
 * written on each line (so they stay editable line by line and are what the quotation shows); an
 * omitted value leaves the lines' current one untouched.
 */
/**
 * Applies a global cotation (markup, written on every line) and/or the global discount, which applies to
 * the total of the whole order (never to individual lines). An omitted value is left untouched.
 */
export const applyGlobalPricing = mutation({
  args: {
    orderId: v.id("orders"),
    quotationPercent: v.optional(v.number()),
    discountPercent: v.optional(v.number()),
  },
  handler: async (ctx, { orderId, quotationPercent, discountPercent }) => {
    const admin = await requireAdmin(ctx);
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Commande introuvable.");
    if (quotationPercent !== undefined && (quotationPercent < 0 || quotationPercent > 1000)) {
      throw new Error("Cotation invalide.");
    }
    if (discountPercent !== undefined && (discountPercent < 0 || discountPercent > 100)) {
      throw new Error("Remise invalide (0 à 100 %).");
    }

    await ctx.db.patch(orderId, {
      quotationPercentOverride: quotationPercent ?? order.quotationPercentOverride,
      globalDiscountPercent: discountPercent ?? order.globalDiscountPercent,
      updatedAt: Date.now(),
    });

    if (quotationPercent !== undefined) {
      const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
      for (const item of items) {
        const next = { ...item, quotationPercentLine: quotationPercent, quotationAmountLine: undefined };
        await ctx.db.patch(item._id, {
          quotationPercentLine: quotationPercent,
          quotationAmountLine: undefined,
          ...(await computeItemPricing(ctx, next)),
          updatedAt: Date.now(),
        });
      }
    }

    await logActivity(ctx, {
      userId: admin._id,
      action: "order.global_pricing_applied",
      entityType: "order",
      entityId: orderId,
      metadata: { quotationPercent, discountPercent },
    });
  },
});

// ---------------------------------------------------------------------------------------------------------
// Conversion de devises d'une quotation, en deux étapes indépendantes du pays de cotation :
//   1) CHAQUE ligne est d'abord convertie en USD (devise de base), avec un taux choisi (taux du jour, ajusté en %
//      comme à l'import du catalogue, ou saisi à la main) : orders.baseRates (devise du prix -> USD).
//   2) Au traitement de la quotation, le total peut être converti vers une autre devise, toujours de la même
//      façon : orders.usdRate (USD -> orders.exportCurrency).
// orders.exportRates en est le résultat composé, une entrée par devise d'origine des lignes : c'est elle que
// lisent l'écran, l'export Excel et le PDF (taux effectif devise du prix -> devise affichée).
// ---------------------------------------------------------------------------------------------------------
const BASE_CURRENCY = "USD";
const MANUAL_SOURCE = "Taux saisi manuellement";
const rateEntryValidator = v.object({ currency: v.string(), rate: v.number(), ratePercent: v.optional(v.number()), asOf: v.string(), source: v.string() });
const usdRateValidator = v.object({ rate: v.number(), ratePercent: v.optional(v.number()), asOf: v.string(), source: v.string() });
type RateEntry = { currency: string; rate: number; ratePercent?: number; asOf: string; source: string };
type UsdRate = { rate: number; ratePercent?: number; asOf: string; source: string };
const todayIso = () => new Date().toISOString().slice(0, 10);

function assertPercent(ratePercent: number) {
  if (!Number.isFinite(ratePercent) || ratePercent <= 0 || ratePercent > 1000) {
    throw new Error("Le pourcentage du taux doit être supérieur à 0 et inférieur ou égal à 1000 %.");
  }
}

/** Taux `from` -> `to` : saisi à la main, sinon taux du jour ajusté par `ratePercent` (100 = taux du jour). */
async function resolveRate(ctx: ActionCtx, from: string, to: string, ratePercent: number, manual?: number): Promise<UsdRate> {
  if (manual !== undefined) {
    if (!Number.isFinite(manual) || manual <= 0) throw new Error(`Taux invalide pour ${from} : il doit être strictement positif.`);
    return { rate: manual, asOf: todayIso(), source: MANUAL_SOURCE };
  }
  const live = await ctx.runAction(api.exchangeRates.getRate, { from, to });
  // Même devise ou pas d'ajustement : jamais de facteur artificiel (comme à l'import du catalogue).
  if (from === to || ratePercent === 100) return { rate: live.rate, asOf: live.asOf, source: live.source };
  return { rate: live.rate * (ratePercent / 100), ratePercent, asOf: live.asOf, source: `${live.source} - ajusté à ${ratePercent} %` };
}

/**
 * Internal : devises réellement présentes sur les lignes chiffrées (orderItems.priceCurrency ; une ligne sans
 * devise propre, ex. prix saisi à la main, est en USD) + état actuel de la conversion.
 */
export const getExportCurrencyBasis = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
    const currencies = new Set<string>();
    for (const item of items) {
      if (item.priceAfterQuotation === undefined) continue; // pas de prix -> rien à convertir
      currencies.add(item.priceCurrency ?? BASE_CURRENCY);
    }
    // Quotation figée (envoyée, PO, archivée, validée, supprimée) : on ne lui recalcule jamais ses montants en tâche de fond.
    const frozen = order.deletedAt !== undefined || order.validatedAt !== undefined || ["po", "sent", "archived"].includes(order.status);
    return {
      frozen,
      currencies: [...currencies],
      baseRates: order.baseRates as RateEntry[] | undefined,
      usdRate: order.usdRate as UsdRate | undefined,
      exportCurrency: order.exportCurrency,
      exportRates: order.exportRates as RateEntry[] | undefined,
    };
  },
});

/** Internal: enregistre l'état de conversion et recalcule exportRates (taux composé par devise d'origine). */
export const persistPipeline = internalMutation({
  args: {
    orderId: v.id("orders"),
    userId: v.id("users"),
    baseRates: v.optional(v.array(rateEntryValidator)),
    usdRate: v.optional(usdRateValidator),
    exportCurrency: v.string(),
  },
  handler: async (ctx, { orderId, userId, baseRates, usdRate, exportCurrency }) => {
    const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
    const currencies = new Set<string>();
    for (const item of items) {
      if (item.priceAfterQuotation !== undefined) currencies.add(item.priceCurrency ?? BASE_CURRENCY);
    }
    const toOther = exportCurrency !== BASE_CURRENCY;
    const factor = toOther ? (usdRate?.rate ?? 1) : 1;
    const exportRates = [...currencies].map((currency) => {
      const base = currency === BASE_CURRENCY ? undefined : baseRates?.find((r) => r.currency === currency);
      const stage2 = toOther ? usdRate : undefined;
      return {
        currency,
        rate: (base?.rate ?? 1) * factor,
        asOf: base?.asOf ?? stage2?.asOf ?? todayIso(),
        source: base && stage2 ? `${base.source} puis ${stage2.source}` : (base ?? stage2)?.source ?? "USD",
      };
    });
    await ctx.db.patch(orderId, {
      baseRates,
      usdRate: toOther ? usdRate : undefined,
      exportCurrency,
      exportRates,
      updatedAt: Date.now(),
    });
    await logActivity(ctx, {
      userId,
      action: "order.export_currency_changed",
      entityType: "order",
      entityId: orderId,
      metadata: { exportCurrency, baseRates, usdRate },
    });
  },
});

/**
 * Garantit que toutes les devises des lignes ont un taux vers l'USD (taux du jour, 100 %) et que exportRates est à
 * jour. Ne touche pas aux taux déjà choisis. Une quotation « ancienne » (conversion directe, sans étape USD) n'est
 * migrée que sur demande explicite (migrate), jamais en tâche de fond.
 */
async function ensureBase(ctx: ActionCtx, orderId: Id<"orders">, userId: Id<"users">, migrate: boolean) {
  const basis = await ctx.runQuery(internal.orders.getExportCurrencyBasis, { orderId });
  if (!basis) throw new Error("Commande introuvable.");
  const legacy = basis.baseRates === undefined && basis.exportCurrency !== undefined;
  if ((legacy || basis.frozen) && !migrate) return basis;

  const needed = basis.currencies.filter((c) => c !== BASE_CURRENCY);
  const existing = (basis.baseRates ?? []).filter((r) => needed.includes(r.currency));
  const missing = needed.filter((c) => !existing.some((r) => r.currency === c));
  const exportUpToDate = basis.currencies.every((c) => basis.exportRates?.some((r) => r.currency === c));
  if (!legacy && missing.length === 0 && basis.exportCurrency !== undefined && exportUpToDate) return basis;

  const settled = await Promise.allSettled(missing.map((c) => resolveRate(ctx, c, BASE_CURRENCY, 100)));
  const fresh: RateEntry[] = [];
  const failed: string[] = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") fresh.push({ currency: missing[i], ...res.value });
    else failed.push(`${missing[i]} (${res.reason instanceof Error ? res.reason.message : String(res.reason)})`);
  });
  await ctx.runMutation(internal.orders.persistPipeline, {
    orderId,
    userId,
    baseRates: [...existing, ...fresh],
    usdRate: legacy ? undefined : basis.usdRate,
    exportCurrency: legacy ? BASE_CURRENCY : (basis.exportCurrency ?? BASE_CURRENCY),
  });
  if (failed.length > 0) {
    throw new Error(`Taux en ligne indisponible pour ${failed.join(" ; ")}. Saisissez le taux dans « Conversion en USD ».`);
  }
  return await ctx.runQuery(internal.orders.getExportCurrencyBasis, { orderId });
}

/** Appelée à l'ouverture/export d'une quotation : complète les taux manquants vers l'USD (étape 1) au taux du jour. */
export const ensureBaseRates = action({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }): Promise<null> => {
    const user = await ctx.runQuery(api.users.getBusinessUser, {});
    if (!user) throw new Error("Authentification requise.");
    await ensureBase(ctx, orderId, user._id, false);
    return null;
  },
});

/**
 * Étape 1 : choisit les taux de conversion de chaque devise des lignes vers l'USD. `ratePercent` ajuste le taux du
 * jour (100 = taux du jour, comme à l'import du catalogue) ; `manualRates` impose un taux précis par devise
 * (1 unité de `currency` = `rate` USD, ex. 1 EUR = 1,1 USD).
 */
export const applyBaseRates = action({
  args: {
    orderId: v.id("orders"),
    ratePercent: v.optional(v.number()),
    manualRates: v.optional(v.array(v.object({ currency: v.string(), rate: v.number() }))),
  },
  handler: async (ctx, { orderId, ratePercent = 100, manualRates }): Promise<RateEntry[]> => {
    const user = await ctx.runQuery(api.users.getBusinessUser, {});
    if (!user) throw new Error("Authentification requise.");
    assertPercent(ratePercent);
    const basis = await ctx.runQuery(internal.orders.getExportCurrencyBasis, { orderId });
    if (!basis) throw new Error("Commande introuvable.");
    const legacy = basis.baseRates === undefined && basis.exportCurrency !== undefined;

    const needed = basis.currencies.filter((c) => c !== BASE_CURRENCY);
    const baseRates: RateEntry[] = await Promise.all(
      needed.map(async (currency) => ({
        currency,
        ...(await resolveRate(ctx, currency, BASE_CURRENCY, ratePercent, manualRates?.find((m) => m.currency === currency)?.rate)),
      })),
    );
    await ctx.runMutation(internal.orders.persistPipeline, {
      orderId,
      userId: user._id,
      baseRates,
      usdRate: legacy ? undefined : basis.usdRate,
      exportCurrency: legacy ? BASE_CURRENCY : (basis.exportCurrency ?? BASE_CURRENCY),
    });
    return baseRates;
  },
});

/**
 * Étape 2 : convertit le total de la quotation (en USD après l'étape 1) vers une autre devise, avec un taux choisi
 * de la même façon (taux du jour ajusté en %, ou saisi à la main : `manualRates` = [{ currency: "USD", rate }]).
 * Sans devise cible (ou « USD »), la quotation reste en USD.
 */
export const applyExportCurrency = action({
  args: {
    orderId: v.id("orders"),
    targetCurrency: v.optional(v.string()),
    // false = changement d'étiquette seulement : les montants restent tels quels (taux 1).
    applyRate: v.optional(v.boolean()),
    ratePercent: v.optional(v.number()),
    manualRates: v.optional(v.array(v.object({ currency: v.string(), rate: v.number() }))),
  },
  handler: async (ctx, { orderId, targetCurrency, applyRate, ratePercent = 100, manualRates }): Promise<{ currency: string; rate: number; ratePercent?: number; asOf: string; source: string }[] | null> => {
    const user = await ctx.runQuery(api.users.getBusinessUser, {});
    if (!user) throw new Error("Authentification requise.");

    // L'étape 1 (vers l'USD) doit exister avant de convertir plus loin (y compris pour une quotation ancienne).
    const basis = await ensureBase(ctx, orderId, user._id, true);
    if (!basis) throw new Error("Commande introuvable.");

    if (!targetCurrency || targetCurrency === BASE_CURRENCY) {
      await ctx.runMutation(internal.orders.persistPipeline, {
        orderId, userId: user._id, baseRates: basis.baseRates, usdRate: undefined, exportCurrency: BASE_CURRENCY,
      });
      return null;
    }

    assertPercent(ratePercent);
    const known = await ctx.runQuery(api.currencies.list, {});
    if (!known.some((c) => c.code === targetCurrency)) throw new Error("Devise inconnue.");

    const usdRate: UsdRate =
      applyRate === false
        ? { rate: 1, asOf: todayIso(), source: "sans conversion" }
        : await resolveRate(ctx, BASE_CURRENCY, targetCurrency, ratePercent, manualRates?.find((m) => m.currency === BASE_CURRENCY)?.rate);

    await ctx.runMutation(internal.orders.persistPipeline, {
      orderId, userId: user._id, baseRates: basis.baseRates, usdRate, exportCurrency: targetCurrency,
    });
    return [{ currency: BASE_CURRENCY, ...usdRate }];
  },
});

/** Définit (ou retire, avec 0 / vide) les frais de livraison + mise à l'eau ajoutés après le discount dans le fichier exporté. */
export const setTransportFee = mutation({
  args: { orderId: v.id("orders"), transportFee: v.optional(v.number()) },
  handler: async (ctx, { orderId, transportFee }) => {
    const admin = await requireAdmin(ctx);
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Commande introuvable.");
    if (transportFee !== undefined && (!Number.isFinite(transportFee) || transportFee < 0)) throw new Error("Frais de transport invalides.");
    const fee = transportFee && transportFee > 0 ? Math.round(transportFee * 100) / 100 : undefined;
    await ctx.db.patch(orderId, { transportFee: fee, updatedAt: Date.now() });
    await logActivity(ctx, {
      userId: admin._id,
      action: "order.transport_fee_set",
      entityType: "order",
      entityId: orderId,
      metadata: { transportFee: fee },
    });
  },
});

/** The signed-in user opened this quotation: its "updated" badge disappears for them. */
export const markSeen = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const user = await requireUser(ctx);
    // collect (et non unique) : deux ouvertures simultanées peuvent avoir créé deux lignes, on garde la première.
    const rows = await ctx.db
      .query("orderSeen")
      .withIndex("by_user_order", (q) => q.eq("userId", user._id).eq("orderId", orderId))
      .collect();
    const seenAt = Date.now();
    if (rows.length === 0) await ctx.db.insert("orderSeen", { orderId, userId: user._id, seenAt });
    else {
      await ctx.db.patch(rows[0]._id, { seenAt });
      for (const extra of rows.slice(1)) await ctx.db.delete(extra._id);
    }
  },
});

export const remove = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const admin = await requireAdmin(ctx);
    await ctx.db.patch(orderId, { deletedAt: Date.now(), updatedAt: Date.now() });
    await logActivity(ctx, { userId: admin._id, action: "order.deleted", entityType: "order", entityId: orderId });
  },
});

/**
 * Vide la corbeille : supprime DÉFINITIVEMENT les quotations déjà supprimées, avec tout ce qui s'y rattache
 * (lignes, validation, modifications, fichiers, devis, historique d'envoi). Réservé aux administrateurs.
 * Traite quelques quotations par appel pour rester sous les limites d'une transaction : le client rappelle
 * tant que `remaining` n'est pas 0.
 */
export const purgeDeleted = mutation({
  args: {},
  handler: async (ctx): Promise<{ purged: number; remaining: number }> => {
    const admin = await requireAdmin(ctx);
    const trashed = (await ctx.db.query("orders").collect()).filter((o) => o.deletedAt !== undefined);
    const batch = trashed.slice(0, 4);

    for (const order of batch) {
      const orderId = order._id;
      const removeAll = async (rows: { _id: Id<any> }[]) => { for (const row of rows) await ctx.db.delete(row._id); };

      await removeAll(await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect());
      await removeAll(await ctx.db.query("orderValidatedItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect());
      await removeAll(await ctx.db.query("orderItemEdits").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect());
      await removeAll(await ctx.db.query("supplierItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect());
      await removeAll(await ctx.db.query("emailLogs").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect());

      for (const file of await ctx.db.query("uploadedFiles").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()) {
        await ctx.storage.delete(file.storageId).catch(() => {});
        await ctx.db.delete(file._id);
      }
      for (const quote of await ctx.db.query("quotations").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()) {
        if (quote.pdfStorageId) await ctx.storage.delete(quote.pdfStorageId).catch(() => {});
        await ctx.db.delete(quote._id);
      }
      await removeAll((await ctx.db.query("orderSeen").collect()).filter((r) => r.orderId === orderId));

      await ctx.db.delete(orderId);
      await logActivity(ctx, {
        userId: admin._id,
        action: "order.purged",
        entityType: "order",
        entityId: orderId,
        metadata: { reference: order.reference },
      });
    }
    return { purged: batch.length, remaining: trashed.length - batch.length };
  },
});

export const restore = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const admin = await requireAdmin(ctx);
    await ctx.db.patch(orderId, { deletedAt: undefined, updatedAt: Date.now() });
    await logActivity(ctx, { userId: admin._id, action: "order.restored", entityType: "order", entityId: orderId });
  },
});

export const archive = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(orderId, { status: "archived", updatedAt: Date.now() });
    await logActivity(ctx, {
      userId: user._id,
      action: "order.archived",
      entityType: "order",
      entityId: orderId,
    });
  },
});
