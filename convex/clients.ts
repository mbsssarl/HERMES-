import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { capitalizeWords } from "./lib/names";
import { logActivity } from "./lib/audit";
import { companyIdOf, getOwned, requireOwned, requireUser } from "./lib/permissions";

export const list = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    const user = await requireUser(ctx);
    const clients = (
      await ctx.db
        .query("clients")
        .withIndex("by_company_and_name", (q) => q.eq("companyId", companyIdOf(user)))
        .collect()
    ).filter((c) => c.deletedAt === undefined);

    if (!search) return clients;
    const term = search.toLowerCase();
    return clients.filter((c) => c.name.toLowerCase().includes(term));
  },
});

export const get = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const user = await requireUser(ctx);
    return await getOwned(ctx, user, "clients", clientId);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.countryId) await requireOwned(ctx, user, "countries", args.countryId, "Région introuvable.");
    // Le nom d'un client est enregistré avec une majuscule à chaque mot.
    const name = capitalizeWords(args.name.trim());
    const clientId = await ctx.db.insert("clients", {
      ...args,
      companyId: companyIdOf(user),
      name,
      createdAt: Date.now(),
      createdBy: user._id,
    });
    await logActivity(ctx, {
      userId: user._id,
      action: "client.created",
      entityType: "client",
      entityId: clientId,
      metadata: { name },
    });
    return clientId;
  },
});

export const update = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, { clientId, ...patch }) => {
    const user = await requireUser(ctx);
    await requireOwned(ctx, user, "clients", clientId, "Client introuvable.");
    if (patch.countryId) await requireOwned(ctx, user, "countries", patch.countryId, "Région introuvable.");
    await ctx.db.patch(clientId, patch);
    await logActivity(ctx, {
      userId: user._id,
      action: "client.updated",
      entityType: "client",
      entityId: clientId,
      metadata: patch,
    });
  },
});
