import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { KNOWN_CURRENCIES } from "./lib/currencyCodes";
import { companyIdOf, requireAdmin, requireOwned, requireUser } from "./lib/permissions";

const CODE_PATTERN = /^[A-Z]{3}$/;

/** Devises de l'entreprise de l'utilisateur. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("currencies")
      .withIndex("by_company_and_code", (q) => q.eq("companyId", companyIdOf(user)))
      .collect();
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  },
});

export const create = mutation({
  args: { code: v.string(), name: v.string() },
  handler: async (ctx, { code, name }) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);
    const normalized = code.trim().toUpperCase();
    if (!CODE_PATTERN.test(normalized)) throw new Error("Le code doit comporter 3 lettres (ex. XAF, EUR).");
    if (!name.trim()) throw new Error("Le nom est requis.");
    const existing = await ctx.db
      .query("currencies")
      .withIndex("by_company_and_code", (q) => q.eq("companyId", companyId).eq("code", normalized))
      .unique();
    if (existing) throw new Error("Cette devise existe déjà.");

    const id = await ctx.db.insert("currencies", { companyId, code: normalized, name: name.trim(), active: true });
    await logActivity(ctx, { userId: admin._id, action: "currency.created", entityType: "currency", entityId: id, metadata: { code: normalized } });
    return id;
  },
});

export const update = mutation({
  args: { currencyId: v.id("currencies"), name: v.optional(v.string()), active: v.optional(v.boolean()) },
  handler: async (ctx, { currencyId, name, active }) => {
    const admin = await requireAdmin(ctx);
    await requireOwned(ctx, admin, "currencies", currencyId, "Devise introuvable.");
    const patch: { name?: string; active?: boolean } = {};
    if (name !== undefined) {
      if (!name.trim()) throw new Error("Le nom est requis.");
      patch.name = name.trim();
    }
    if (active !== undefined) patch.active = active;
    await ctx.db.patch(currencyId, patch);
    await logActivity(ctx, { userId: admin._id, action: "currency.updated", entityType: "currency", entityId: currencyId, metadata: patch });
  },
});

/**
 * Insère toutes les devises ISO 4217 connues (convex/lib/currencyCodes.ts) qui n'existent pas encore pour cette
 * entreprise - idempotent, ne touche jamais une devise déjà présente (ni son nom, ni son statut actif/inactif).
 * L'admin n'a donc plus besoin de créer les devises une par une : il ne fait qu'activer celles utiles
 * ou en ajouter une manquante via "Ajouter une devise".
 */
async function insertMissingKnownCurrencies(ctx: MutationCtx, companyId: Id<"companies">): Promise<string[]> {
  const existingCodes = new Set(
    (await ctx.db.query("currencies").withIndex("by_company_and_code", (q) => q.eq("companyId", companyId)).collect()).map((c) => c.code),
  );
  const created: string[] = [];
  for (const [code, name] of Object.entries(KNOWN_CURRENCIES)) {
    if (existingCodes.has(code)) continue;
    await ctx.db.insert("currencies", { companyId, code, name, active: true });
    created.push(code);
  }
  return created;
}

/** CLI/migration : `npx convex run currencies:seedAllKnown '{"companyId":"..."}'` (aucune authentification requise). */
export const seedAllKnown = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => ({ created: await insertMissingKnownCurrencies(ctx, companyId) }),
});

/** Bouton admin (Admin > Devises) : charge en un clic toutes les devises ISO manquantes. */
export const seedAllKnownFromAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const created = await insertMissingKnownCurrencies(ctx, companyIdOf(admin));
    if (created.length > 0) {
      await logActivity(ctx, { userId: admin._id, action: "currency.bulk_seeded", entityType: "currency", metadata: { created } });
    }
    return { created };
  },
});

// Devises réellement utilisées par l'entreprise d'origine (ship-chandler basé à Douala, clients internationaux) -
// les seules à proposer par défaut dans les sélecteurs. Les autres devises ISO restent en base
// (désactivées, jamais supprimées) au cas où un prix existant y ferait encore référence.
const CORE_CURRENCIES = ["CAD", "USD", "EUR", "GBP", "XAF", "XOF"];

/** CLI/migration ponctuelle : ne laisse actives que les devises listées dans CORE_CURRENCIES pour une entreprise. */
export const restrictToCoreCurrencies = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const rows = await ctx.db.query("currencies").withIndex("by_company_and_code", (q) => q.eq("companyId", companyId)).collect();
    let deactivated = 0;
    for (const row of rows) {
      const shouldBeActive = CORE_CURRENCIES.includes(row.code);
      if (row.active !== shouldBeActive) {
        await ctx.db.patch(row._id, { active: shouldBeActive });
        if (!shouldBeActive) deactivated++;
      }
    }
    return { deactivated, kept: CORE_CURRENCIES };
  },
});

// Codes retirés d'ISO 4217 depuis le premier chargement du 2026-09-30 (voir convex/lib/currencyCodes.ts) :
// on les désactive plutôt que de les supprimer, au cas où un pays ou une commande y ferait encore référence.
const RETIRED_CODES: Record<string, string | null> = { ANG: "XCG", BGN: "EUR", ZWL: "ZWG" };

/** CLI/migration ponctuelle : désactive les codes ISO retirés déjà chargés, et garantit que leur remplaçant existe. */
export const retireOutdatedCodes = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const deactivated: string[] = [];
    const byCode = (code: string) =>
      ctx.db.query("currencies").withIndex("by_company_and_code", (q) => q.eq("companyId", companyId).eq("code", code)).unique();
    for (const [oldCode, replacement] of Object.entries(RETIRED_CODES)) {
      const row = await byCode(oldCode);
      if (row && row.active) {
        await ctx.db.patch(row._id, { active: false });
        deactivated.push(oldCode);
      }
      if (replacement) {
        const existing = await byCode(replacement);
        if (!existing) await ctx.db.insert("currencies", { companyId, code: replacement, name: KNOWN_CURRENCIES[replacement] ?? replacement, active: true });
      }
    }
    return { deactivated };
  },
});
