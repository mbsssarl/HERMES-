import { createAccount, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx, query } from "./_generated/server";
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

/**
 * Les actions lourdes (renouveler un abonnement, supprimer une entreprise) demandent de ressaisir le mot de passe du
 * super admin : une session laissée ouverte ne suffit pas.
 */
async function confirmRootPassword(ctx: MutationCtx, root: Doc<"users">, password: string): Promise<void> {
  if (!root.email) throw new Error("Compte sans email associé.");
  try {
    await retrieveAccount(asAuthCtx(ctx), { provider: "password", account: { id: root.email, secret: password } });
  } catch {
    throw new Error("Mot de passe incorrect.");
  }
}

const CODE_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const MAX_NAME = 80;
const ORDER_COUNT_CAP = 5000;
/** Un mois d'abonnement = 30 jours ; un renouvellement porte sur 1 à 36 mois. */
const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MONTHS = 36;

/** Planifie la suspension automatique à l'échéance exacte (ignorée si l'abonnement a été renouvelé entre-temps). */
async function scheduleExpiry(ctx: MutationCtx, companyId: Id<"companies">, endsAt: number): Promise<void> {
  await ctx.scheduler.runAt(endsAt, internal.platform.expireCompany, { companyId, endsAt });
}

/** Suspend l'entreprise parce que son abonnement est échu ; sans effet si elle est déjà suspendue. */
async function suspendForExpiry(ctx: MutationCtx, company: Doc<"companies">): Promise<void> {
  if (company.status !== "active") return;
  await ctx.db.patch(company._id, { status: "suspended", suspendKind: "subscription", suspendedAt: Date.now(), suspendedBy: undefined, suspendReason: undefined });
  await logActivity(ctx, { userId: null, action: "company.subscription_expired", entityType: "company", entityId: company._id, metadata: { name: company.name, endedAt: company.subscriptionEndsAt ?? null } });
}

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
          suspendKind: company.suspendKind ?? null,
          subscriptionEndsAt: company.subscriptionEndsAt ?? null,
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
    const subscriptionEndsAt = Date.now() + SUBSCRIPTION_MS;
    const companyId = await ctx.db.insert("companies", {
      name: cleanName,
      code: cleanCode,
      status: "active",
      subscriptionEndsAt,
      createdAt: Date.now(),
      createdBy: root._id,
    });
    await scheduleExpiry(ctx, companyId, subscriptionEndsAt);

    // Référentiels de départ copiés de la première entreprise (le super admin n'y lit rien d'autre que des listes).
    if (template) {
      for (const c of await ctx.db.query("currencies").withIndex("by_company_and_code", (q) => q.eq("companyId", template._id)).take(500)) {
        await ctx.db.insert("currencies", { companyId, code: c.code, name: c.name, active: c.active });
      }
      for (const c of await ctx.db.query("countries").withIndex("by_company_and_code", (q) => q.eq("companyId", template._id)).take(500)) {
        await ctx.db.insert("countries", { companyId, code: c.code, name: c.name, city: c.city, active: c.active });
      }
      for (const c of await ctx.db.query("productCategories").withIndex("by_company_and_name", (q) => q.eq("companyId", template._id)).take(500)) {
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
    return { companyId, adminEmail, tempPassword, adminUserId: user._id, subscriptionEndsAt };
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
  args: { companyId: v.id("companies"), status: v.union(v.literal("active"), v.literal("suspended")), reason: v.optional(v.string()), password: v.string() },
  handler: async (ctx, { companyId, status, reason, password }) => {
    const root = await requireSuperadmin(ctx);
    await confirmRootPassword(ctx, root, password);
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    if (company.suspendKind === "deleting") throw new Error("Cette entreprise est en cours de suppression.");
    const cleanReason = reason?.trim().slice(0, 300) || undefined;
    // Le motif est montré aux personnes qui tentent de se connecter : obligatoire pour une suspension.
    if (status === "suspended" && (!cleanReason || cleanReason.length < 3)) {
      throw new Error("Indiquez le motif de la suspension : il sera communiqué aux utilisateurs de l'entreprise.");
    }
    if (status === "active" && company.subscriptionEndsAt !== undefined && company.subscriptionEndsAt <= Date.now()) {
      throw new Error("L'abonnement de cette entreprise est expiré : renouvelez-le pour la réactiver.");
    }
    await ctx.db.patch(companyId, {
      status,
      suspendKind: status === "suspended" ? "manual" : undefined,
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

/**
 * Renouvelle l'abonnement du nombre de mois demandé (30 jours chacun) : à partir de l'échéance actuelle si elle n'est pas dépassée (aucun jour
 * perdu en cas de renouvellement anticipé), sinon à partir d'aujourd'hui. Lève la suspension si c'est
 * l'abonnement qui l'avait causée ; une suspension décidée par le super admin reste en place.
 */
export const renewSubscription = mutation({
  args: { companyId: v.id("companies"), months: v.number(), password: v.string() },
  handler: async (ctx, { companyId, months, password }) => {
    const root = await requireSuperadmin(ctx);
    if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) throw new Error(`Nombre de mois invalide (1 à ${MAX_MONTHS}).`);
    await confirmRootPassword(ctx, root, password);
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    if (company.suspendKind === "deleting") throw new Error("Cette entreprise est en cours de suppression.");
    const now = Date.now();
    const base = company.subscriptionEndsAt !== undefined && company.subscriptionEndsAt > now ? company.subscriptionEndsAt : now;
    const subscriptionEndsAt = base + months * SUBSCRIPTION_MS;
    const reactivate = company.status === "suspended" && company.suspendKind === "subscription";
    await ctx.db.patch(companyId, {
      subscriptionEndsAt,
      ...(reactivate ? { status: "active" as const, suspendKind: undefined, suspendedAt: undefined, suspendedBy: undefined, suspendReason: undefined } : {}),
    });
    await scheduleExpiry(ctx, companyId, subscriptionEndsAt);
    await logActivity(ctx, { userId: root._id, action: "company.subscription_renewed", entityType: "company", entityId: companyId, metadata: { name: company.name, months, endsAt: subscriptionEndsAt, reactivated: reactivate } });
    return { subscriptionEndsAt, reactivated: reactivate };
  },
});

/**
 * Résilie l'abonnement : il prend fin immédiatement et l'accès est coupé pour tous les comptes de l'entreprise (même
 * écran « Abonnement expiré » que pour une échéance atteinte). Aucune donnée n'est supprimée ; un renouvellement
 * rétablit tout. Confirmée par le mot de passe du super admin.
 */
export const terminateSubscription = mutation({
  args: { companyId: v.id("companies"), password: v.string() },
  handler: async (ctx, { companyId, password }) => {
    const root = await requireSuperadmin(ctx);
    await confirmRootPassword(ctx, root, password);
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    if (company.suspendKind === "deleting") throw new Error("Cette entreprise est en cours de suppression.");
    if (company.subscriptionEndsAt === undefined) throw new Error("Cette entreprise n'a pas d'abonnement à résilier.");
    const now = Date.now();
    await ctx.db.patch(companyId, {
      subscriptionEndsAt: now,
      status: "suspended",
      suspendKind: "subscription",
      suspendedAt: now,
      suspendedBy: root._id,
      suspendReason: undefined,
    });
    await logActivity(ctx, { userId: root._id, action: "company.subscription_terminated", entityType: "company", entityId: companyId, metadata: { name: company.name } });
    return { name: company.name };
  },
});

/** Exécutée à l'échéance exacte (planifiée) : suspend l'entreprise sauf si l'abonnement a été renouvelé depuis. */
export const expireCompany = internalMutation({
  args: { companyId: v.id("companies"), endsAt: v.number() },
  handler: async (ctx, { companyId, endsAt }) => {
    const company = await ctx.db.get(companyId);
    if (!company || company.subscriptionEndsAt !== endsAt) return null;
    await suspendForExpiry(ctx, company);
    return null;
  },
});

/** Filet de sécurité (tâche horaire) : suspend toute entreprise active dont l'échéance est dépassée. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const company of await ctx.db.query("companies").take(500)) {
      if (company.status === "active" && company.subscriptionEndsAt !== undefined && company.subscriptionEndsAt <= now) {
        await suspendForExpiry(ctx, company);
      }
    }
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------------------
// SUPPRESSION D'UNE ENTREPRISE
// Irréversible : toutes ses données sont effacées (comptes et connexions, clients, catalogue, prix, quotations avec
// leurs fichiers, journal, réglages). Confirmée par le mot de passe du super admin. Le travail se fait en tâche de
// fond, par lots (un catalogue peut compter des dizaines de milliers de produits) ; pendant ce temps l'entreprise
// est bloquée et marquée « en cours de suppression ».
// ---------------------------------------------------------------------------------------------------------------

export const deleteCompany = mutation({
  args: { companyId: v.id("companies"), password: v.string() },
  handler: async (ctx, { companyId, password }) => {
    const root = await requireSuperadmin(ctx);
    await confirmRootPassword(ctx, root, password);
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    if (company.suspendKind === "deleting") throw new Error("La suppression de cette entreprise est déjà en cours.");

    await ctx.db.patch(companyId, {
      status: "suspended",
      suspendKind: "deleting",
      suspendedAt: Date.now(),
      suspendedBy: root._id,
      suspendReason: "Cette entreprise est en cours de suppression.",
    });
    await logActivity(ctx, { userId: root._id, action: "company.deletion_started", entityType: "company", entityId: companyId, metadata: { name: company.name, code: company.code } });
    await ctx.scheduler.runAfter(0, internal.platform.purgeCompanyStep, { companyId, phase: 0 });
    return { name: company.name };
  },
});

const PURGE_PHASES = ["orders", "orphanItems", "prices", "aliases", "products", "backups", "categories", "currencies", "countries", "clients", "settings", "logs", "users", "finish"] as const;
type PurgePhase = (typeof PURGE_PHASES)[number];

/** Supprime un fichier du stockage sans échouer s'il n'existe plus. */
async function dropFile(ctx: MutationCtx, storageId: Id<"_storage"> | undefined): Promise<void> {
  if (storageId) await ctx.storage.delete(storageId).catch(() => {});
}

/** Exécute un lot de la phase ; renvoie true s'il reste du travail dans cette même phase. */
async function runPurgePhase(ctx: MutationCtx, company: Doc<"companies">, phase: PurgePhase): Promise<boolean> {
  const companyId = company._id;
  switch (phase) {
    case "orders": {
      const orders = await ctx.db.query("orders").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(12);
      for (const order of orders) {
        for (const row of await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect()) await ctx.db.delete(row._id);
        for (const row of await ctx.db.query("orderValidatedItems").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect()) await ctx.db.delete(row._id);
        for (const row of await ctx.db.query("orderItemEdits").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect()) await ctx.db.delete(row._id);
        for (const row of await ctx.db.query("supplierItems").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect()) await ctx.db.delete(row._id);
        for (const row of await ctx.db.query("emailLogs").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect()) await ctx.db.delete(row._id);
        for (const file of await ctx.db.query("uploadedFiles").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect()) {
          await dropFile(ctx, file.storageId);
          await ctx.db.delete(file._id);
        }
        for (const quote of await ctx.db.query("quotations").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect()) {
          await dropFile(ctx, quote.pdfStorageId);
          await ctx.db.delete(quote._id);
        }
        await ctx.db.delete(order._id);
      }
      return orders.length === 12;
    }
    case "orphanItems": {
      const rows = await ctx.db.query("orderItems").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(300);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 300;
    }
    case "prices": {
      const rows = await ctx.db.query("productPrices").withIndex("by_company_and_validTo", (q) => q.eq("companyId", companyId)).take(500);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 500;
    }
    case "aliases": {
      const rows = await ctx.db.query("productAliases").withIndex("by_company_and_normalizedAlias", (q) => q.eq("companyId", companyId)).take(500);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 500;
    }
    case "products": {
      const rows = await ctx.db.query("products").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(300);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 300;
    }
    case "backups": {
      const rows = await ctx.db.query("productBackups").withIndex("by_company_and_deletedAt", (q) => q.eq("companyId", companyId)).take(60);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 60;
    }
    case "categories": {
      const rows = await ctx.db.query("productCategories").withIndex("by_company_and_name", (q) => q.eq("companyId", companyId)).take(400);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 400;
    }
    case "currencies": {
      const rows = await ctx.db.query("currencies").withIndex("by_company_and_code", (q) => q.eq("companyId", companyId)).take(400);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 400;
    }
    case "countries": {
      const rows = await ctx.db.query("countries").withIndex("by_company_and_code", (q) => q.eq("companyId", companyId)).take(400);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 400;
    }
    case "clients": {
      const rows = await ctx.db.query("clients").withIndex("by_company_and_name", (q) => q.eq("companyId", companyId)).take(400);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 400;
    }
    case "settings": {
      const rows = await ctx.db.query("settings").withIndex("by_company_and_key", (q) => q.eq("companyId", companyId)).take(400);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 400;
    }
    case "logs": {
      const rows = await ctx.db.query("activityLogs").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(500);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length === 500;
    }
    case "users": {
      const users = await ctx.db.query("users").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(15);
      for (const user of users) {
        // Connexions : sessions (et leurs jetons), identifiants (et leurs codes), puis vues et jetons de réinitialisation.
        for (const session of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", user._id)).collect()) {
          for (const token of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", session._id)).collect()) await ctx.db.delete(token._id);
          await ctx.db.delete(session._id);
        }
        for (const account of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", user._id)).collect()) {
          for (const code of await ctx.db.query("authVerificationCodes").withIndex("accountId", (q) => q.eq("accountId", account._id)).collect()) await ctx.db.delete(code._id);
          await ctx.db.delete(account._id);
        }
        for (const seen of await ctx.db.query("orderSeen").withIndex("by_user_order", (q) => q.eq("userId", user._id)).collect()) await ctx.db.delete(seen._id);
        for (const reset of await ctx.db.query("passwordResetTokens").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) await ctx.db.delete(reset._id);
        await ctx.db.delete(user._id);
      }
      return users.length === 15;
    }
    case "finish": {
      await dropFile(ctx, company.branding?.logoStorageId);
      await ctx.db.delete(companyId);
      await logActivity(ctx, { userId: null, action: "company.deleted", entityType: "company", entityId: companyId, metadata: { name: company.name, code: company.code } });
      return false;
    }
  }
}

/** Un lot de la suppression, puis se replanifie jusqu'à la fin (voir deleteCompany). */
export const purgeCompanyStep = internalMutation({
  args: { companyId: v.id("companies"), phase: v.number() },
  handler: async (ctx, { companyId, phase }) => {
    const company = await ctx.db.get(companyId);
    if (!company || company.suspendKind !== "deleting") return null;
    const name = PURGE_PHASES[phase];
    if (!name) return null;
    const more = await runPurgePhase(ctx, company, name);
    // Le dernier lot supprime l'entreprise elle-même : plus rien à replanifier.
    if (name !== "finish") await ctx.scheduler.runAfter(0, internal.platform.purgeCompanyStep, { companyId, phase: more ? phase : phase + 1 });
    return null;
  },
});
