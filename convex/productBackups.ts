import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { companyIdOf, getOwned, requireAdmin } from "./lib/permissions";

const LIST_LIMIT = 1000;

type BackupProduct = {
  name?: string;
  code?: string;
  impaId?: string;
  unit?: string;
  description?: string;
  category?: string;
};

/** Deleted products kept as a safety copy (most recent first), as light summaries - this company's only. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);
    const all = await ctx.db.query("productBackups").withIndex("by_company_and_deletedAt", (q) => q.eq("companyId", companyId)).collect();
    const rows = [...all].reverse().slice(0, LIST_LIMIT);
    return {
      total: all.length,
      items: rows.map((b) => {
        const p = b.product as BackupProduct;
        return {
          _id: b._id,
          name: p.name ?? "",
          code: p.impaId ?? p.code ?? "",
          unit: p.unit ?? "",
          priceCount: b.prices.length,
          deletedAt: b.deletedAt,
          deletedBy: b.deletedBy,
        };
      }),
    };
  },
});

/** Full content of one backup (product fields and every price row), for the "consult" view. */
export const get = query({
  args: { backupId: v.id("productBackups") },
  handler: async (ctx, { backupId }) => {
    const admin = await requireAdmin(ctx);
    const b = await getOwned(ctx, admin, "productBackups", backupId);
    if (!b) return null;
    return { product: b.product as BackupProduct & Record<string, unknown>, prices: b.prices as Array<Record<string, unknown>>, aliases: b.aliases as Array<Record<string, unknown>>, deletedAt: b.deletedAt, deletedBy: b.deletedBy };
  },
});

/** Puts backed-up products back into the catalogue (with their prices and aliases), then removes the backup rows. */
export const restore = mutation({
  args: { backupIds: v.array(v.id("productBackups")) },
  handler: async (ctx, { backupIds }) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);
    let restored = 0;
    for (const backupId of backupIds) {
      const backup = await getOwned(ctx, admin, "productBackups", backupId);
      if (!backup) continue;

      const { _id: _o, _creationTime: _t, ...productFields } = backup.product as Record<string, unknown>;
      const newId = await ctx.db.insert("products", {
        ...(productFields as Omit<Doc<"products">, "_id" | "_creationTime">),
        companyId,
        deletedAt: undefined,
        active: true,
        updatedAt: Date.now(),
        updatedBy: admin._id,
      });
      for (const price of backup.prices as Record<string, unknown>[]) {
        const { _id, _creationTime, ...fields } = price;
        await ctx.db.insert("productPrices", { ...(fields as Omit<Doc<"productPrices">, "_id" | "_creationTime">), companyId, productId: newId });
      }
      for (const alias of backup.aliases as Record<string, unknown>[]) {
        const { _id, _creationTime, ...fields } = alias;
        await ctx.db.insert("productAliases", { ...(fields as Omit<Doc<"productAliases">, "_id" | "_creationTime">), companyId, productId: newId });
      }
      await ctx.db.delete(backupId);
      restored++;
    }

    await logActivity(ctx, { userId: admin._id, action: "product.restored", entityType: "product", entityId: "backup", metadata: { count: restored } });
    // Restored products can match pending quotation lines again.
    if (restored > 0) {
      await ctx.scheduler.runAfter(0, internal.orderItems.rematchPendingInternal, { companyId, actorEmail: admin.email ?? undefined });
    }
    return { restored };
  },
});

/** Removes backup rows for good: this is the only way a deleted product is truly gone. */
export const purge = mutation({
  args: { backupIds: v.array(v.id("productBackups")) },
  handler: async (ctx, { backupIds }) => {
    const admin = await requireAdmin(ctx);
    let purged = 0;
    for (const id of backupIds) {
      // Une sauvegarde d'une autre entreprise est ignorée (comme si elle n'existait pas).
      if (!(await getOwned(ctx, admin, "productBackups", id))) continue;
      await ctx.db.delete(id);
      purged++;
    }
    await logActivity(ctx, { userId: admin._id, action: "product.backup_purged", entityType: "product", entityId: "backup", metadata: { count: purged } });
    return { purged };
  },
});
