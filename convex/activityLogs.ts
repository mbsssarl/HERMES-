import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAdmin } from "./lib/permissions";

export const list = query({
  args: {
    entityType: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityType, userId, limit }) => {
    await requireAdmin(ctx);

    let logs = userId
      ? await ctx.db.query("activityLogs").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").collect()
      : await ctx.db.query("activityLogs").order("desc").take(limit ?? 200);

    if (entityType) logs = logs.filter((l) => l.entityType === entityType);
    return logs.slice(0, limit ?? 200);
  },
});
