import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { logActivity } from "./lib/audit";
import { companyIdOf, requireAdmin, requireOwned, requireUser } from "./lib/permissions";

const MAX_NAME_LENGTH = 80;
const templateKind = v.union(v.literal("quotation"), v.literal("purchase_order"), v.literal("delivery_note"));
// Absent côté stockage = "quotation" (modèles importés avant l'ajout de PO/DN) : ce helper le rend explicite partout.
const kindOf = (t: { kind?: "quotation" | "purchase_order" | "delivery_note" }) => t.kind ?? "quotation";

/** Modèles d'export de l'entreprise pour un type de document donné (le fichier lui-même n'est pas renvoyé). */
export const list = query({
  args: { kind: templateKind },
  handler: async (ctx, { kind }) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db.query("exportTemplates").withIndex("by_company", (q) => q.eq("companyId", companyIdOf(user))).collect();
    return rows
      .filter((t) => kindOf(t) === kind)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((t) => ({ id: t._id, name: t.name, fileName: t.fileName, size: t.size, isDefault: t.isDefault, createdAt: t.createdAt }));
  },
});

/** Définit le modèle par défaut pour `kind` (null = retour au modèle intégré). Un seul modèle par type à la fois. */
export const setDefault = mutation({
  args: { kind: templateKind, templateId: v.union(v.id("exportTemplates"), v.null()) },
  handler: async (ctx, { kind, templateId }) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);
    if (templateId) {
      const target = await requireOwned(ctx, admin, "exportTemplates", templateId, "Modèle introuvable.");
      if (kindOf(target) !== kind) throw new Error("Ce modèle n'est pas du type de document attendu.");
    }
    const rows = await ctx.db.query("exportTemplates").withIndex("by_company", (q) => q.eq("companyId", companyId)).collect();
    for (const row of rows) {
      if (kindOf(row) !== kind) continue; // un autre type de document : son défaut n'est pas touché
      const next = row._id === templateId;
      if (row.isDefault !== next) await ctx.db.patch(row._id, { isDefault: next });
    }
    await logActivity(ctx, { userId: admin._id, action: "export_template.default_changed", entityType: "exportTemplate", entityId: templateId ?? undefined });
    return null;
  },
});

export const rename = mutation({
  args: { templateId: v.id("exportTemplates"), name: v.string() },
  handler: async (ctx, { templateId, name }) => {
    const admin = await requireAdmin(ctx);
    await requireOwned(ctx, admin, "exportTemplates", templateId, "Modèle introuvable.");
    const clean = name.trim();
    if (!clean) throw new Error("Le nom ne peut pas être vide.");
    if (clean.length > MAX_NAME_LENGTH) throw new Error(`Nom trop long (${MAX_NAME_LENGTH} caractères maximum).`);
    await ctx.db.patch(templateId, { name: clean });
    return null;
  },
});

export const remove = mutation({
  args: { templateId: v.id("exportTemplates") },
  handler: async (ctx, { templateId }) => {
    const admin = await requireAdmin(ctx);
    const template = await requireOwned(ctx, admin, "exportTemplates", templateId, "Modèle introuvable.");
    await ctx.storage.delete(template.storageId);
    await ctx.db.delete(templateId);
    await logActivity(ctx, { userId: admin._id, action: "export_template.deleted", entityType: "exportTemplate", entityId: templateId, metadata: { name: template.name } });
    return null;
  },
});

/** Internal : enregistre un modèle déjà contrôlé (voir exportTemplatesNode.register). */
export const insert = internalMutation({
  args: { companyId: v.id("companies"), userId: v.id("users"), name: v.string(), fileName: v.string(), storageId: v.id("_storage"), size: v.number(), kind: templateKind },
  handler: async (ctx, { companyId, userId, name, fileName, storageId, size, kind }) => {
    const id = await ctx.db.insert("exportTemplates", { companyId, name, fileName, storageId, size, isDefault: false, kind, createdAt: Date.now(), createdBy: userId });
    await logActivity(ctx, { userId, action: "export_template.imported", entityType: "exportTemplate", entityId: id, metadata: { name } });
    return id;
  },
});

/** Internal : modèle à utiliser pour un export (celui demandé, sinon le modèle par défaut pour ce type) ; null = modèle intégré. */
export const resolve = internalQuery({
  args: { companyId: v.id("companies"), kind: templateKind, templateId: v.optional(v.union(v.id("exportTemplates"), v.null())) },
  handler: async (ctx, { companyId, kind, templateId }) => {
    // null explicite = modèle intégré, même s'il existe un modèle par défaut.
    if (templateId === null) return null;
    let template = templateId ? await ctx.db.get(templateId) : null;
    if (templateId && (!template || template.companyId !== companyId || kindOf(template) !== kind)) throw new Error("Modèle d'export introuvable.");
    if (!template) {
      const rows = await ctx.db.query("exportTemplates").withIndex("by_company", (q) => q.eq("companyId", companyId)).collect();
      template = rows.find((t) => t.isDefault && kindOf(t) === kind) ?? null;
    }
    return template ? { storageId: template.storageId, name: template.name } : null;
  },
});

/** Internal : un modèle de l'entreprise (téléchargement, essai). */
export const getOwnedTemplate = internalQuery({
  args: { companyId: v.id("companies"), templateId: v.id("exportTemplates") },
  handler: async (ctx, { companyId, templateId }) => {
    const template = await ctx.db.get(templateId);
    if (!template || template.companyId !== companyId) return null;
    return { storageId: template.storageId, name: template.name, fileName: template.fileName };
  },
});

/**
 * Entreprise autorisée à utiliser le document générique intégré à l'app quand elle n'a importé aucun modèle pour
 * un type de document (quotation/PO/DN) - vrai uniquement pour l'entreprise historique (MBSS). Toute autre
 * entreprise doit importer son propre modèle pour chaque type avant de pouvoir exporter.
 */
export const allowsBuiltin = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => Boolean((await ctx.db.get(companyId))?.allowBuiltinTemplates),
});

/** Même chose, pour l'entreprise de l'utilisateur connecté (affichage côté admin). */
export const myCompanyAllowsBuiltin = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return Boolean((await ctx.db.get(companyIdOf(user)))?.allowBuiltinTemplates);
  },
});
