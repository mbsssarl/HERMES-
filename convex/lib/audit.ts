import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export interface LogActivityArgs {
  userId: Id<"users"> | null;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: unknown;
}

/** Records an audit trail entry. Call from within the same mutation as the change it describes. */
export async function logActivity(ctx: MutationCtx, args: LogActivityArgs): Promise<void> {
  // L'entreprise du journal est celle de l'auteur (absente pour une action système ou du super admin).
  const author = args.userId ? await ctx.db.get(args.userId) : null;
  await ctx.db.insert("activityLogs", {
    companyId: author?.companyId,
    userId: args.userId ?? undefined,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    metadata: args.metadata,
    createdAt: Date.now(),
  });
}
