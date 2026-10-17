import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { companyIdOf, getOwned, requireAdmin, requireOwned, requireUser } from "./lib/permissions";

async function assertKnownCurrency(ctx: MutationCtx, companyId: Id<"companies">, code: string) {
  const currency = await ctx.db
    .query("currencies")
    .withIndex("by_company_and_code", (q) => q.eq("companyId", companyId).eq("code", code))
    .unique();
  if (!currency) throw new Error("Devise inconnue : ajoutez-la d'abord dans Admin > Devises.");
}

export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const user = await requireUser(ctx);
    const countries = await ctx.db
      .query("countries")
      .withIndex("by_company_and_code", (q) => q.eq("companyId", companyIdOf(user)))
      .collect();
    return activeOnly ? countries.filter((c) => c.active) : countries;
  },
});

export const get = query({
  args: { countryId: v.id("countries") },
  handler: async (ctx, { countryId }) => {
    const user = await requireUser(ctx);
    return await getOwned(ctx, user, "countries", countryId);
  },
});

export const create = mutation({
  args: { code: v.string(), name: v.string(), city: v.optional(v.string()), currency: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);

    const existing = await ctx.db
      .query("countries")
      .withIndex("by_company_and_code", (q) => q.eq("companyId", companyId).eq("code", args.code))
      .unique();
    if (existing) throw new Error("Un pays avec ce code existe déjà.");
    // La devise n'est plus liée au pays (elle est choisie à l'import du catalogue) : champ facultatif et hérité.
    const currency = args.currency?.trim() ? args.currency.trim().toUpperCase() : undefined;
    if (currency) await assertKnownCurrency(ctx, companyId, currency);

    const countryId = await ctx.db.insert("countries", { ...args, companyId, currency, active: true });
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
    const companyId = companyIdOf(admin);
    const country = await requireOwned(ctx, admin, "countries", countryId, "Pays introuvable.");

    const patch: { code?: string; name?: string; city?: string; currency?: string; active?: boolean } = {};
    if (edits.code !== undefined) {
      const code = edits.code.trim().toUpperCase();
      if (!code) throw new Error("Le code ne peut pas être vide.");
      if (code !== country.code) {
        const taken = await ctx.db
          .query("countries")
          .withIndex("by_company_and_code", (q) => q.eq("companyId", companyId).eq("code", code))
          .unique();
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
      await assertKnownCurrency(ctx, companyId, patch.currency);
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
