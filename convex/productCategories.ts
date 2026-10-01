import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { requireAdmin, requireUser } from "./lib/permissions";

const MAX_CATEGORIES = 5;

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("productCategories").collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const admin = await requireAdmin(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Le nom est requis.");

    const existing = await ctx.db.query("productCategories").collect();
    if (existing.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("Cette catégorie existe déjà.");
    }
    if (existing.length >= MAX_CATEGORIES) {
      throw new Error(`${MAX_CATEGORIES} catégories maximum : renommez-en une existante plutôt que d'en ajouter une.`);
    }

    const id = await ctx.db.insert("productCategories", { name: trimmed, active: true });
    await logActivity(ctx, { userId: admin._id, action: "category.created", entityType: "productCategory", entityId: id, metadata: { name: trimmed } });
    return id;
  },
});

export const update = mutation({
  args: { categoryId: v.id("productCategories"), name: v.optional(v.string()), active: v.optional(v.boolean()) },
  handler: async (ctx, { categoryId, name, active }) => {
    const admin = await requireAdmin(ctx);
    const patch: { name?: string; active?: boolean } = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Le nom est requis.");
      patch.name = trimmed;
    }
    if (active !== undefined) patch.active = active;
    await ctx.db.patch(categoryId, patch);
    await logActivity(ctx, { userId: admin._id, action: "category.updated", entityType: "productCategory", entityId: categoryId, metadata: patch });
  },
});

/** One-off: seeds the 5 default categories for a ship-chandler catalogue. Skips any name that already exists. */
export const seedDefaults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const defaults = ["Pièces techniques", "Denrées alimentaires", "Équipements de sécurité", "Produits d'entretien", "Consommables divers"];
    const existing = await ctx.db.query("productCategories").collect();
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));
    const created: string[] = [];
    for (const name of defaults) {
      if (existingNames.has(name.toLowerCase())) continue;
      if (existing.length + created.length >= MAX_CATEGORIES) break;
      await ctx.db.insert("productCategories", { name, active: true });
      created.push(name);
    }
    return { created };
  },
});
