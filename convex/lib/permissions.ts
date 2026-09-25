import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../_generated/dataModel";
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
