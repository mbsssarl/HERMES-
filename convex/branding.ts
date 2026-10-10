import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { requireAdmin } from "./lib/permissions";

const KEY = "branding";
const DEFAULT_NAME = "M.B.S.S Sarl";
const MAX_NAME_LENGTH = 60;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

interface StoredBranding {
  name?: string;
  logoStorageId?: Id<"_storage">;
  /** Couleur principale de l'interface (#rrggbb) ; absente = couleur par défaut. */
  accentColor?: string;
}

/**
 * Identité de l'entreprise affichée dans toute l'application (menu, pages de connexion, titre de l'onglet).
 * Publique : la page de connexion en a besoin avant que l'utilisateur soit identifié, et elle ne contient que
 * le nom et l'adresse du logo. Sans réglage enregistré, les valeurs par défaut s'appliquent.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
    const stored = (row?.value ?? {}) as StoredBranding;
    const logoUrl = stored.logoStorageId ? await ctx.storage.getUrl(stored.logoStorageId) : null;
    return {
      name: stored.name?.trim() || DEFAULT_NAME,
      logoUrl,
      accentColor: stored.accentColor ?? null,
      defaultName: DEFAULT_NAME,
      customName: Boolean(stored.name?.trim()),
      customLogo: logoUrl !== null,
    };
  },
});

/**
 * Enregistre le nom et le logo de l'entreprise. Un nom vide rétablit le nom par défaut ; `removeLogo` rétablit
 * le logo par défaut. Le logo précédent est supprimé du stockage quand il est remplacé ou retiré.
 */
export const set = mutation({
  args: {
    name: v.string(),
    logoStorageId: v.optional(v.id("_storage")),
    removeLogo: v.optional(v.boolean()),
    // absent = inchangée ; null = couleur par défaut ; sinon #rrggbb
    accentColor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { name, logoStorageId, removeLogo, accentColor }) => {
    const admin = await requireAdmin(ctx);

    const cleanName = name.trim();
    if (cleanName.length > MAX_NAME_LENGTH) {
      if (logoStorageId) await ctx.storage.delete(logoStorageId);
      throw new Error(`Nom trop long (${MAX_NAME_LENGTH} caractères maximum).`);
    }

    if (logoStorageId) {
      const meta = await ctx.db.system.get("_storage", logoStorageId);
      const problem = !meta
        ? "Fichier introuvable dans le stockage."
        : !meta.contentType || !LOGO_TYPES.has(meta.contentType)
          ? "Format de logo non autorisé (PNG, JPEG, WebP ou SVG)."
          : meta.size > MAX_LOGO_BYTES
            ? "Logo trop volumineux (2 Mo maximum)."
            : null;
      if (problem) {
        await ctx.storage.delete(logoStorageId);
        throw new Error(problem);
      }
    }

    if (typeof accentColor === "string" && !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      if (logoStorageId) await ctx.storage.delete(logoStorageId);
      throw new Error("Couleur invalide.");
    }

    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
    const previous = (row?.value ?? {}) as StoredBranding;

    const nextLogo = logoStorageId ?? (removeLogo ? undefined : previous.logoStorageId);
    if (previous.logoStorageId && previous.logoStorageId !== nextLogo) {
      await ctx.storage.delete(previous.logoStorageId);
    }

    const nextAccent = accentColor === undefined ? previous.accentColor : (accentColor?.toLowerCase() ?? undefined);
    const value: StoredBranding = { name: cleanName || undefined, logoStorageId: nextLogo, accentColor: nextAccent };
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now(), updatedBy: admin._id });
    else await ctx.db.insert("settings", { key: KEY, value, updatedAt: Date.now(), updatedBy: admin._id });

    await logActivity(ctx, {
      userId: admin._id,
      action: "branding.updated",
      entityType: "settings",
      entityId: KEY,
      metadata: { name: cleanName || null, logoChanged: Boolean(logoStorageId), logoRemoved: Boolean(removeLogo), accentColor: accentColor === undefined ? "unchanged" : accentColor },
    });
  },
});
