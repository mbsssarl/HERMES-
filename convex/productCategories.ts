import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { IMPA_CATEGORIES, NO_IMPA_CATEGORY } from "./lib/impaCategories";
import { companyIdOf, requireAdmin, requireOwned, requireUser } from "./lib/permissions";

// Garde-fou seulement (le catalogue IMPA en compte 36) - plus de limite à 5 comme avant l'alignement sur IMPA.
const MAX_CATEGORIES = 100;

// Premières catégories génériques (liste de 5), remplacées par celles d'IMPA.
const LEGACY_DEFAULTS = ["Pièces techniques", "Denrées alimentaires", "Équipements de sécurité", "Produits d'entretien", "Consommables divers"];

const ofCompany = (ctx: MutationCtx | { db: MutationCtx["db"] }, companyId: Id<"companies">) =>
  ctx.db.query("productCategories").withIndex("by_company_and_name", (q) => q.eq("companyId", companyId));

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("productCategories")
      .withIndex("by_company_and_name", (q) => q.eq("companyId", companyIdOf(user)))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Le nom est requis.");

    const existing = await ofCompany(ctx, companyId).collect();
    if (existing.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("Cette catégorie existe déjà.");
    }
    if (existing.length >= MAX_CATEGORIES) {
      throw new Error(`${MAX_CATEGORIES} catégories maximum.`);
    }

    const id = await ctx.db.insert("productCategories", { companyId, name: trimmed, active: true });
    await logActivity(ctx, { userId: admin._id, action: "category.created", entityType: "productCategory", entityId: id, metadata: { name: trimmed } });
    return id;
  },
});

export const update = mutation({
  args: { categoryId: v.id("productCategories"), name: v.optional(v.string()), active: v.optional(v.boolean()) },
  handler: async (ctx, { categoryId, name, active }) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);
    const category = await requireOwned(ctx, admin, "productCategories", categoryId, "Catégorie introuvable.");
    const patch: { name?: string; active?: boolean } = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Le nom est requis.");
      patch.name = trimmed;
    }
    if (active !== undefined) patch.active = active;
    await ctx.db.patch(categoryId, patch);

    // Un produit stocke le nom de sa catégorie : renommer doit suivre, sinon les produits déjà classés
    // se retrouveraient dans une catégorie qui n'existe plus.
    if (patch.name !== undefined && patch.name !== category.name) {
      const products = await ctx.db
        .query("products")
        .withIndex("by_company_and_category", (q) => q.eq("companyId", companyId).eq("category", category.name))
        .collect();
      for (const p of products) await ctx.db.patch(p._id, { category: patch.name });
    }
    await logActivity(ctx, { userId: admin._id, action: "category.updated", entityType: "productCategory", entityId: categoryId, metadata: patch });
  },
});

/** Ajoute les 36 catégories du catalogue IMPA (et « No IMPA ») qui manquent à l'entreprise - idempotent. */
async function seedImpa(ctx: MutationCtx, companyId: Id<"companies">): Promise<{ created: string[] }> {
  const existing = await ofCompany(ctx, companyId).collect();
  const names = new Set(existing.map((c) => c.name.toLowerCase()));
  const created: string[] = [];
  for (const name of [...IMPA_CATEGORIES, NO_IMPA_CATEGORY]) {
    if (names.has(name.toLowerCase())) continue;
    await ctx.db.insert("productCategories", { companyId, name, active: true });
    created.push(name);
  }
  return { created };
}

/** CLI : `npx convex run productCategories:seedImpaCli '{"companyId":"..."}'` (aucune authentification requise). */
export const seedImpaCli = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => seedImpa(ctx, companyId),
});

/** Bouton admin (Admin > Catégories) : charge les catégories IMPA manquantes. */
export const seedImpaFromAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const result = await seedImpa(ctx, companyIdOf(admin));
    if (result.created.length > 0) {
      await logActivity(ctx, { userId: admin._id, action: "category.bulk_seeded", entityType: "productCategory", metadata: result });
    }
    return result;
  },
});

/**
 * Migration ponctuelle (une entreprise) : supprime les 5 anciennes catégories génériques (les produits qui y étaient
 * classés perdent cette catégorie), crée « No IMPA », puis y range tous les produits sans code IMPA qui n'ont pas
 * (ou plus) de catégorie.
 */
export const migrateToImpaCategories = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const seeded = await seedImpa(ctx, companyId);

    const categories = await ofCompany(ctx, companyId).collect();
    const removed: string[] = [];
    for (const c of categories) {
      if (!LEGACY_DEFAULTS.includes(c.name)) continue;
      await ctx.db.delete(c._id);
      removed.push(c.name);
    }

    let unclassified = 0;
    let movedToNoImpa = 0;
    for await (const p of ctx.db.query("products").withIndex("by_company", (q) => q.eq("companyId", companyId))) {
      const hadLegacy = p.category !== undefined && LEGACY_DEFAULTS.includes(p.category);
      const noCode = !p.impaId && !p.code;
      if (noCode && (!p.category || hadLegacy)) {
        await ctx.db.patch(p._id, { category: NO_IMPA_CATEGORY });
        movedToNoImpa++;
      } else if (hadLegacy) {
        await ctx.db.patch(p._id, { category: undefined });
        unclassified++;
      }
    }
    return { seeded: seeded.created.length, removed, movedToNoImpa, unclassified };
  },
});
