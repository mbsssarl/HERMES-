import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { computeItemPricing } from "./lib/matching";
import { requireAdmin, requireUser } from "./lib/permissions";
import { DEFAULT_CURRENCY } from "./lib/productPricing";

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
    return { ...order, client, country };
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
        const next = { ...item, quotationPercentLine: quotationPercent };
        await ctx.db.patch(item._id, {
          quotationPercentLine: quotationPercent,
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

/**
 * Internal : ensemble des devises réellement enregistrées sur les lignes chiffrées de cette commande
 * (orderItems.priceCurrency, propre à chaque prix - voir productPrices.currency). C'est CET ensemble qui
 * détermine quels taux de change il faut récupérer, pas une devise unique par pays.
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
      currencies.add(item.priceCurrency ?? DEFAULT_CURRENCY);
    }
    return { fallback: DEFAULT_CURRENCY, currencies: [...currencies] };
  },
});

/** Internal: writes the export currency / frozen rates decided by applyExportCurrency. */
export const persistExportRates = internalMutation({
  args: {
    orderId: v.id("orders"),
    userId: v.id("users"),
    exportCurrency: v.optional(v.string()),
    exportRates: v.optional(v.array(v.object({ currency: v.string(), rate: v.number(), asOf: v.string(), source: v.string() }))),
  },
  handler: async (ctx, { orderId, userId, exportCurrency, exportRates }) => {
    await ctx.db.patch(orderId, { exportCurrency, exportRates, updatedAt: Date.now() });
    await logActivity(ctx, {
      userId,
      action: "order.export_currency_changed",
      entityType: "order",
      entityId: orderId,
      metadata: { exportCurrency, exportRates },
    });
  },
});

/**
 * Choisit la devise cible du fichier exporté et convertit réellement les montants. Chaque ligne de la
 * commande peut avoir été tarifée dans une devise différente (import catalogue avec une devise choisie
 * indépendamment du pays - voir products.importCatalog) : on récupère donc un taux par devise d'origine
 * réellement présente parmi les lignes chiffrées, pas un seul taux global. Sans devise cible, annule la
 * conversion : chaque ligne du fichier ressort dans SA propre devise d'origine, sans facteur.
 */
export const applyExportCurrency = action({
  args: { orderId: v.id("orders"), targetCurrency: v.optional(v.string()) },
  handler: async (ctx, { orderId, targetCurrency }): Promise<{ currency: string; rate: number; asOf: string; source: string }[] | null> => {
    const user = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!user) throw new Error("Authentification requise.");
    const basis = await ctx.runQuery(internal.orders.getExportCurrencyBasis, { orderId });
    if (!basis) throw new Error("Commande introuvable.");

    if (!targetCurrency) {
      await ctx.runMutation(internal.orders.persistExportRates, {
        orderId,
        userId: user._id,
        exportCurrency: undefined,
        exportRates: undefined,
      });
      return null;
    }

    const known = await ctx.runQuery(api.currencies.list, {});
    if (!known.some((c) => c.code === targetCurrency)) throw new Error("Devise inconnue.");

    const sourceCurrencies = basis.currencies.length > 0 ? basis.currencies : [basis.fallback];
    const rates = await Promise.all(
      sourceCurrencies.map(async (currency) => {
        const { rate, asOf, source } = await ctx.runAction(api.exchangeRates.getRate, { from: currency, to: targetCurrency });
        return { currency, rate, asOf, source };
      }),
    );

    await ctx.runMutation(internal.orders.persistExportRates, {
      orderId,
      userId: user._id,
      exportCurrency: targetCurrency,
      exportRates: rates,
    });

    return rates;
  },
});

/** The signed-in user opened this quotation: its "updated" badge disappears for them. */
export const markSeen = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("orderSeen")
      .withIndex("by_user_order", (q) => q.eq("userId", user._id).eq("orderId", orderId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { seenAt: Date.now() });
    else await ctx.db.insert("orderSeen", { orderId, userId: user._id, seenAt: Date.now() });
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
