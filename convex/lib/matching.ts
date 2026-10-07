import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeCode, normalizeName } from "./normalize";
import { computeLinePricing } from "./pricing";
import { findProductByAlias } from "./productAliases";
import { getCurrentPrice, resolveOrderCurrency } from "./productPricing";
import { jaroWinkler } from "./stringSimilarity";

const AUTO_ACCEPT_THRESHOLD = 0.92;
const AMBIGUOUS_THRESHOLD = 0.75;
const CANDIDATE_FLOOR = 0.7;
const MAX_CANDIDATES = 3;
const NAME_SEARCH_LIMIT = 25;

export interface MatchInput {
  rawCode?: string;
  rawDescription: string;
}

export type MatchResult =
  | { status: "matched_impa"; productId: Id<"products">; confidence: 1 }
  | { status: "matched_name"; productId: Id<"products">; confidence: number }
  | { status: "ambiguous"; candidates: Id<"products">[] }
  | { status: "unmatched" };

/**
 * Priority: exact IMPA/code > known alias (exact, previously taught by a
 * human confirmation) > fuzzy name match. A code that fails to resolve is
 * never rescued by a name/alias guess - that would risk silently linking
 * two different products. An alias, unlike fuzzy scoring, is exact and
 * human-confirmed, so it's safe to check even without a code.
 */
export async function matchOrderItem(
  ctx: QueryCtx | MutationCtx,
  input: MatchInput,
): Promise<MatchResult> {
  const rawCode = input.rawCode?.trim();

  if (rawCode) {
    // Comparaison indépendante de la ponctuation ("23.30-34" = "23/30/34" = "233034") - voir lib/normalize.ts.
    const normalizedCode = normalizeCode(rawCode);
    const byImpa = await ctx.db
      .query("products")
      .withIndex("by_normalizedImpaId", (q) => q.eq("normalizedImpaId", normalizedCode))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .unique();
    if (byImpa) {
      return { status: "matched_impa", productId: byImpa._id, confidence: 1 };
    }

    const byCode = await ctx.db
      .query("products")
      .withIndex("by_normalizedCode", (q) => q.eq("normalizedCode", normalizedCode))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .unique();
    if (byCode) {
      return { status: "matched_impa", productId: byCode._id, confidence: 1 };
    }

    return { status: "unmatched" };
  }

  const aliasProductId = await findProductByAlias(ctx, input.rawDescription);
  if (aliasProductId) {
    const product = await ctx.db.get(aliasProductId);
    if (product && product.deletedAt === undefined) {
      return { status: "matched_name", productId: aliasProductId, confidence: 1 };
    }
  }

  const normalized = normalizeName(input.rawDescription);
  if (!normalized) return { status: "unmatched" };

  const searchResults = await ctx.db
    .query("products")
    .withSearchIndex("search_name", (q) => q.search("normalizedName", normalized))
    .take(NAME_SEARCH_LIMIT);

  const active = searchResults.filter((p) => p.deletedAt === undefined);
  if (active.length === 0) return { status: "unmatched" };

  const scored = active
    .map((product) => ({
      product,
      score: jaroWinkler(normalized, product.normalizedName),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < CANDIDATE_FLOOR) return { status: "unmatched" };

  if (best.score >= AUTO_ACCEPT_THRESHOLD) {
    return { status: "matched_name", productId: best.product._id, confidence: best.score };
  }

  if (best.score >= AMBIGUOUS_THRESHOLD) {
    const candidates = scored
      .filter((s) => s.score >= CANDIDATE_FLOOR)
      .slice(0, MAX_CANDIDATES)
      .map((s) => s.product._id);
    return { status: "ambiguous", candidates };
  }

  return { status: "unmatched" };
}

/**
 * Re-runs matching for a single order item and persists the result, but only
 * when the item is currently unmatched/ambiguous - matched_impa/manual
 * decisions are never overwritten by an automatic re-match. Items already
 * matched but still missing a price for the order's country are re-priced
 * instead (see `repriceOrderItem`), since that's a pricing gap, not a
 * matching decision to revisit.
 */
export async function rematchOrderItem(ctx: MutationCtx, item: Doc<"orderItems">): Promise<void> {
  if (item.matchStatus === "matched_impa" || item.matchStatus === "manual") {
    if (item.productId && item.unitPriceOriginal === undefined) {
      await repriceOrderItem(ctx, item);
    }
    return;
  }

  const result = await matchOrderItem(ctx, {
    rawCode: item.rawCode,
    rawDescription: item.rawDescription,
  });

  if (result.status === "unmatched") {
    if (item.matchStatus !== "unmatched") {
      await ctx.db.patch(item._id, {
        matchStatus: "unmatched",
        productId: undefined,
        ambiguousCandidates: undefined,
        updatedAt: Date.now(),
      });
    }
    return;
  }

  if (result.status === "ambiguous") {
    // Proposals the user already ignored are not offered again.
    if (item.proposalsDismissed) return;
    await ctx.db.patch(item._id, {
      matchStatus: "ambiguous",
      productId: undefined,
      ambiguousCandidates: result.candidates,
      matchConfidence: undefined,
      updatedAt: Date.now(),
    });
    return;
  }

  const product = await ctx.db.get(result.productId);
  if (!product) return;

  await applyMatchedProduct(ctx, item, product, result.status, result.confidence);
}

/**
 * Computes every pricing field of an order item from its current state.
 * Base price = manual/file unit price if any, else the catalogue price of the item's product for
 * the order's country. The cotation (markup) then applies to either: the line's own cotation if set,
 * otherwise the order's.
 * Returns all pricing fields undefined when no price is available ("prix manquant").
 */
export async function computeItemPricing(
  ctx: QueryCtx | MutationCtx,
  item: Doc<"orderItems">,
): Promise<Partial<Doc<"orderItems">>> {
  const order = await ctx.db.get(item.orderId);
  let base: number | undefined;
  let priceCurrency: string | undefined;
  const percent = item.quotationPercentLine ?? order?.quotationPercentOverride ?? 0;

  if (item.unitPriceManual !== undefined) {
    base = item.unitPriceManual;
    // Un prix saisi à la main ne référence aucune ligne de productPrices : on retient la devise du pays
    // de cotation de la commande.
    const country = order ? await ctx.db.get(order.countryId) : null;
    priceCurrency = country?.currency;
  } else if (item.productId && order) {
    const current = await getCurrentPrice(ctx, item.productId, order.countryId);
    if (current) {
      base = current.price;
      priceCurrency = current.currency;
    }
  }

  if (base === undefined) {
    return {
      unitPriceOriginal: undefined,
      priceCurrency: undefined,
      quotationPercentApplied: undefined,
      priceAfterQuotation: undefined,
      finalUnitPrice: undefined,
      total: undefined,
    };
  }

  const pricing = computeLinePricing({
    unitPriceOriginal: base,
    quotationPercent: percent,
    quantity: item.quotedQuantity ?? item.rawQuantity ?? 1,
  });
  return {
    unitPriceOriginal: base,
    priceCurrency,
    quotationPercentApplied: percent,
    priceAfterQuotation: pricing.priceAfterQuotation,
    finalUnitPrice: pricing.finalUnitPrice,
    total: pricing.total,
  };
}

/**
 * Applies a resolved product match to an order item and looks up its price
 * for the order's country. If no price exists yet for that country, the
 * product identity is still recorded (productId/matchStatus) but pricing
 * fields are left undefined - the UI shows this as "prix manquant" rather
 * than blocking. `repriceOrderItem` fills it in automatically once an admin
 * adds the price.
 */
export async function applyMatchedProduct(
  ctx: MutationCtx,
  item: Doc<"orderItems">,
  product: Doc<"products">,
  matchStatus: "matched_impa" | "matched_name" | "manual",
  confidence: number,
): Promise<void> {
  const quantity = item.quotedQuantity ?? item.rawQuantity ?? 1;
  const identified = { ...item, productId: product._id, quotedQuantity: quantity };
  const pricing = await computeItemPricing(ctx, identified);

  await ctx.db.patch(item._id, {
    productId: product._id,
    matchStatus,
    matchConfidence: confidence,
    ambiguousCandidates: undefined,
    quotedQuantity: quantity,
    ...pricing,
    updatedAt: Date.now(),
  });
}

/** Retries pricing for an item whose product is already identified but has no price for the order's country yet. */
export async function repriceOrderItem(ctx: MutationCtx, item: Doc<"orderItems">): Promise<void> {
  if (!item.productId) return;
  const product = await ctx.db.get(item.productId);
  if (!product) return;

  await applyMatchedProduct(
    ctx,
    item,
    product,
    item.matchStatus as "matched_impa" | "matched_name" | "manual",
    item.matchConfidence ?? 1,
  );
}
