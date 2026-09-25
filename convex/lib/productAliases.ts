import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeName } from "./normalize";

/** Exact lookup by normalized alias - used as a matching shortcut before falling back to fuzzy name search. */
export async function findProductByAlias(
  ctx: QueryCtx | MutationCtx,
  rawDescription: string,
): Promise<Id<"products"> | null> {
  const normalized = normalizeName(rawDescription);
  if (!normalized) return null;

  const alias = await ctx.db
    .query("productAliases")
    .withIndex("by_normalizedAlias", (q) => q.eq("normalizedAlias", normalized))
    .first();

  return alias?.productId ?? null;
}

/**
 * Teaches the system a new alias: called whenever a user confirms an
 * ambiguous match or picks a product manually, so the same client wording
 * resolves as an exact match next time instead of going through fuzzy
 * scoring again. No-ops if this exact (product, alias) pair is already known.
 */
export async function learnAlias(
  ctx: MutationCtx,
  productId: Id<"products">,
  rawDescription: string,
  actorId: Id<"users">,
): Promise<void> {
  const normalizedAlias = normalizeName(rawDescription);
  if (!normalizedAlias) return;

  const existing = await ctx.db
    .query("productAliases")
    .withIndex("by_normalizedAlias", (q) => q.eq("normalizedAlias", normalizedAlias))
    .first();
  if (existing) return;

  await ctx.db.insert("productAliases", {
    productId,
    alias: rawDescription.trim(),
    normalizedAlias,
    createdAt: Date.now(),
    createdBy: actorId,
  });
}
