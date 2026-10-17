import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { companyIdOf, requireAdmin, requireUser } from "./lib/permissions";

export const DEFAULT_QUOTATION_PERCENT_KEY = "defaultQuotationPercent";
export const COMPANY_INFO_KEY = "companyInfo";

/** Réglages de l'entreprise de l'utilisateur : une clé n'existe qu'une fois PAR entreprise. */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const user = await requireUser(ctx);
    const setting = await ctx.db
      .query("settings")
      .withIndex("by_company_and_key", (q) => q.eq("companyId", companyIdOf(user)).eq("key", key))
      .unique();
    return setting?.value ?? null;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await ctx.db
      .query("settings")
      .withIndex("by_company_and_key", (q) => q.eq("companyId", companyIdOf(user)))
      .collect();
  },
});

export const update = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_company_and_key", (q) => q.eq("companyId", companyId).eq("key", key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: Date.now(), updatedBy: admin._id });
    } else {
      await ctx.db.insert("settings", {
        companyId,
        key,
        value,
        updatedAt: Date.now(),
        updatedBy: admin._id,
      });
    }

    await logActivity(ctx, {
      userId: admin._id,
      action: "settings.updated",
      entityType: "settings",
      entityId: key,
      metadata: { key, value },
    });
  },
});
