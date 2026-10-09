import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { computeItemPricing, rematchOrderItem } from "./matching";

/** Champs d'une ligne de quotation modifiables à la main (cellules du tableau). */
export const lineChangesFields = {
  rawCode: v.optional(v.string()),
  rawDescription: v.optional(v.string()),
  rawQuantity: v.optional(v.number()),
  rawUnit: v.optional(v.string()),
  rawOrigin: v.optional(v.string()),
  quotedQuantity: v.optional(v.number()),
  quotationPercent: v.optional(v.number()),
  // null = retirer le prix manuel (retour au prix du catalogue)
  unitPrice: v.optional(v.union(v.number(), v.null())),
  reqNotes: v.optional(v.string()),
  enqNotes: v.optional(v.string()),
};
export const lineChangesValidator = v.object(lineChangesFields);
export type LineChanges = Infer<typeof lineChangesValidator>;

export function validateLineChanges(edits: LineChanges) {
  if (edits.rawDescription !== undefined && !edits.rawDescription.trim()) {
    throw new Error("La description ne peut pas être vide.");
  }
  if (edits.rawQuantity !== undefined && !(edits.rawQuantity > 0)) throw new Error("Quantité invalide.");
  if (edits.quotedQuantity !== undefined && !(edits.quotedQuantity > 0)) throw new Error("Quantité invalide.");
  if (typeof edits.unitPrice === "number" && edits.unitPrice < 0) throw new Error("Prix invalide.");
  if (edits.quotationPercent !== undefined && (edits.quotationPercent < 0 || edits.quotationPercent > 1000)) {
    throw new Error("Cotation invalide.");
  }
}

/** Applique des modifications à une ligne (puis recalcule ses montants, ou son rapprochement si l'article change). */
export async function applyLineChanges(
  ctx: MutationCtx,
  item: Doc<"orderItems">,
  edits: LineChanges,
  actorId: Id<"users">,
): Promise<void> {
  validateLineChanges(edits);
  const orderItemId = item._id;

  const patch: Partial<Doc<"orderItems">> = { updatedAt: Date.now(), updatedBy: actorId };
  if (edits.rawCode !== undefined) patch.rawCode = edits.rawCode.trim() || undefined;
  if (edits.rawDescription !== undefined) patch.rawDescription = edits.rawDescription.trim();
  if (edits.rawUnit !== undefined) patch.rawUnit = edits.rawUnit.trim() || undefined;
  if (edits.rawOrigin !== undefined) patch.rawOrigin = edits.rawOrigin.trim() || undefined;
  if (edits.reqNotes !== undefined) patch.reqNotes = edits.reqNotes;
  if (edits.enqNotes !== undefined) patch.enqNotes = edits.enqNotes;
  if (edits.quotationPercent !== undefined) patch.quotationPercentLine = edits.quotationPercent;

  // The table shows a single "Quantity": editing it sets the quantity used for the amounts too.
  if (edits.rawQuantity !== undefined) {
    patch.rawQuantity = edits.rawQuantity;
    if (edits.quotedQuantity === undefined) patch.quotedQuantity = edits.rawQuantity;
  }
  if (edits.quotedQuantity !== undefined) patch.quotedQuantity = edits.quotedQuantity;
  if (edits.unitPrice !== undefined) patch.unitPriceManual = edits.unitPrice === null ? undefined : Math.round(edits.unitPrice * 100) / 100;

  const identityChanged =
    (edits.rawCode !== undefined && (edits.rawCode.trim() || undefined) !== item.rawCode) ||
    (patch.rawDescription !== undefined && patch.rawDescription !== item.rawDescription);

  if (identityChanged) {
    // The requested article changed: the previous match no longer applies. Reset it and
    // match again from the new code/description (a manual choice is dropped too).
    Object.assign(patch, {
      productId: undefined,
      matchStatus: "unmatched" as const,
      matchConfidence: undefined,
      ambiguousCandidates: undefined,
      proposalsDismissed: undefined,
    });
    await ctx.db.patch(orderItemId, patch);
    const reset = await ctx.db.get(orderItemId);
    if (!reset) return;
    await ctx.db.patch(orderItemId, await computeItemPricing(ctx, reset));
    const fresh = await ctx.db.get(orderItemId);
    if (fresh) await rematchOrderItem(ctx, fresh);
    return;
  }

  // Same article: recompute the line amounts (quantity, discount or unit price may have changed).
  await ctx.db.patch(orderItemId, patch);
  const updated = await ctx.db.get(orderItemId);
  if (updated) await ctx.db.patch(orderItemId, await computeItemPricing(ctx, updated));
}
