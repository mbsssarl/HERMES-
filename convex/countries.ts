import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { requireAdmin, requireUser } from "./lib/permissions";

async function assertKnownCurrency(ctx: MutationCtx, code: string) {
  const currency = await ctx.db.query("currencies").withIndex("by_code", (q) => q.eq("code", code)).unique();
  if (!currency) throw new Error("Devise inconnue : ajoutez-la d'abord dans Admin > Devises.");
}

export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    await requireUser(ctx);
    const countries = await ctx.db.query("countries").collect();
    return activeOnly ? countries.filter((c) => c.active) : countries;
  },
});

export const get = query({
  args: { countryId: v.id("countries") },
  handler: async (ctx, { countryId }) => {
    await requireUser(ctx);
    return await ctx.db.get(countryId);
  },
});

export const create = mutation({
  args: { code: v.string(), name: v.string(), city: v.optional(v.string()), currency: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const existing = await ctx.db
      .query("countries")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (existing) throw new Error("Un pays avec ce code existe déjà.");
    const currency = args.currency.trim().toUpperCase();
    await assertKnownCurrency(ctx, currency);

    const countryId = await ctx.db.insert("countries", { ...args, currency, active: true });
    await logActivity(ctx, {
      userId: admin._id,
      action: "country.created",
      entityType: "country",
      entityId: countryId,
      metadata: args,
    });
    return countryId;
  },
});

export const update = mutation({
  args: {
    countryId: v.id("countries"),
    code: v.optional(v.string()),
    name: v.optional(v.string()),
    city: v.optional(v.string()),
    currency: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { countryId, ...edits }) => {
    const admin = await requireAdmin(ctx);
    const country = await ctx.db.get(countryId);
    if (!country) throw new Error("Pays introuvable.");

    const patch: { code?: string; name?: string; city?: string; currency?: string; active?: boolean } = {};
    if (edits.code !== undefined) {
      const code = edits.code.trim().toUpperCase();
      if (!code) throw new Error("Le code ne peut pas être vide.");
      if (code !== country.code) {
        const taken = await ctx.db.query("countries").withIndex("by_code", (q) => q.eq("code", code)).unique();
        if (taken) throw new Error("Un pays avec ce code existe déjà.");
        patch.code = code;
      }
    }
    if (edits.name !== undefined) {
      if (!edits.name.trim()) throw new Error("Le nom ne peut pas être vide.");
      patch.name = edits.name.trim();
    }
    if (edits.city !== undefined) patch.city = edits.city.trim() || undefined;
    if (edits.currency !== undefined) {
      if (!edits.currency.trim()) throw new Error("La devise ne peut pas être vide.");
      patch.currency = edits.currency.trim().toUpperCase();
      await assertKnownCurrency(ctx, patch.currency);
    }
    if (edits.active !== undefined) patch.active = edits.active;

    await ctx.db.patch(countryId, patch);
    await logActivity(ctx, {
      userId: admin._id,
      action: "country.updated",
      entityType: "country",
      entityId: countryId,
      metadata: patch,
    });
  },
});
