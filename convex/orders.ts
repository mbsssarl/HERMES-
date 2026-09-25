import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
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
          itemCount: included.length,
          total: included.reduce((sum, it) => sum + (it.total ?? 0), 0),
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

    const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
    for (const item of items) {
      const next = {
        ...item,
        ...(discountPercent !== undefined ? { lineDiscountPercent: discountPercent } : {}),
        ...(quotationPercent !== undefined ? { quotationPercentLine: quotationPercent } : {}),
      };
      await ctx.db.patch(item._id, {
        ...(discountPercent !== undefined ? { lineDiscountPercent: discountPercent } : {}),
        ...(quotationPercent !== undefined ? { quotationPercentLine: quotationPercent } : {}),
        ...(await computeItemPricing(ctx, next)),
        updatedAt: Date.now(),
      });
    }

    await logActivity(ctx, {
      userId: admin._id,
      action: "order.global_pricing_applied",
      entityType: "order",
      entityId: orderId,
      metadata: { quotationPercent, discountPercent, lines: items.length },
    });
  },
});

/** Soft delete: the order disappears from the lists (visible under the "Supprimé" filter) and can be restored. */
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
