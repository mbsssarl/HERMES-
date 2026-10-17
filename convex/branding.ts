import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { companyIdOf, getAnyUser, requireAdmin, requireSuperadmin } from "./lib/permissions";

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
 * Identité affichée dans l'application (menu, page de connexion, titre de l'onglet). Publique : la page de
 * connexion en a besoin avant que l'utilisateur soit identifié, et elle ne contient que le nom, l'adresse du logo
 * et la couleur.
 *  - non connecté, ou super admin : identité de la PLATEFORME (réglée par le super admin) ;
 *  - utilisateur d'une entreprise : identité de SON entreprise (réglée par son admin), à défaut le nom de l'entreprise.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAnyUser(ctx);
    const company = user?.companyId ? await ctx.db.get(user.companyId) : null;

    let stored: StoredBranding;
    let defaultName = DEFAULT_NAME;
    if (company) {
      stored = company.branding ?? {};
      defaultName = company.name;
    } else {
      const row = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
      stored = (row?.value ?? {}) as StoredBranding;
    }

    const logoUrl = stored.logoStorageId ? await ctx.storage.getUrl(stored.logoStorageId) : null;
    return {
      name: stored.name?.trim() || defaultName,
      logoUrl,
      accentColor: stored.accentColor ?? null,
      defaultName,
      customName: Boolean(stored.name?.trim()),
      customLogo: logoUrl !== null,
    };
  },
});

interface BrandingInput {
  name: string;
  logoStorageId?: Id<"_storage">;
  removeLogo?: boolean;
  accentColor?: string | null;
}

/** Contrôle le nom, le logo envoyé et la couleur ; supprime le logo envoyé s'il est refusé. */
async function validateBranding(ctx: MutationCtx, { name, logoStorageId, accentColor }: BrandingInput): Promise<string> {
  const reject = async (message: string): Promise<never> => {
    if (logoStorageId) await ctx.storage.delete(logoStorageId);
    throw new Error(message);
  };

  const cleanName = name.trim();
  if (cleanName.length > MAX_NAME_LENGTH) return reject(`Nom trop long (${MAX_NAME_LENGTH} caractères maximum).`);

  if (logoStorageId) {
    const meta = await ctx.db.system.get("_storage", logoStorageId);
    const problem = !meta
      ? "Fichier introuvable dans le stockage."
      : !meta.contentType || !LOGO_TYPES.has(meta.contentType)
        ? "Format de logo non autorisé (PNG, JPEG, WebP ou SVG)."
        : meta.size > MAX_LOGO_BYTES
          ? "Logo trop volumineux (2 Mo maximum)."
          : null;
    if (problem) return reject(problem);
  }

  if (typeof accentColor === "string" && !/^#[0-9a-fA-F]{6}$/.test(accentColor)) return reject("Couleur invalide.");
  return cleanName;
}

/** Nouvelle identité à partir de l'ancienne et de la saisie ; supprime du stockage le logo remplacé ou retiré. */
async function nextBranding(ctx: MutationCtx, previous: StoredBranding, input: BrandingInput, cleanName: string): Promise<StoredBranding> {
  const nextLogo = input.logoStorageId ?? (input.removeLogo ? undefined : previous.logoStorageId);
  if (previous.logoStorageId && previous.logoStorageId !== nextLogo) {
    await ctx.storage.delete(previous.logoStorageId);
  }
  const nextAccent = input.accentColor === undefined ? previous.accentColor : (input.accentColor?.toLowerCase() ?? undefined);
  return { name: cleanName || undefined, logoStorageId: nextLogo, accentColor: nextAccent };
}

const brandingArgs = {
  name: v.string(),
  logoStorageId: v.optional(v.id("_storage")),
  removeLogo: v.optional(v.boolean()),
  // absent = inchangée ; null = couleur par défaut ; sinon #rrggbb
  accentColor: v.optional(v.union(v.string(), v.null())),
};

const auditMetadata = (cleanName: string, { logoStorageId, removeLogo, accentColor }: BrandingInput) => ({
  name: cleanName || null,
  logoChanged: Boolean(logoStorageId),
  logoRemoved: Boolean(removeLogo),
  accentColor: accentColor === undefined ? "unchanged" : accentColor,
});

/**
 * Admin d'entreprise : enregistre le nom, le logo et la couleur de SON entreprise. Un nom vide rétablit le nom de
 * l'entreprise ; `removeLogo` rétablit le logo par défaut.
 */
export const set = mutation({
  args: brandingArgs,
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const company = (await ctx.db.get(companyIdOf(admin))) as Doc<"companies">;
    const cleanName = await validateBranding(ctx, args);
    const branding = await nextBranding(ctx, company.branding ?? {}, args, cleanName);
    await ctx.db.patch(company._id, { branding });
    await logActivity(ctx, {
      userId: admin._id,
      action: "branding.updated",
      entityType: "company",
      entityId: company._id,
      metadata: auditMetadata(cleanName, args),
    });
  },
});

/** Super admin : identité de la plateforme (page de connexion, vue par toutes les entreprises). */
export const setPlatform = mutation({
  args: brandingArgs,
  handler: async (ctx, args) => {
    const root = await requireSuperadmin(ctx);
    const row = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
    const cleanName = await validateBranding(ctx, args);
    const value = await nextBranding(ctx, (row?.value ?? {}) as StoredBranding, args, cleanName);
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now(), updatedBy: root._id });
    else await ctx.db.insert("platformSettings", { key: KEY, value, updatedAt: Date.now(), updatedBy: root._id });
    await logActivity(ctx, {
      userId: root._id,
      action: "platform.branding_updated",
      entityType: "platform",
      entityId: KEY,
      metadata: auditMetadata(cleanName, args),
    });
  },
});
