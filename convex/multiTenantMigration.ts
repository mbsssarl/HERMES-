import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { generateTempPassword } from "./lib/tokens";

/**
 * Reprise des données pour le multi-entreprises (phase 1). Fonctions INTERNES, à lancer depuis le terminal :
 *   npx convex run multiTenantMigration:start '{"code":"mbss","name":"M.B.S.S Sarl"}'
 *   npx convex run multiTenantMigration:status
 *   npx convex run multiTenantMigration:createRoot
 * Idempotent : peut être relancé sans risque (l'entreprise existe déjà -> réutilisée, seules les lignes sans
 * `companyId` sont complétées).
 */

const TABLES = [
  "users",
  "clients",
  "products",
  "productAliases",
  "productBackups",
  "productPrices",
  "productCategories",
  "currencies",
  "countries",
  "orders",
  "activityLogs",
  "settings",
] as const;
type TenantTable = (typeof TABLES)[number];

const BATCH = 200;
const ROOT_EMAIL = "root@hermes.dev";

/** Même contournement de type que dans users.ts : createAccount n'utilise que ctx.db. */
function asAuthCtx(ctx: MutationCtx): Parameters<typeof createAccount>[0] {
  return ctx as unknown as Parameters<typeof createAccount>[0];
}

/** Crée (ou retrouve) l'entreprise d'origine, reprend son branding, puis lance le remplissage des tables. */
export const start = internalMutation({
  args: { code: v.string(), name: v.string() },
  handler: async (ctx, { code, name }) => {
    const cleanCode = code.trim().toLowerCase();
    let company = await ctx.db.query("companies").withIndex("by_code", (q) => q.eq("code", cleanCode)).unique();

    if (!company) {
      // L'ancien branding global (réglage « branding ») devient celui de l'entreprise, et sert aussi de
      // point de départ à la page de connexion de la plateforme.
      const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "branding")).first();
      const branding = (row?.value ?? undefined) as
        | { name?: string; logoStorageId?: Id<"_storage">; accentColor?: string }
        | undefined;
      const id = await ctx.db.insert("companies", {
        name: name.trim(),
        code: cleanCode,
        status: "active",
        branding: branding ? { name: branding.name, logoStorageId: branding.logoStorageId, accentColor: branding.accentColor } : undefined,
        createdAt: Date.now(),
      });
      company = (await ctx.db.get(id))!;

      const platform = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", "branding")).first();
      if (!platform && branding) {
        await ctx.db.insert("platformSettings", { key: "branding", value: { ...branding }, updatedAt: Date.now() });
      }
    }

    await ctx.scheduler.runAfter(0, internal.multiTenantMigration.backfill, { companyId: company._id, tableIndex: 0, cursor: null });
    return { companyId: company._id, code: company.code };
  },
});

/** Remplit `companyId` par lots (une page de la table à la fois), en se replanifiant jusqu'à la fin. */
export const backfill = internalMutation({
  args: { companyId: v.id("companies"), tableIndex: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { companyId, tableIndex, cursor }) => {
    if (tableIndex >= TABLES.length) {
      await saveProgress(ctx, { done: true });
      return null;
    }
    const table: TenantTable = TABLES[tableIndex];
    const page = await ctx.db.query(table).paginate({ numItems: BATCH, cursor });
    let patched = 0;
    for (const row of page.page) {
      if ((row as { companyId?: Id<"companies"> }).companyId !== undefined) continue;
      // Le super admin n'appartient à aucune entreprise.
      if (table === "users" && (row as { role?: string }).role === "superadmin") continue;
      await ctx.db.patch(row._id as never, { companyId } as never);
      patched++;
    }
    await saveProgress(ctx, { table, patched });
    await ctx.scheduler.runAfter(0, internal.multiTenantMigration.backfill, {
      companyId,
      tableIndex: page.isDone ? tableIndex + 1 : tableIndex,
      cursor: page.isDone ? null : page.continueCursor,
    });
    return null;
  },
});

/** Cumule l'avancement de la reprise dans platformSettings (clé « migration ») pour `status`. */
async function saveProgress(ctx: MutationCtx, step: { done: true } | { table: TenantTable; patched: number }) {
  const row = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", "migration")).first();
  const value = (row?.value ?? { done: false, patched: {} }) as { done: boolean; patched: Record<string, number> };
  if ("done" in step) value.done = true;
  else value.patched[step.table] = (value.patched[step.table] ?? 0) + step.patched;
  if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
  else await ctx.db.insert("platformSettings", { key: "migration", value, updatedAt: Date.now() });
}

/** Avancement de la reprise : lignes complétées par table, et `done: true` quand tout est traité. */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", "migration")).first();
    const companies = await ctx.db.query("companies").take(50);
    return {
      migration: row?.value ?? null,
      companies: companies.map((c) => ({ id: c._id, code: c.code, name: c.name, status: c.status })),
    };
  },
});

/**
 * Crée le compte super admin (sans entreprise). Le mot de passe temporaire est généré ici et renvoyé UNE seule
 * fois : à noter tout de suite, il est à changer à la première connexion.
 */
export const createRoot = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", ROOT_EMAIL)).first();
    if (existing) throw new Error("Le compte " + ROOT_EMAIL + " existe déjà.");
    const password = generateTempPassword();
    const { user } = await createAccount(asAuthCtx(ctx), {
      provider: "password",
      account: { id: ROOT_EMAIL, secret: password },
      profile: {
        email: ROOT_EMAIL,
        role: "superadmin",
        status: "active",
        mustChangePassword: true,
        createdAt: Date.now(),
      },
    });
    return { userId: user._id, email: ROOT_EMAIL, temporaryPassword: password };
  },
});

/** Change l'identifiant (email) d'un compte et son compte de connexion par mot de passe. */
export const renameAccount = internalMutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const oldEmail = from.trim().toLowerCase();
    const newEmail = to.trim().toLowerCase();
    const clash = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", newEmail)).first();
    if (clash) throw new Error("Un utilisateur utilise déjà " + newEmail);
    const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", oldEmail)).first();
    if (!user) throw new Error("Utilisateur introuvable : " + oldEmail);
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", oldEmail))
      .first();
    if (!account) throw new Error("Compte de connexion introuvable : " + oldEmail);
    await ctx.db.patch(user._id, { email: newEmail });
    await ctx.db.patch(account._id, { providerAccountId: newEmail });
    return { email: newEmail };
  },
});
