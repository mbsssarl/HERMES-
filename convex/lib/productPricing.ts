import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Returns the currently active price (validTo undefined) for a product in a given country, or null. */
export async function getCurrentPrice(
  ctx: QueryCtx | MutationCtx,
  productId: Id<"products">,
  countryId: Id<"countries">,
): Promise<Doc<"productPrices"> | null> {
  const rows = await ctx.db
    .query("productPrices")
    .withIndex("by_product_country", (q) => q.eq("productId", productId).eq("countryId", countryId))
    .collect();
  return rows.find((r) => r.validTo === undefined) ?? null;
}

export interface SetPriceInput {
  productId: Id<"products">;
  countryId: Id<"countries">;
  price: number;
  currency: string;
  actorId: Id<"users">;
}

/** Closes the current price row (if any) and opens a new one - preserves price history instead of overwriting. */
export async function setCurrentPrice(ctx: MutationCtx, input: SetPriceInput): Promise<Id<"productPrices">> {
  const now = Date.now();
  const current = await getCurrentPrice(ctx, input.productId, input.countryId);
  if (current) {
    await ctx.db.patch(current._id, { validTo: now });
  }

  return await ctx.db.insert("productPrices", {
    productId: input.productId,
    countryId: input.countryId,
    price: input.price,
    currency: input.currency,
    validFrom: now,
    validTo: undefined,
    createdBy: input.actorId,
  });
}
