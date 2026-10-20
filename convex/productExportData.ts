import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Données de l'export Excel du catalogue (voir productExport.ts). Fonctions INTERNES, appelées par l'action avec
 * l'entreprise de l'administrateur connecté : le catalogue d'une autre entreprise n'est jamais lu. Le catalogue
 * dépassant la taille d'un résultat de requête, tout est lu page par page.
 */

/** Une page de produits (hors produits supprimés), réduits aux colonnes exportées. */
export const productsPage = internalQuery({
  args: { companyId: v.id("companies"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { companyId, paginationOpts }) => {
    const page = await ctx.db
      .query("products")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page
        .filter((p) => p.deletedAt === undefined)
        .map((p) => ({
          id: p._id,
          code: p.impaId ?? p.code ?? "",
          name: p.name,
          description: p.description ?? "",
          unit: p.unit,
          category: p.category ?? "",
        })),
    };
  },
});

/** Une page de prix EN VIGUEUR (l'historique des prix remplacés n'est pas exporté). */
export const currentPricesPage = internalQuery({
  args: { companyId: v.id("companies"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { companyId, paginationOpts }) => {
    const page = await ctx.db
      .query("productPrices")
      .withIndex("by_company_and_validTo", (q) => q.eq("companyId", companyId).eq("validTo", undefined))
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((r) => ({ productId: r.productId, countryId: r.countryId, price: r.price, currency: r.currency })),
    };
  },
});

/** Régions de l'entreprise (colonnes de prix du fichier). */
export const countriesOf = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const rows = await ctx.db.query("countries").withIndex("by_company_and_code", (q) => q.eq("companyId", companyId)).collect();
    return rows.map((c) => ({ id: c._id, code: c.code, name: c.name }));
  },
});

/** Supprime le fichier temporaire de l'export (planifié après la génération). */
export const deleteTempFile = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    await ctx.storage.delete(storageId).catch(() => {});
    return null;
  },
});
