import { createAccount, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, type MutationCtx, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { requireSuperadmin } from "./lib/permissions";
import { generateTempPassword } from "./lib/tokens";

/**
 * Console du super administrateur : création, renommage et suspension des entreprises. Toutes les fonctions
 * exigent le rôle « superadmin » ; il ne voit jamais les données métier d'une entreprise (devis, prix, clients),
 * seulement des compteurs.
 */

/** Même contournement de type que dans users.ts : createAccount n'utilise que ctx.db. */
function asAuthCtx(ctx: MutationCtx): Parameters<typeof createAccount>[0] {
  return ctx as unknown as Parameters<typeof createAccount>[0];
}

const CODE_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const MAX_NAME = 80;
const ORDER_COUNT_CAP = 5000;

/** Les entreprises avec leurs compteurs (comptes, commandes, dernière connexion). */
export const listCompanies = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const companies = await ctx.db.query("companies").order("asc").take(200);
    return await Promise.all(
      companies.map(async (company) => {
        const users = await ctx.db.query("users").withIndex("by_company", (q) => q.eq("companyId", company._id)).take(1000);
        const orders = await ctx.db.query("orders").withIndex("by_company", (q) => q.eq("companyId", company._id)).take(ORDER_COUNT_CAP);
        const admin = users.filter((u) => u.role === "admin").sort((a, b) => a.createdAt - b.createdAt)[0];
        return {
          id: company._id,
          name: company.name,
          code: company.code,
          status: company.status,
          createdAt: company.createdAt,
          suspendedAt: company.suspendedAt ?? null,
          suspendReason: company.suspendReason ?? null,
          adminEmail: admin?.email ?? null,
          users: users.length,
          activeUsers: users.filter((u) => u.status === "active").length,
          orders: orders.length,
          ordersCapped: orders.length >= ORDER_COUNT_CAP,
          lastLoginAt: users.reduce<number | null>((max, u) => (u.lastLoginAt && (max === null || u.lastLoginAt > max) ? u.lastLoginAt : max), null),
        };
      }),
    );
  },
});

/**
 * Crée une entreprise et son compte administrateur admin@<code>.dev (mot de passe temporaire renvoyé UNE seule
 * fois : à transmettre à l'administrateur, qui devra le changer à sa première connexion). Les devises, pays et
 * catégories de la première entreprise servent de point de départ ; le catalogue produits, lui, commence vide.
 */
export const createCompany = mutation({
  args: { name: v.string(), code: v.string() },
  handler: async (ctx, { name, code }) => {
    const root = await requireSuperadmin(ctx);
    const cleanName = name.trim();
    const cleanCode = code.trim().toLowerCase();
    if (!cleanName || cleanName.length > MAX_NAME) throw new Error(`Nom obligatoire (${MAX_NAME} caractères maximum).`);
    if (!CODE_RE.test(cleanCode)) throw new Error("Code invalide : 2 à 30 caractères, minuscules, chiffres et tirets.");
    if (await ctx.db.query("companies").withIndex("by_code", (q) => q.eq("code", cleanCode)).first()) {
      throw new Error("Ce code est déjà utilisé par une autre entreprise.");
    }
    const adminEmail = `admin@${cleanCode}.dev`;
    if (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", adminEmail)).first()) {
      throw new Error(`Le compte ${adminEmail} existe déjà.`);
    }

    const template = await ctx.db.query("companies").order("asc").first();
    const companyId = await ctx.db.insert("companies", {
      name: cleanName,
      code: cleanCode,
      status: "active",
      createdAt: Date.now(),
      createdBy: root._id,
    });

    // Référentiels de départ copiés de la première entreprise (le super admin n'y lit rien d'autre que des listes).
    if (template) {
      for (const c of await ctx.db.query("currencies").withIndex("by_company", (q) => q.eq("companyId", template._id)).take(500)) {
        await ctx.db.insert("currencies", { companyId, code: c.code, name: c.name, active: c.active });
      }
      for (const c of await ctx.db.query("countries").withIndex("by_company", (q) => q.eq("companyId", template._id)).take(500)) {
        await ctx.db.insert("countries", { companyId, code: c.code, name: c.name, city: c.city, active: c.active });
      }
      for (const c of await ctx.db.query("productCategories").withIndex("by_company", (q) => q.eq("companyId", template._id)).take(500)) {
        await ctx.db.insert("productCategories", { companyId, name: c.name, active: c.active });
      }
    }

    const tempPassword = generateTempPassword();
    const { user } = await createAccount(asAuthCtx(ctx), {
      provider: "password",
      account: { id: adminEmail, secret: tempPassword },
      profile: {
        email: adminEmail,
        role: "admin",
        status: "active",
        mustChangePassword: true,
        createdAt: Date.now(),
        createdBy: root._id,
        companyId,
      },
    });

    await logActivity(ctx, { userId: root._id, action: "company.created", entityType: "company", entityId: companyId, metadata: { name: cleanName, code: cleanCode } });
    return { companyId, adminEmail, tempPassword, adminUserId: user._id };
  },
});

/** Change le nom officiel d'une entreprise. */
export const renameCompany = mutation({
  args: { companyId: v.id("companies"), name: v.string() },
  handler: async (ctx, { companyId, name }) => {
    const root = await requireSuperadmin(ctx);
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > MAX_NAME) throw new Error(`Nom obligatoire (${MAX_NAME} caractères maximum).`);
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    await ctx.db.patch(companyId, { name: cleanName });
    await logActivity(ctx, { userId: root._id, action: "company.renamed", entityType: "company", entityId: companyId, metadata: { from: company.name, to: cleanName } });
  },
});

/**
 * Suspend ou réactive une entreprise. Une entreprise suspendue est refusée par toutes les fonctions (voir
 * lib/permissions.ts) : les utilisateurs connectés sont renvoyés à l'écran « Entreprise suspendue » aussitôt.
 * Aucune donnée n'est supprimée.
 */
export const setCompanyStatus = mutation({
  args: { companyId: v.id("companies"), status: v.union(v.literal("active"), v.literal("suspended")), reason: v.optional(v.string()) },
  handler: async (ctx, { companyId, status, reason }) => {
    const root = await requireSuperadmin(ctx);
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    const cleanReason = reason?.trim().slice(0, 300) || undefined;
    await ctx.db.patch(companyId, {
      status,
      suspendedAt: status === "suspended" ? Date.now() : undefined,
      suspendedBy: status === "suspended" ? root._id : undefined,
      suspendReason: status === "suspended" ? cleanReason : undefined,
    });
    await logActivity(ctx, {
      userId: root._id,
      action: status === "suspended" ? "company.suspended" : "company.reactivated",
      entityType: "company",
      entityId: companyId,
      metadata: { name: company.name, reason: cleanReason ?? null },
    });
  },
});

/**
 * Réinitialise le mot de passe de l'administrateur d'une entreprise (les adresses @code.dev ne reçoivent pas
 * d'email) : nouveau mot de passe temporaire renvoyé UNE seule fois, sessions de ce compte fermées.
 */
export const resetCompanyAdminPassword = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const root = await requireSuperadmin(ctx);
    const users = await ctx.db.query("users").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(1000);
    const admin: Doc<"users"> | undefined = users.filter((u) => u.role === "admin" && u.email).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!admin || !admin.email) throw new Error("Cette entreprise n'a pas d'administrateur.");

    const tempPassword = generateTempPassword();
    await modifyAccountCredentials(asAuthCtx(ctx), { provider: "password", account: { id: admin.email, secret: tempPassword } });
    await ctx.db.patch(admin._id, { mustChangePassword: true });
    await invalidateSessions(asAuthCtx(ctx), { userId: admin._id });
    await logActivity(ctx, { userId: root._id, action: "company.admin_password_reset", entityType: "company", entityId: companyId, metadata: { email: admin.email } });
    return { email: admin.email, tempPassword };
  },
});
