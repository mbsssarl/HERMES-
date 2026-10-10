import { createAccount, getAuthUserId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, type MutationCtx, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { requireAdmin, requireUser } from "./lib/permissions";
import { generateTempPassword } from "./lib/tokens";


/**
 * @convex-dev/auth types `createAccount`/`modifyAccountCredentials` as
 * requiring a full ActionCtx (they can run from actions, e.g. OAuth flows
 * that need `runAction`). Our usage only ever needs `ctx.db`, which a
 * MutationCtx already provides - confirmed working at runtime - so this
 * narrow cast avoids forcing these mutations into actions just to satisfy
 * a broader type signature than what's actually exercised here.
 */
function asAuthCtx(ctx: MutationCtx): Parameters<typeof createAccount>[0] {
  return ctx as unknown as Parameters<typeof createAccount>[0];
}

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) return null;
    const user = await ctx.db.get(authUserId);
    if (!user || user.status !== "active") return null;
    return user;
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("users").order("desc").collect();
  },
});

const DEFAULT_ADMIN_EMAIL = "admin@hermes.local";
const DEFAULT_ADMIN_PASSWORD = "Hermes-Admin-2026!";

/**
 * One-time bootstrap: creates the very first admin account with fixed
 * credentials, bypassing the Brevo welcome email. Only runs while the users
 * table is empty, so it cannot be used once real accounts exist - run it
 * once, log in, change the password, then rely on `createUser` normally.
 */
export const bootstrapFirstAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const anyUser = await ctx.db.query("users").first();
    if (anyUser) {
      throw new Error("Des utilisateurs existent déjà - le bootstrap ne peut être utilisé qu'une seule fois.");
    }

    const { user } = await createAccount(asAuthCtx(ctx), {
      provider: "password",
      account: { id: DEFAULT_ADMIN_EMAIL, secret: DEFAULT_ADMIN_PASSWORD },
      profile: {
        email: DEFAULT_ADMIN_EMAIL,
        role: "admin",
        status: "active",
        mustChangePassword: true,
        createdAt: Date.now(),
      },
    });

    await logActivity(ctx, {
      userId: user._id,
      action: "user.bootstrapped",
      entityType: "user",
      entityId: user._id,
      metadata: { email: DEFAULT_ADMIN_EMAIL },
    });

    return { email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD };
  },
});

/** Admin creates a user account from an email only; a temp password is generated and emailed. */
export const createUser = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const admin = await requireAdmin(ctx);
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalizedEmail))
      .unique();
    if (existing) throw new Error("Un utilisateur avec cet email existe déjà.");

    const tempPassword = generateTempPassword();

    const { user } = await createAccount(asAuthCtx(ctx), {
      provider: "password",
      account: { id: normalizedEmail, secret: tempPassword },
      profile: {
        email: normalizedEmail,
        role: "user",
        status: "active",
        mustChangePassword: true,
        createdAt: Date.now(),
        createdBy: admin._id,
      },
    });

    await logActivity(ctx, {
      userId: admin._id,
      action: "user.created",
      entityType: "user",
      entityId: user._id,
      metadata: { email: normalizedEmail },
    });

    await ctx.scheduler.runAfter(0, internal.emails.sendWelcomeEmail, {
      userId: user._id,
      email: normalizedEmail,
      tempPassword,
    });

    // Returned once so the admin can hand it over when the welcome email cannot be sent (Brevo not configured).
    return { userId: user._id, tempPassword };
  },
});

export const toggleUserStatus = mutation({
  args: { userId: v.id("users"), status: v.union(v.literal("active"), v.literal("disabled")) },
  handler: async (ctx, { userId, status }) => {
    const admin = await requireAdmin(ctx);
    if (userId === admin._id && status === "disabled") {
      throw new Error("Vous ne pouvez pas désactiver votre propre compte.");
    }

    await ctx.db.patch(userId, {
      status,
      disabledAt: status === "disabled" ? Date.now() : undefined,
      disabledBy: status === "disabled" ? admin._id : undefined,
    });

    await logActivity(ctx, {
      userId: admin._id,
      action: status === "disabled" ? "user.disabled" : "user.reactivated",
      entityType: "user",
      entityId: userId,
    });
  },
});

/** Called right after a successful sign-in, from the client, to stamp lastLoginAt. */
export const recordLogin = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { lastLoginAt: Date.now() });
    await logActivity(ctx, {
      userId: user._id,
      action: "user.login",
      entityType: "user",
      entityId: user._id,
    });
  },
});

export const setNewPassword = mutation({
  args: { newPassword: v.string() },
  handler: async (ctx, { newPassword }) => {
    const user = await requireUser(ctx);
    if (newPassword.length < 8) {
      throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
    }
    if (!user.email) throw new Error("Compte sans email associé.");

    // Distingue, pour le journal, le cas où ce compte n'avait encore aucun mot de passe (connexion par
    // email seul puis première définition) du changement ordinaire d'un mot de passe existant.
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", user.email!))
      .unique();
    const hadNoPassword = account !== null && !account.secret;

    await modifyAccountCredentials(asAuthCtx(ctx), {
      provider: "password",
      account: { id: user.email, secret: newPassword },
    });
    await ctx.db.patch(user._id, { mustChangePassword: false });

    await logActivity(ctx, {
      userId: user._id,
      action: hadNoPassword ? "user.password_first_set" : "user.password_changed",
      entityType: "user",
      entityId: user._id,
    });
  },
});

/** Public: requests a password-reset email. Always succeeds silently (no user enumeration). */
/**
 * Admin resets a user's password: a one-time temporary password is generated, returned to the admin (to copy
 * or hand over) and emailed to the user when email sending is configured. The user's current sessions are
 * closed, and the account is flagged so the next sign-in forces a new personal password.
 */
export const adminResetPassword = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const admin = await requireAdmin(ctx);
    if (userId === admin._id) {
      throw new Error("Pour votre propre compte, utilisez la page Réglages.");
    }
    const user = await ctx.db.get(userId);
    if (!user || !user.email) throw new Error("Utilisateur introuvable.");

    const tempPassword = generateTempPassword();
    await modifyAccountCredentials(asAuthCtx(ctx), {
      provider: "password",
      account: { id: user.email, secret: tempPassword },
    });
    await ctx.db.patch(userId, { mustChangePassword: true });
    await invalidateSessions(asAuthCtx(ctx), { userId });

    await logActivity(ctx, {
      userId: admin._id,
      action: "user.password_reset_by_admin",
      entityType: "user",
      entityId: userId,
      metadata: { email: user.email },
    });

    const emailConfigured = Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);
    if (emailConfigured) {
      await ctx.scheduler.runAfter(0, internal.emails.sendTempPasswordEmail, { email: user.email, tempPassword });
    }
    return { email: user.email, tempPassword, emailSent: emailConfigured };
  },
});

/** Settings page: changes the signed-in user's password after checking the current one. */
export const changeMyPassword = mutation({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }) => {
    const user = await requireUser(ctx);
    if (!user.email) throw new Error("Compte sans email associé.");
    if (newPassword.length < 8) {
      throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
    }
    if (newPassword === currentPassword) {
      throw new Error("Le nouveau mot de passe doit être différent de l'actuel.");
    }

    try {
      await retrieveAccount(asAuthCtx(ctx), {
        provider: "password",
        account: { id: user.email, secret: currentPassword },
      });
    } catch {
      throw new Error("Mot de passe actuel incorrect.");
    }

    await modifyAccountCredentials(asAuthCtx(ctx), {
      provider: "password",
      account: { id: user.email, secret: newPassword },
    });
    await ctx.db.patch(user._id, { mustChangePassword: false });
    await logActivity(ctx, { userId: user._id, action: "user.password_changed", entityType: "user", entityId: user._id });
  },
});

/** Stores the interface language on the account so it follows the user across devices. */
export const setLanguage = mutation({
  args: { language: v.union(v.literal("fr"), v.literal("en")) },
  handler: async (ctx, { language }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { language });
  },
});

/** Stores the interface theme on the account so it follows the user across devices. */
export const setTheme = mutation({
  args: { theme: v.union(v.literal("light"), v.literal("dark")) },
  handler: async (ctx, { theme }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { theme });
  },
});
