import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { NO_IMPA_CATEGORY } from "./lib/impaCategories";
import { normalizeCode, normalizeName } from "./lib/normalize";
import { jaroWinkler } from "./lib/stringSimilarity";
import { requireAdmin, requireUser } from "./lib/permissions";
import { computeItemPricing } from "./lib/matching";

/** Throws unless `name` matches one of the fixed, admin-managed product categories (empty clears the field). */
async function assertKnownCategory(ctx: MutationCtx, name: string | undefined) {
  if (!name) return;
  const known = await ctx.db.query("productCategories").withIndex("by_name", (q) => q.eq("name", name)).unique();
  if (!known) throw new Error("Catégorie inconnue : ajoutez-la d'abord dans Admin > Catégories.");
}
import { getCurrentPrice, setCurrentPrice } from "./lib/productPricing";

// Upper bound of the catalogue loaded by the front (the page filters/searches client-side).
const MAX_CATALOGUE_ROWS = 5000;

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
      .take(MAX_CATALOGUE_ROWS);
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
  // Sans code IMPA, le produit ne peut pas être rattaché au catalogue IMPA : rangé d'office dans « No IMPA ».
  const category = data.category ?? (data.impaId || data.code ? undefined : NO_IMPA_CATEGORY);
  return await ctx.db.insert("products", {
    ...data,
    category,
    normalizedName: normalizeName(data.name),
    normalizedImpaId: data.impaId ? normalizeCode(data.impaId) : undefined,
    normalizedCode: data.code ? normalizeCode(data.code) : undefined,
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
    await assertKnownCategory(ctx, args.category);
    const productId = await insertProduct(ctx, args, admin._id, "manual");
    await logActivity(ctx, {
      userId: admin._id,
      action: "product.created",
      entityType: "product",
      entityId: productId,
      metadata: { name: args.name, impaId: args.impaId },
    });
    await ctx.scheduler.runAfter(0, internal.orderItems.rematchPendingInternal, { actorEmail: admin.email ?? undefined });
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
    if (patch.category !== undefined) {
      update.category = patch.category.trim() || undefined;
      await assertKnownCategory(ctx, update.category);
    }
    // The catalogue's "IMPA / Code" is one value stored in both fields (as at import).
    for (const key of ["code", "impaId"] as const) {
      const value = patch.code !== undefined ? patch.code : patch.impaId;
      if (value !== undefined) update[key] = value.trim() || undefined;
    }
    if (patch.code !== undefined || patch.impaId !== undefined) {
      const raw = (update.impaId ?? update.code) as string | undefined;
      update.normalizedImpaId = raw ? normalizeCode(raw) : undefined;
      update.normalizedCode = raw ? normalizeCode(raw) : undefined;

      // « No IMPA » suit le code : retirer le code range le produit dans « No IMPA » (s'il n'a pas d'autre
      // catégorie) ; lui donner un code le sort de « No IMPA ».
      if (patch.category === undefined) {
        const current = await ctx.db.get(productId);
        if (!raw && current && !current.category) update.category = NO_IMPA_CATEGORY;
        else if (raw && current?.category === NO_IMPA_CATEGORY) update.category = undefined;
      }
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
      await ctx.scheduler.runAfter(0, internal.orderItems.rematchPendingInternal, { actorEmail: admin.email ?? undefined });
    }
  },
});

/** Classe plusieurs produits d'un coup dans une catégorie (vide = retire la catégorie). À appeler par lots de ~200. */
export const setCategoryMany = mutation({
  args: { productIds: v.array(v.id("products")), category: v.string() },
  handler: async (ctx, { productIds, category }) => {
    const admin = await requireAdmin(ctx);
    const name = category.trim() || undefined;
    await assertKnownCategory(ctx, name);
    for (const productId of productIds) {
      await ctx.db.patch(productId, { category: name, updatedAt: Date.now(), updatedBy: admin._id });
    }
    await logActivity(ctx, {
      userId: admin._id,
      action: "product.categorized_bulk",
      entityType: "product",
      entityId: "bulk",
      metadata: { count: productIds.length, category: name },
    });
    return { updated: productIds.length };
  },
});

/**
 * Absolute deletion of one product: a full copy (product, every price row, aliases) is first written to the
 * independent `productBackups` table, then the product and its prices and aliases are removed for good.
 * Quotation lines that pointed to it go back to "unmatched" (a line with a manual price keeps that price).
 * Returns the number of quotation lines affected.
 */
async function deleteProductForGood(ctx: MutationCtx, productId: Id<"products">, adminEmail: string): Promise<number> {
  const product = await ctx.db.get(productId);
  if (!product) return 0;

  const prices = await ctx.db.query("productPrices").withIndex("by_product", (q) => q.eq("productId", productId)).collect();
  const aliases = await ctx.db.query("productAliases").withIndex("by_product", (q) => q.eq("productId", productId)).collect();

  await ctx.db.insert("productBackups", {
    originalId: productId,
    product,
    prices,
    aliases,
    deletedAt: Date.now(),
    deletedBy: adminEmail,
  });

  // Quotation lines that used this product no longer have a product: back to "unknown".
  const lines = await ctx.db.query("orderItems").withIndex("by_product", (q) => q.eq("productId", productId)).collect();
  for (const line of lines) {
    const unlinked = { ...line, productId: undefined };
    await ctx.db.patch(line._id, {
      productId: undefined,
      matchStatus: "unmatched",
      matchConfidence: undefined,
      ambiguousCandidates: undefined,
      proposalsDismissed: undefined,
      ...(await computeItemPricing(ctx, unlinked)),
      updatedAt: Date.now(),
    });
  }

  for (const row of prices) await ctx.db.delete(row._id);
  for (const row of aliases) await ctx.db.delete(row._id);
  await ctx.db.delete(productId);
  return lines.length;
}

export const remove = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    const admin = await requireAdmin(ctx);
    const affectedLines = await deleteProductForGood(ctx, productId, admin.email ?? "");
    await logActivity(ctx, {
      userId: admin._id,
      action: "product.deleted",
      entityType: "product",
      entityId: productId,
      metadata: { affectedLines },
    });
    return { affectedLines };
  },
});

/** Absolute deletion of several products at once (bulk selection on the catalogue page). */
export const removeMany = mutation({
  args: { productIds: v.array(v.id("products")) },
  handler: async (ctx, { productIds }) => {
    const admin = await requireAdmin(ctx);
    let affectedLines = 0;
    for (const productId of productIds) {
      affectedLines += await deleteProductForGood(ctx, productId, admin.email ?? "");
    }
    await logActivity(ctx, {
      userId: admin._id,
      action: "product.deleted_bulk",
      entityType: "product",
      entityId: "bulk",
      metadata: { count: productIds.length, affectedLines },
    });
    return { affectedLines };
  },
});

/**
 * Restores a deleted product from its backup (run by hand, e.g. `npx convex run products:restoreProductBackup`).
 * The product gets a new id; its prices and aliases are recreated. The backup row is kept.
 */
export const restoreProductBackup = internalMutation({
  args: { backupId: v.id("productBackups") },
  handler: async (ctx, { backupId }) => {
    const backup = await ctx.db.get(backupId);
    if (!backup) throw new Error("Sauvegarde introuvable.");

    const { _id: _oldId, _creationTime: _oldTime, ...productFields } = backup.product as Record<string, unknown>;
    const newId = await ctx.db.insert("products", { ...(productFields as Omit<Doc<"products">, "_id" | "_creationTime">), deletedAt: undefined, active: true });
    for (const price of backup.prices as Record<string, unknown>[]) {
      const { _id, _creationTime, ...fields } = price;
      await ctx.db.insert("productPrices", { ...(fields as Omit<Doc<"productPrices">, "_id" | "_creationTime">), productId: newId });
    }
    for (const alias of backup.aliases as Record<string, unknown>[]) {
      const { _id, _creationTime, ...fields } = alias;
      await ctx.db.insert("productAliases", { ...(fields as Omit<Doc<"productAliases">, "_id" | "_creationTime">), productId: newId });
    }
    return newId;
  },
});

/** One-off: hard-deletes (after backup) every product that had been "soft deleted" by the previous logic. */
export const purgeSoftDeleted = internalMutation({
  args: {},
  handler: async (ctx) => {
    const soft = await ctx.db.query("products").filter((q) => q.neq(q.field("deletedAt"), undefined)).take(100);
    for (const product of soft) await deleteProductForGood(ctx, product._id, "migration");
    return { purged: soft.length, more: soft.length === 100 };
  },
});

/**
 * Rapprochement d'une ligne importée avec le catalogue, par CODE IMPA uniquement (comparé sans ponctuation,
 * voir normalizeCode). Un code fourni qui ne correspond à rien est « inconnu » : il n'est jamais rattrapé
 * par le nom.
 */
async function findProductByCode(ctx: QueryCtx, code: string): Promise<Doc<"products"> | null> {
  const normalized = normalizeCode(code);
  const byImpa = await ctx.db
    .query("products")
    .withIndex("by_normalizedImpaId", (q) => q.eq("normalizedImpaId", normalized))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .first();
  if (byImpa) return byImpa;
  return await ctx.db
    .query("products")
    .withIndex("by_normalizedCode", (q) => q.eq("normalizedCode", normalized))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .first();
  return { product: byName, matchedBy: byName ? "name" : null };
}

const SUGGESTION_FLOOR = 0.7; // même seuil plancher que le rapprochement des quotations (lib/matching.ts)
const MAX_SUGGESTIONS = 5;
const CODED_BOOST = 0.1; // les produits avec un code IMPA passent avant les autres à ressemblance voisine

/** Produits proches d'un nom (sans code IMPA fiable) : ceux qui ont un code IMPA d'abord, puis les autres. */
async function suggestByName(ctx: QueryCtx, name: string, countryId: Id<"countries"> | undefined) {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  const found = await ctx.db
    .query("products")
    .withSearchIndex("search_name", (q) => q.search("normalizedName", normalized))
    .take(25);
  const ranked = found
    .filter((p) => p.deletedAt === undefined)
    .map((p) => ({ p, score: jaroWinkler(normalized, p.normalizedName), coded: Boolean(p.impaId ?? p.code) }))
    .filter((s) => s.score >= SUGGESTION_FLOOR)
    .sort((a, b) => b.score + (b.coded ? CODED_BOOST : 0) - (a.score + (a.coded ? CODED_BOOST : 0)))
    .slice(0, MAX_SUGGESTIONS);
  return await Promise.all(
    ranked.map(async ({ p, score }) => ({
      productId: p._id,
      name: p.name,
      code: p.impaId ?? p.code,
      score: Math.round(score * 100),
      currentPrice: countryId ? (await getCurrentPrice(ctx, p._id, countryId))?.price : undefined,
    })),
  );
}

/**
 * Aperçu d'un import de catalogue : pour chaque ligne, le produit trouvé PAR SON CODE IMPA (et son prix actuel
 * dans le pays) ; un code fourni mais absent du catalogue est signalé (`unknownCode`) ; une ligne sans produit
 * trouvé reçoit des suggestions par ressemblance de nom (produits avec code IMPA en premier).
 */
export const previewCatalogRows = query({
  args: {
    countryId: v.optional(v.id("countries")),
    rows: v.array(v.object({ code: v.optional(v.string()), name: v.string() })),
  },
  handler: async (ctx, { countryId, rows }) => {
    await requireAdmin(ctx);
    return await Promise.all(
      rows.map(async (row) => {
        const code = row.code?.trim();
        const existing = code ? await findProductByCode(ctx, code) : null;
        const current = existing && countryId ? await getCurrentPrice(ctx, existing._id, countryId) : null;
        return {
          existingName: existing?.name,
          existingCode: existing?.impaId ?? existing?.code,
          currentPrice: current?.price,
          matchedBy: existing ? ("code" as const) : null,
          unknownCode: Boolean(code) && !existing,
          suggestions: existing ? [] : await suggestByName(ctx, row.name, countryId),
        };
      }),
    );
  },
});

/**
 * Étape 2 d'un import de catalogue : enregistre le prix du pays pour chaque ligne.
 *  - Code IMPA fourni : le produit du catalogue qui porte ce code (jamais de création) - un code inconnu
 *    BLOQUE l'enregistrement du lot (rien n'est écrit) : il faut d'abord vider le code des éléments inconnus.
 *  - Sans code, `linkProductId` : le produit choisi parmi les suggestions reçoit le prix.
 *  - Sans code ni lien : produit créé dans « No IMPA » (ou, si un produit sans code porte exactement le même
 *    nom, celui-ci est réutilisé - un ré-import ne crée pas de doublons).
 * À appeler par lots de quelques centaines de lignes.
 */
export const importCatalog = mutation({
  args: {
    countryId: v.optional(v.id("countries")),
    // Devise des prix de ce fichier, choisie librement par l'utilisateur (indépendante du pays - un même
    // pays peut recevoir des imports dans des devises différentes selon la source du fichier). Requise dès
    // qu'un pays est choisi, pour que les prix du fichier soient effectivement enregistrés.
    currency: v.optional(v.string()),
    rows: v.array(
      v.object({
        code: v.optional(v.string()),
        name: v.string(),
        description: v.optional(v.string()),
        unit: v.optional(v.string()),
        price: v.optional(v.number()),
        linkProductId: v.optional(v.id("products")),
      }),
    ),
  },
  handler: async (ctx, { countryId, currency, rows }) => {
    const admin = await requireAdmin(ctx);
    const country = countryId ? await ctx.db.get(countryId) : null;
    if (countryId && !country) throw new Error("Région introuvable.");
    // Tout article ajouté à cette région hérite automatiquement de sa devise (plus besoin de la redéfinir).
    const priceCurrency = country?.currency;

    // Validation de tout le lot AVANT la moindre écriture : un code inconnu bloque l'enregistrement.
    const resolved: Array<{ row: (typeof rows)[number]; existing: Doc<"products"> | null }> = [];
    const unknownCodes: string[] = [];
    for (const row of rows) {
      const code = row.code?.trim();
      const existing = code ? await findProductByCode(ctx, code) : null;
      if (code && !existing) unknownCodes.push(code);
      resolved.push({ row, existing });
    }
    if (unknownCodes.length > 0) {
      const shown = unknownCodes.slice(0, 5).join(", ");
      throw new Error(
        `Code IMPA non reconnu (${unknownCodes.length}) : ${shown}${unknownCodes.length > 5 ? "…" : ""}. Videz d'abord le code des éléments inconnus.`,
      );
    }

    let created = 0;
    let pricesSet = 0;
    let skipped = 0;

    for (const { row, existing } of resolved) {
      const name = row.name.trim();
      if (!name) { skipped++; continue; }

      let productId: Id<"products"> | undefined = existing?._id;
      let wasCreated = false;
      if (!productId && row.linkProductId) {
        const linked = await ctx.db.get(row.linkProductId);
        if (!linked || linked.deletedAt !== undefined) throw new Error(`Produit lié introuvable pour « ${name} ».`);
        productId = linked._id;
      }
      if (!productId) {
        const sameName = await ctx.db
          .query("products")
          .withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizeName(name)))
          .filter((q) =>
            q.and(
              q.eq(q.field("deletedAt"), undefined),
              q.eq(q.field("normalizedImpaId"), undefined),
              q.eq(q.field("normalizedCode"), undefined),
            ),
          )
          .first();
        if (sameName) {
          productId = sameName._id;
        } else {
          productId = await insertProduct(ctx, { name, description: row.description, unit: row.unit ?? "PCS" }, admin._id, "manual");
          created++;
          wasCreated = true;
        }
      }

      if (row.price === undefined) { if (!wasCreated) skipped++; continue; }
      if (country && countryId && priceCurrency) {
        const current = await getCurrentPrice(ctx, productId, countryId);
        const price = Math.round(row.price * 100) / 100;
        if (!current || current.price !== price || current.currency !== priceCurrency) {
          await setCurrentPrice(ctx, { productId, countryId, price, currency: priceCurrency, actorId: admin._id });
          pricesSet++;
        }
      }
    }

    await logActivity(ctx, {
      userId: admin._id,
      action: "product.catalog_imported",
      entityType: "product",
      entityId: "catalog",
      metadata: { rows: rows.length, created, pricesSet, countryId, currency: priceCurrency },
    });
    if (created > 0 || pricesSet > 0) {
      await ctx.scheduler.runAfter(0, internal.orderItems.rematchPendingInternal, { actorEmail: admin.email ?? undefined });
    }
    return { created, pricesSet, skipped };
  },
});
/** One-off: backfills normalizedImpaId/normalizedCode on every product created before this field existed. */
export const backfillNormalizedCodes = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<{ more: boolean; updated: number }> => {
    const page = await ctx.db.query("products").paginate({ numItems: 200, cursor: cursor ?? null });
    let updated = 0;
    for (const p of page.page) {
      const normalizedImpaId = p.impaId ? normalizeCode(p.impaId) : undefined;
      const normalizedCode = p.code ? normalizeCode(p.code) : undefined;
      if (p.normalizedImpaId !== normalizedImpaId || p.normalizedCode !== normalizedCode) {
        await ctx.db.patch(p._id, { normalizedImpaId, normalizedCode });
        updated++;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.products.backfillNormalizedCodes, { cursor: page.continueCursor });
    }
    return { more: !page.isDone, updated };
  },
});
