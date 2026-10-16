import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";

/** Returns the current user's profile doc, or null if not authenticated / disabled. */
export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const authUserId = await getAuthUserId(ctx);
  if (authUserId === null) return null;
  const user = await ctx.db.get(authUserId);
  if (!user || user.status !== "active") return null;
  return user;
}

/** Throws if there is no authenticated, active user. Returns that user. */
export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Authentification requise.");
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
