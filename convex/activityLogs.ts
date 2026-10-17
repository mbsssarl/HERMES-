import { v } from "convex/values";
import { query } from "./_generated/server";
import { companyIdOf, requireAdmin } from "./lib/permissions";

const LOG_SCAN_LIMIT = 2000;

/** Journal d'activité de l'entreprise de l'admin (jamais celui d'une autre entreprise). */
export const list = query({
  args: {
    entityType: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityType, userId, limit }) => {
    const admin = await requireAdmin(ctx);
    const wanted = limit ?? 200;

    // Index (entreprise, date) : les plus récents d'abord ; les filtres éventuels s'appliquent sur un lot borné.
    const scanned = await ctx.db
      .query("activityLogs")
      .withIndex("by_company", (q) => q.eq("companyId", companyIdOf(admin)))
      .order("desc")
      .take(userId || entityType ? LOG_SCAN_LIMIT : wanted);

    return scanned
      .filter((l) => (userId ? l.userId === userId : true) && (entityType ? l.entityType === entityType : true))
      .slice(0, wanted);
  },
});
