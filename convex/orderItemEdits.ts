import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { applyLineChanges } from "./lib/lineEdits";
import { requireUser } from "./lib/permissions";

/** Modifications en attente d'une quotation (tout le monde les voit ; seul le propriétaire les valide). */
export const listByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("orderItemEdits").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
    const pending = rows.filter((r) => r.status === "pending");
    return await Promise.all(
      pending.map(async (r) => ({ ...r, proposedByEmail: (await ctx.db.get(r.proposedBy))?.email ?? null })),
    );
  },
});

/** Le propriétaire de la quotation valide (la modification est appliquée à la ligne) ou invalide une proposition. */
export const decide = mutation({
  args: { editId: v.id("orderItemEdits"), approve: v.boolean() },
  handler: async (ctx, { editId, approve }) => {
    const user = await requireUser(ctx);
    const edit = await ctx.db.get(editId);
    if (!edit) throw new Error("Modification introuvable.");
    if (edit.status !== "pending") throw new Error("Cette modification a déjà été traitée.");

    const order = await ctx.db.get(edit.orderId);
    if (!order) throw new Error("Quotation introuvable.");
    if (order.createdBy !== user._id) {
      throw new Error("Seul le propriétaire de la quotation peut valider ou invalider une modification.");
    }

    if (approve) {
      const item = await ctx.db.get(edit.orderItemId);
      if (!item) throw new Error("La ligne concernée n'existe plus.");
      await applyLineChanges(ctx, item, edit.changes, edit.proposedBy);
    }
    await ctx.db.patch(editId, { status: approve ? "approved" : "rejected", decidedBy: user._id, decidedAt: Date.now() });
    await logActivity(ctx, {
      userId: user._id,
      action: approve ? "order_item.edit_approved" : "order_item.edit_rejected",
      entityType: "order",
      entityId: edit.orderId,
      metadata: { orderItemId: edit.orderItemId, proposedBy: edit.proposedBy, changes: edit.changes },
    });
  },
});

/** L'auteur d'une proposition encore en attente peut la retirer. */
export const withdraw = mutation({
  args: { editId: v.id("orderItemEdits") },
  handler: async (ctx, { editId }) => {
    const user = await requireUser(ctx);
    const edit = await ctx.db.get(editId);
    if (!edit) throw new Error("Modification introuvable.");
    if (edit.status !== "pending") throw new Error("Cette modification a déjà été traitée.");
    if (edit.proposedBy !== user._id) throw new Error("Seul l'auteur peut retirer sa proposition.");
    await ctx.db.patch(editId, { status: "withdrawn", decidedBy: user._id, decidedAt: Date.now() });
  },
});
