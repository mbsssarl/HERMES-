import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Records that a quotation was updated automatically after an addition to the catalogue (import, new product,
 * new price). Updates made during the same wave (same `startedAt`) add up; a newer wave starts a new count.
 */
export async function noteCatalogUpdate(
  ctx: MutationCtx,
  orderId: Id<"orders">,
  lines: number,
  by: string | undefined,
  startedAt: number,
): Promise<void> {
  if (lines <= 0) return;
  const order = await ctx.db.get(orderId);
  if (!order) return;
  const sameWave = order.catalogUpdatedAt !== undefined && order.catalogUpdatedAt >= startedAt;
  await ctx.db.patch(orderId, {
    catalogUpdatedAt: Date.now(),
    catalogUpdatedLines: (sameWave ? (order.catalogUpdatedLines ?? 0) : 0) + lines,
    catalogUpdatedBy: by,
  });
}
