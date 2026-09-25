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
  await ctx.db.insert("activityLogs", {
    userId: args.userId ?? undefined,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    metadata: args.metadata,
    createdAt: Date.now(),
  });
}
