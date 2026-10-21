import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Devise utilisée quand l'entreprise n'en a pas choisi une autre. */
export const DEFAULT_BASE_CURRENCY = "USD";

/** Devise utilisée par l'entreprise (celle de ses prix et de ses quotations). */
export async function baseCurrencyOf(ctx: QueryCtx | MutationCtx, companyId: Id<"companies"> | undefined): Promise<string> {
  if (!companyId) return DEFAULT_BASE_CURRENCY;
  const company = await ctx.db.get(companyId);
  return company?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
}
