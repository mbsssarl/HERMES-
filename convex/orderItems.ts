import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { noteCatalogUpdate } from "./lib/catalogUpdates";
import { applyMatchedProduct, computeItemPricing, matchOrderItem, rematchOrderItem } from "./lib/matching";
import { learnAlias } from "./lib/productAliases";
import { logActivity } from "./lib/audit";
import { applyLineChanges, lineChangesFields, validateLineChanges } from "./lib/lineEdits";
import { requireUser } from "./lib/permissions";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const listByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    await requireUser(ctx);
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .order("asc")
      .collect();

    // Resolving productId here (rather than in the client) keeps the query
    // reactive: if a product changes, this query re-runs for every viewer.
    return await Promise.all(
      items.map(async (item) => ({
        ...item,
        product: item.productId ? await ctx.db.get(item.productId) : null,
        ambiguousProducts: item.ambiguousCandidates
          ? await Promise.all(item.ambiguousCandidates.map((id) => ctx.db.get(id)))
          : [],
      })),
    );
  },
});

export const listUnmatchedInternal = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order_and_status", (q) => q.eq("orderId", orderId).eq("matchStatus", "unmatched"))
      .collect();
    return items;
  },
});

export const confirmAmbiguousMatch = mutation({
  args: { orderItemId: v.id("orderItems"), productId: v.id("products") },
  handler: async (ctx, { orderItemId, productId }) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get(orderItemId);
    const product = await ctx.db.get(productId);
    if (!item || !product) throw new Error("Ligne ou produit introuvable.");

    await applyMatchedProduct(ctx, item, product, "manual", 1);
    await ctx.db.patch(orderItemId, { updatedBy: user._id });
    // No code was supplied for this line (that's why it was ambiguous) -
    // teach the wording so the same client phrasing matches instantly next time.
    if (!item.rawCode) await learnAlias(ctx, productId, item.rawDescription, user._id);
  },
});

export const setManualMatch = mutation({
  args: { orderItemId: v.id("orderItems"), productId: v.id("products") },
  handler: async (ctx, { orderItemId, productId }) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get(orderItemId);
    const product = await ctx.db.get(productId);
    if (!item || !product) throw new Error("Ligne ou produit introuvable.");

    await applyMatchedProduct(ctx, item, product, "manual", 1);
    await ctx.db.patch(orderItemId, { updatedBy: user._id });
    if (!item.rawCode) await learnAlias(ctx, productId, item.rawDescription, user._id);
  },
});

export const clearMatch = mutation({
  args: { orderItemId: v.id("orderItems") },
  handler: async (ctx, { orderItemId }) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get(orderItemId);
    if (!item) throw new Error("Ligne introuvable.");
    const unmatched = { ...item, productId: undefined };
    await ctx.db.patch(orderItemId, {
      productId: undefined,
      matchStatus: "unmatched",
      matchConfidence: undefined,
      ambiguousCandidates: undefined,
      ...(await computeItemPricing(ctx, unmatched)),
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
  },
});

const normalizedClientItemValidator = v.object({
  rawCode: v.optional(v.string()),
  rawDescription: v.string(),
  rawQuantity: v.optional(v.number()),
  rawUnit: v.optional(v.string()),
  rawOrigin: v.optional(v.string()),
  quotedQuantity: v.optional(v.number()),
  unitPrice: v.optional(v.number()),
  discountPercent: v.optional(v.number()),
  reqNotes: v.optional(v.string()),
  enqNotes: v.optional(v.string()),
  sourceRow: v.optional(v.number()),
});

const documentMetadataValidator = v.object({
  vessel: v.optional(v.string()),
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
});

/** Persists freshly extracted client-document lines and matches each one against the catalogue. */
export const saveExtractedItemsInternal = internalMutation({
  args: {
    orderId: v.id("orders"),
    items: v.array(normalizedClientItemValidator),
    metadata: v.optional(documentMetadataValidator),
  },
  handler: async (ctx, { orderId, items, metadata }) => {
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Commande introuvable.");

    // Fill in blanks only - never override a value the user already typed
    // (whether before or after this document was imported).
    if (metadata) {
      const patch: Record<string, unknown> = {};
      if (metadata.vessel && !order.vessel) patch.vessel = metadata.vessel;
      if (metadata.supplyPlace && !order.supplyPlace) patch.supplyPlace = metadata.supplyPlace;
      if (metadata.clientOrderNumber && !order.clientOrderNumber) patch.clientOrderNumber = metadata.clientOrderNumber;
      const { vessel: _v, supplyPlace: _s, clientOrderNumber: _c, ...info } = metadata;
      const documentInfo: Record<string, string> = { ...(order.documentInfo ?? {}) };
      for (const [key, value] of Object.entries(info)) {
        if (value && !documentInfo[key]) documentInfo[key] = value;
      }
      if (Object.keys(documentInfo).length > 0) {
        Object.assign(patch, { documentInfo });
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(orderId, patch);
      }
    }

    const existingCount = (
      await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()
    ).length;

    for (let i = 0; i < items.length; i++) {
      const raw = items[i];
      const now = Date.now();
      const orderItemId = await ctx.db.insert("orderItems", {
        orderId,
        lineNo: existingCount + i + 1,
        rawCode: raw.rawCode,
        rawDescription: raw.rawDescription,
        rawQuantity: raw.rawQuantity,
        rawUnit: raw.rawUnit,
        rawOrigin: raw.rawOrigin,
        quotedQuantity: raw.quotedQuantity,
        unitPriceManual: raw.unitPrice,
        reqNotes: raw.reqNotes,
        enqNotes: raw.enqNotes,
        sourceRow: raw.sourceRow,
        matchStatus: "unmatched",
        createdAt: now,
        updatedAt: now,
      });

      // A unit price given in the file prices the line right away, even without a catalogue match.
      if (raw.unitPrice !== undefined) {
        const inserted = await ctx.db.get(orderItemId);
        if (inserted) await ctx.db.patch(orderItemId, await computeItemPricing(ctx, inserted));
      }

      const result = await matchOrderItem(ctx, { rawCode: raw.rawCode, rawDescription: raw.rawDescription });
      if (result.status === "ambiguous") {
        await ctx.db.patch(orderItemId, { matchStatus: "ambiguous", ambiguousCandidates: result.candidates });
      } else if (result.status !== "unmatched") {
        const product = await ctx.db.get(result.productId);
        const item = await ctx.db.get(orderItemId);
        if (product && item) {
          await applyMatchedProduct(ctx, item, product, result.status, result.confidence);
        }
      }
    }

    if (order.status === "draft") {
      await ctx.db.patch(orderId, { status: "processing", updatedAt: Date.now() });
    }
  },
});

/**
 * Modification d'une cellule de la quotation. Tout le monde peut modifier, mais seul le PROPRIÉTAIRE de la
 * quotation (celui qui l'a créée) voit ses modifications appliquées tout de suite : celles des autres sont
 * enregistrées comme propositions (sous-ligne sous la ligne concernée) que le propriétaire valide ou invalide
 * (voir orderItemEdits.decide). Plusieurs modifications successives d'un même utilisateur sur une même ligne
 * sont regroupées dans une seule proposition.
 */
export const update = mutation({
  args: { orderItemId: v.id("orderItems"), ...lineChangesFields },
  handler: async (ctx, { orderItemId, ...edits }): Promise<{ applied: boolean }> => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get(orderItemId);
    if (!item) throw new Error("Ligne introuvable.");
    validateLineChanges(edits);

    const order = await ctx.db.get(item.orderId);
    if (!order || order.createdBy === user._id) {
      await applyLineChanges(ctx, item, edits, user._id);
      return { applied: true };
    }

    const pending = await ctx.db.query("orderItemEdits").withIndex("by_item", (q) => q.eq("orderItemId", orderItemId)).collect();
    const mine = pending.find((p) => p.status === "pending" && p.proposedBy === user._id);
    if (mine) {
      await ctx.db.patch(mine._id, { changes: { ...mine.changes, ...edits }, proposedAt: Date.now() });
    } else {
      await ctx.db.insert("orderItemEdits", {
        orderId: item.orderId,
        orderItemId,
        proposedBy: user._id,
        proposedAt: Date.now(),
        changes: edits,
        status: "pending",
      });
    }
    await logActivity(ctx, {
      userId: user._id,
      action: "order_item.edit_proposed",
      entityType: "order",
      entityId: item.orderId,
      metadata: { line: item.lineNo, changes: edits },
    });
    return { applied: false };
  },
});
const REMATCH_PAGE_SIZE = 100;

/**
 * Re-matches every order line that is still waiting on the catalogue (unmatched, ambiguous, or
 * identified but without a price), across all orders. Scheduled whenever products or prices are
 * added, so open quotations update on their own (the UI is reactive). Works page by page and
 * re-schedules itself until the whole table has been scanned.
 */
export const rematchPendingInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    // Start of this wave and who caused it (for the "quotation updated" badge).
    startedAt: v.optional(v.number()),
    actorEmail: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, startedAt, actorEmail }): Promise<void> => {
    const wave = startedAt ?? Date.now();
    const page = await ctx.db.query("orderItems").paginate({ numItems: REMATCH_PAGE_SIZE, cursor: cursor ?? null });
    const improved = new Map<Id<"orders">, number>();

    for (const item of page.page) {
      if (item.unitPriceManual !== undefined && item.matchStatus !== "unmatched" && item.matchStatus !== "ambiguous") continue;
      const waitingForMatch = item.matchStatus === "unmatched" || item.matchStatus === "ambiguous";
      const waitingForPrice = item.productId !== undefined && item.unitPriceOriginal === undefined;
      if (!waitingForMatch && !waitingForPrice) continue;

      await rematchOrderItem(ctx, item);
      const after = await ctx.db.get(item._id);
      const nowMatched = waitingForMatch && after !== null && after.productId !== undefined;
      const nowPriced = after !== null && item.unitPriceOriginal === undefined && after.unitPriceOriginal !== undefined;
      if (nowMatched || nowPriced) improved.set(item.orderId, (improved.get(item.orderId) ?? 0) + 1);
    }
    for (const [orderId, lines] of improved) await noteCatalogUpdate(ctx, orderId, lines, actorEmail, wave);

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.orderItems.rematchPendingInternal, {
        cursor: page.continueCursor,
        startedAt: wave,
        actorEmail,
      });
    }
  },
});

/** One-off maintenance: recompute stored pricing of every priced line (after a change of the pricing formula). */
export const repriceAllInternal = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<void> => {
    const page = await ctx.db.query("orderItems").paginate({ numItems: 100, cursor: cursor ?? null });
    for (const item of page.page) {
      const cleaned = { ...item, lineDiscountPercent: undefined };
      await ctx.db.patch(item._id, {
        lineDiscountPercent: undefined,
        ...(item.unitPriceOriginal === undefined ? {} : await computeItemPricing(ctx, cleaned)),
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.orderItems.repriceAllInternal, { cursor: page.continueCursor });
    }
  },
});

/** Includes / excludes lines from the quotation (totals, statistics, generated PDF and exported file). */
export const setExcluded = mutation({
  args: { orderItemIds: v.array(v.id("orderItems")), excluded: v.boolean() },
  handler: async (ctx, { orderItemIds, excluded }) => {
    const user = await requireUser(ctx);
    for (const id of orderItemIds) {
      await ctx.db.patch(id, { excluded: excluded ? true : undefined, updatedAt: Date.now(), updatedBy: user._id });
    }
  },
});

/**
 * Ignores one proposed match of a line. When no proposal remains, the line becomes "unknown"
 * and is not proposed again automatically.
 */
export const dismissProposal = mutation({
  args: { orderItemId: v.id("orderItems"), productId: v.id("products") },
  handler: async (ctx, { orderItemId, productId }) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get(orderItemId);
    if (!item) throw new Error("Ligne introuvable.");

    const remaining = (item.ambiguousCandidates ?? []).filter((id) => id !== productId);
    if (remaining.length > 0) {
      await ctx.db.patch(orderItemId, { ambiguousCandidates: remaining, updatedAt: Date.now(), updatedBy: user._id });
      return;
    }
    await ctx.db.patch(orderItemId, {
      matchStatus: "unmatched",
      productId: undefined,
      matchConfidence: undefined,
      ambiguousCandidates: undefined,
      proposalsDismissed: true,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
  },
});
