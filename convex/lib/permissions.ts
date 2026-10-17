import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";

/**
 * Profil du compte connecté, ou null s'il n'est pas connecté / désactivé. Le super admin est accepté, ainsi que
 * les comptes d'une entreprise suspendue : réservé aux fonctions de profil (langue, thème, mot de passe) et à
 * l'écran qui informe l'utilisateur de la suspension.
 */
export async function getAnyUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const authUserId = await getAuthUserId(ctx);
  if (authUserId === null) return null;
  const user = await ctx.db.get(authUserId);
  if (!user || user.status !== "active") return null;
  return user;
}

/** Entreprise du compte (null pour le super admin) et indication de suspension. */
export async function companyStateOf(ctx: QueryCtx | MutationCtx, user: Doc<"users">): Promise<{ company: Doc<"companies"> | null; suspended: boolean }> {
  if (!user.companyId) return { company: null, suspended: false };
  const company = await ctx.db.get(user.companyId);
  return { company, suspended: !company || company.status === "suspended" };
}

/**
 * Compte autorisé à travailler sur les données d'une entreprise : actif, rattaché à une entreprise non suspendue.
 * Renvoie null pour le super admin (il n'a accès à aucune donnée métier) et pour une entreprise suspendue.
 */
export async function getCurrentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const user = await getAnyUser(ctx);
  if (!user || user.role === "superadmin") return null;
  const { suspended } = await companyStateOf(ctx, user);
  return suspended ? null : user;
}

/** Throws if there is no authenticated user allowed to work on company data. Returns that user. */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Authentification requise.");
  return user;
}

/** Comme requireUser mais accepte aussi le super admin et une entreprise suspendue (fonctions de profil). */
export async function requireAnyUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await getAnyUser(ctx);
  if (!user) throw new Error("Authentification requise.");
  return user;
}

/** Throws unless the current user is the platform super admin. */
export async function requireSuperadmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await getAnyUser(ctx);
  if (!user || user.role !== "superadmin") throw new Error("Action réservée au super administrateur.");
  return user;
}

/** Throws if the current user is not an active admin. Returns that user. */
export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new Error("Action réservée aux administrateurs.");
  }
  return user;
}

/** Entreprise du compte ; erreur si le compte n'en a pas (le super admin n'a accès à aucune donnée d'entreprise). */
export function companyIdOf(user: Doc<"users">): Id<"companies"> {
  if (!user.companyId) throw new Error("Ce compte n'est rattaché à aucune entreprise.");
  return user.companyId;
}

/** Throws unless `doc` belongs to the same company as `user` (même message qu'un document absent : rien n'est révélé). */
export function assertSameCompany(user: Doc<"users">, doc: { companyId?: Id<"companies"> } | null, notFound = "Introuvable."): void {
  if (!doc || !user.companyId || doc.companyId !== user.companyId) throw new Error(notFound);
}
