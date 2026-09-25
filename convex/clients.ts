import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { requireUser } from "./lib/permissions";

export const list = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    await requireUser(ctx);
    const clients = await ctx.db
      .query("clients")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

    if (!search) return clients;
    const term = search.toLowerCase();
    return clients.filter((c) => c.name.toLowerCase().includes(term));
  },
});

export const get = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await requireUser(ctx);
    return await ctx.db.get(clientId);
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
    const clientId = await ctx.db.insert("clients", {
      ...args,
      createdAt: Date.now(),
      createdBy: user._id,
    });
    await logActivity(ctx, {
      userId: user._id,
      action: "client.created",
      entityType: "client",
      entityId: clientId,
      metadata: { name: args.name },
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
