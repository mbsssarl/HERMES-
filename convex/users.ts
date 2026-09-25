import { createAccount, getAuthUserId, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, type MutationCtx, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { requireAdmin, requireUser } from "./lib/permissions";
import { generateResetToken, generateTempPassword, hashToken } from "./lib/tokens";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

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

    return { userId: user._id };
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

    await modifyAccountCredentials(asAuthCtx(ctx), {
      provider: "password",
      account: { id: user.email, secret: newPassword },
    });
    await ctx.db.patch(user._id, { mustChangePassword: false });

    await logActivity(ctx, {
      userId: user._id,
      action: "user.password_changed",
      entityType: "user",
      entityId: user._id,
    });
  },
});

/** Public: requests a password-reset email. Always succeeds silently (no user enumeration). */
export const requestPasswordReset = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalizedEmail))
      .unique();

    if (user && user.status === "active") {
      const token = generateResetToken();
      const tokenHash = await hashToken(token);
      await ctx.db.insert("passwordResetTokens", {
        userId: user._id,
        tokenHash,
        expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.emails.sendPasswordResetEmail, {
        email: normalizedEmail,
        token,
      });
    }
  },
});

export const resetPasswordWithToken = mutation({
  args: { token: v.string(), newPassword: v.string() },
  handler: async (ctx, { token, newPassword }) => {
    if (newPassword.length < 8) {
      throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
    }
    const tokenHash = await hashToken(token);
    const record = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!record || record.usedAt || record.expiresAt < Date.now()) {
      throw new Error("Lien de réinitialisation invalide ou expiré.");
    }

    const user = await ctx.db.get(record.userId);
    if (!user || !user.email) throw new Error("Utilisateur introuvable.");

    await modifyAccountCredentials(asAuthCtx(ctx), {
      provider: "password",
      account: { id: user.email, secret: newPassword },
    });
    await ctx.db.patch(user._id, { mustChangePassword: false });
    await ctx.db.patch(record._id, { usedAt: Date.now() });

    await logActivity(ctx, {
      userId: user._id,
      action: "user.password_reset",
      entityType: "user",
      entityId: user._id,
    });
  },
});
