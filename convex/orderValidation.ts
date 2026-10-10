import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { normalizeCode, normalizeName } from "./lib/normalize";
import { requireUser } from "./lib/permissions";

/** Validation de la commande (fichier final du client) et ses articles retenus ; null tant que la commande n'est pas validée. */
export const get = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    await requireUser(ctx);
    const order = await ctx.db.get(orderId);
    if (!order || order.validatedAt === undefined) return null;
    const items = await ctx.db.query("orderValidatedItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
    items.sort((a, b) => a.position - b.position);
    const validator = order.validatedBy ? await ctx.db.get(order.validatedBy) : null;
    return {
      validatedAt: order.validatedAt,
      validatedByEmail: validator?.email ?? null,
      fileName: order.validationFileName ?? "",
      items: items.map((it) => ({ ...it, matched: it.orderItemId !== undefined })),
    };
  },
});

const validationItemValidator = v.object({
  lineRef: v.optional(v.number()),
  rawCode: v.optional(v.string()),
  description: v.string(),
  quantity: v.optional(v.number()),
  unit: v.optional(v.string()),
  unitPrice: v.optional(v.number()),
});

/**
 * Enregistre la validation d'une commande : remplace une éventuelle validation précédente, rattache chaque ligne
 * du fichier à sa ligne de cotation d'origine (code, puis description) pour en retrouver la marge, et passe la
 * commande au statut « PO reçu ». Réservé au propriétaire de la quotation et aux administrateurs.
 */
export const saveValidation = internalMutation({
  args: {
    orderId: v.id("orders"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    items: v.array(validationItemValidator),
  },
  handler: async (ctx, { orderId, userId, storageId, fileName, mimeType, size, items }) => {
    const order = await ctx.db.get(orderId);
    const user = await ctx.db.get(userId);
    if (!order || !user) throw new Error("Commande introuvable.");
    if (order.createdBy !== userId && user.role !== "admin") {
      throw new Error("Seul le propriétaire de la quotation (ou un administrateur) peut valider la commande.");
    }

    // Validation précédente : lignes et fichier remplacés.
    for (const old of await ctx.db.query("orderValidatedItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()) {
      await ctx.db.delete(old._id);
    }
    const files = await ctx.db.query("uploadedFiles").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
    for (const f of files) {
      if (f.kind !== "validation_file") continue;
      await ctx.storage.delete(f.storageId);
      await ctx.db.delete(f._id);
    }
    await ctx.db.insert("uploadedFiles", {
      orderId,
      kind: "validation_file",
      storageId,
      fileName,
      mimeType,
      size,
      status: "extracted",
      uploadedBy: userId,
      uploadedAt: Date.now(),
    });

    // Rattachement aux lignes de la cotation d'origine, chacune utilisée une seule fois.
    const original = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
    const byCode = new Map<string, typeof original>();
    const byName = new Map<string, typeof original>();
    for (const o of original) {
      if (o.rawCode) byCode.set(normalizeCode(o.rawCode), [...(byCode.get(normalizeCode(o.rawCode)) ?? []), o]);
      byName.set(normalizeName(o.rawDescription), [...(byName.get(normalizeName(o.rawDescription)) ?? []), o]);
    }
    const used = new Set<string>();
    const take = (list: typeof original | undefined) => list?.find((o) => !used.has(o._id));

    let matched = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const found =
        (it.rawCode ? take(byCode.get(normalizeCode(it.rawCode))) : undefined) ?? take(byName.get(normalizeName(it.description)));
      if (found) { used.add(found._id); matched++; }
      await ctx.db.insert("orderValidatedItems", {
        orderId,
        position: i,
        lineRef: it.lineRef,
        rawCode: it.rawCode,
        description: it.description,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        orderItemId: found?._id,
        marginPercent: found?.quotationPercentApplied ?? order.quotationPercentOverride ?? 0,
      });
    }

    await ctx.db.patch(orderId, {
      validatedAt: Date.now(),
      validatedBy: userId,
      validationFileName: fileName,
      status: order.status === "archived" ? order.status : "po",
      updatedAt: Date.now(),
    });
    await logActivity(ctx, {
      userId,
      action: "order.validated",
      entityType: "order",
      entityId: orderId,
      metadata: { fileName, lines: items.length, matched },
    });
    return { lines: items.length, matched };
  },
});
