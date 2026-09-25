import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { normalizeName } from "./lib/normalize";
import { requireAdmin, requireUser } from "./lib/permissions";
import { getCurrentPrice, setCurrentPrice } from "./lib/productPricing";

export const list = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    await requireUser(ctx);
    if (search && search.trim()) {
      return await ctx.db
        .query("products")
        .withSearchIndex("search_name", (q) => q.search("normalizedName", normalizeName(search)))
        .take(100);
    }
    return await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .order("desc")
      .take(200);
  },
});

export const get = query({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    await requireUser(ctx);
    return await ctx.db.get(productId);
  },
});

interface NewProductData {
  impaId?: string;
  code?: string;
  name: string;
  description?: string;
  unit: string;
  category?: string;
}

/**
 * Shared insertion logic reused by manual admin creation and by
 * supplier-validation import. Only the product's identity is created here -
 * its price(s) are set separately per country via `productPrices.setPrice`.
 */
export async function insertProduct(
  ctx: MutationCtx,
  data: NewProductData,
  actorId: Id<"users">,
  source: "manual" | "supplier_import",
  sourceOrderId?: Id<"orders">,
): Promise<Id<"products">> {
  const now = Date.now();
  return await ctx.db.insert("products", {
    ...data,
    normalizedName: normalizeName(data.name),
    active: true,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
    source,
    sourceOrderId,
  });
}

export const createManual = mutation({
  args: {
    impaId: v.optional(v.string()),
    code: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    unit: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const productId = await insertProduct(ctx, args, admin._id, "manual");
    await logActivity(ctx, {
      userId: admin._id,
      action: "product.created",
      entityType: "product",
      entityId: productId,
      metadata: { name: args.name, impaId: args.impaId },
    });
    await ctx.scheduler.runAfter(0, internal.orderItems.rematchPendingInternal, {});
    return productId;
  },
});

export const update = mutation({
  args: {
    productId: v.id("products"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    unit: v.optional(v.string()),
    category: v.optional(v.string()),
    code: v.optional(v.string()),
    impaId: v.optional(v.string()),
  },
  handler: async (ctx, { productId, ...patch }) => {
    const admin = await requireAdmin(ctx);
    const update: Partial<Doc<"products">> = { updatedAt: Date.now(), updatedBy: admin._id };

    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error("Le nom ne peut pas être vide.");
      update.name = patch.name.trim();
      update.normalizedName = normalizeName(patch.name);
    }
    if (patch.unit !== undefined) {
      if (!patch.unit.trim()) throw new Error("L'unité ne peut pas être vide.");
      update.unit = patch.unit.trim();
    }
    // An empty string clears an optional field.
    if (patch.description !== undefined) update.description = patch.description.trim() || undefined;
    if (patch.category !== undefined) update.category = patch.category.trim() || undefined;
    // The catalogue's "IMPA / Code" is one value stored in both fields (as at import).
    for (const key of ["code", "impaId"] as const) {
      const value = patch.code !== undefined ? patch.code : patch.impaId;
      if (value !== undefined) update[key] = value.trim() || undefined;
    }

    await ctx.db.patch(productId, update);
    await logActivity(ctx, {
      userId: admin._id,
      action: "product.updated",
      entityType: "product",
      entityId: productId,
      metadata: patch,
    });
    if (patch.name || patch.code || patch.impaId) {
      await ctx.scheduler.runAfter(0, internal.orderItems.rematchPendingInternal, {});
    }
  },
});

export const deactivate = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    const admin = await requireAdmin(ctx);
    await ctx.db.patch(productId, { active: false, deletedAt: Date.now(), updatedBy: admin._id });
    await logActivity(ctx, {
      userId: admin._id,
      action: "product.deactivated",
      entityType: "product",
      entityId: productId,
    });
  },
});

/** Catalogue lookup used by both the import preview and the import itself: IMPA, then code, then exact normalized name. */
async function findExistingProduct(
  ctx: QueryCtx,
  code: string | undefined,
  name: string,
): Promise<Doc<"products"> | null> {
  if (code) {
    const byImpa = await ctx.db.query("products").withIndex("by_impaId", (q) => q.eq("impaId", code)).first();
    if (byImpa) return byImpa;
    const byCode = await ctx.db.query("products").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (byCode) return byCode;
  }
  return await ctx.db
    .query("products")
    .withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizeName(name)))
    .first();
}

/** Preview of a catalogue import: for each row, the product it would match (if any) and that product's current price in the country. */
export const previewCatalogRows = query({
  args: {
    countryId: v.optional(v.id("countries")),
    rows: v.array(v.object({ code: v.optional(v.string()), name: v.string() })),
  },
  handler: async (ctx, { countryId, rows }) => {
    await requireAdmin(ctx);
    return await Promise.all(
      rows.map(async (row) => {
        const existing = await findExistingProduct(ctx, row.code, row.name.trim());
        const current = existing && countryId ? await getCurrentPrice(ctx, existing._id, countryId) : null;
        return {
          existingName: existing?.name,
          existingCode: existing?.impaId ?? existing?.code,
          currentPrice: current?.price,
        };
      }),
    );
  },
});

/**
 * Step 2 of a catalogue import: creates the products that don't exist yet
 * (matched on IMPA/code, then exact normalized name) and, when a country and a
 * price are given, sets that country's price - for existing products too, which
 * makes it a bulk price update. Call in batches (a few hundred rows at a time).
 */
export const importCatalog = mutation({
  args: {
    countryId: v.optional(v.id("countries")),
    rows: v.array(
      v.object({
        code: v.optional(v.string()),
        name: v.string(),
        description: v.optional(v.string()),
        unit: v.optional(v.string()),
        price: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { countryId, rows }) => {
    const admin = await requireAdmin(ctx);
    const country = countryId ? await ctx.db.get(countryId) : null;
    if (countryId && !country) throw new Error("Pays introuvable.");

    let created = 0;
    let pricesSet = 0;
    let skipped = 0;

    for (const row of rows) {
      const name = row.name.trim();
      if (!name) { skipped++; continue; }

      const existing = await findExistingProduct(ctx, row.code, name);

      let productId = existing?._id;
      if (!productId) {
        productId = await insertProduct(
          ctx,
          { impaId: row.code, code: row.code, name, description: row.description, unit: row.unit ?? "PCS" },
          admin._id,
          "manual",
        );
        created++;
      } else if (row.price === undefined) {
        skipped++;
      }

      if (country && countryId && row.price !== undefined) {
        const current = await getCurrentPrice(ctx, productId, countryId);
        const price = Math.round(row.price * 100) / 100;
        if (!current || current.price !== price) {
          await setCurrentPrice(ctx, { productId, countryId, price, currency: country.currency, actorId: admin._id });
          pricesSet++;
        }
      }
    }

    await logActivity(ctx, {
      userId: admin._id,
      action: "product.catalog_imported",
      entityType: "product",
      entityId: "catalog",
      metadata: { rows: rows.length, created, pricesSet, countryId },
    });
    if (created > 0 || pricesSet > 0) {
      await ctx.scheduler.runAfter(0, internal.orderItems.rematchPendingInternal, {});
    }
    return { created, pricesSet, skipped };
  },
});
