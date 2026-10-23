"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { fetchCompanyLogo } from "./lib/export/logoImage";
import { analyzeTemplate, applyMapping, type TemplateAnalysis } from "./lib/export/templateAuthoring";
import { inspectTemplate, renderOrderTemplate, renderTemplate } from "./lib/export/templateEngine";
import { buildBaseOrderTemplate, buildBaseTemplate, SAMPLE_EXPORT, SAMPLE_ORDER_DOCUMENT } from "./lib/export/templateSample";

const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const templateKind = v.union(v.literal("quotation"), v.literal("purchase_order"), v.literal("delivery_note"));

async function requireAdminUser(ctx: ActionCtx): Promise<{ _id: Id<"users">; companyId: Id<"companies"> }> {
  const user = await ctx.runQuery(api.users.getBusinessUser, {});
  if (!user) throw new Error("Authentification requise.");
  if (user.role !== "admin" || !user.companyId) throw new Error("Action réservée aux administrateurs.");
  return { _id: user._id, companyId: user.companyId };
}

/**
 * Enregistre un fichier envoyé par l'admin comme modèle d'export : il est contrôlé (classeur lisible, repères connus,
 * une ligne d'articles) ; s'il est refusé, le fichier est supprimé du stockage.
 */
export const register = action({
  args: {
    kind: templateKind,
    storageId: v.id("_storage"),
    name: v.string(),
    fileName: v.string(),
    // Association saisie par l'admin pour un fichier sans repères : l'application écrit elle-même les repères.
    mapping: v.optional(
      v.object({
        sheet: v.string(),
        modelRow: v.number(),
        endRow: v.number(),
        columns: v.record(v.string(), v.string()),
        fields: v.array(v.object({ cell: v.string(), token: v.string() })),
        images: v.optional(v.array(v.object({ index: v.number(), action: v.union(v.literal("keep"), v.literal("remove"), v.literal("logo")) }))),
      }),
    ),
  },
  handler: async (ctx, { kind, storageId, name, fileName, mapping }): Promise<{ warnings: string[] }> => {
    const reject = async (message: string): Promise<never> => {
      await ctx.storage.delete(storageId);
      throw new Error(message);
    };
    const user = await ctx.runQuery(api.users.getBusinessUser, {});
    if (!user) return reject("Authentification requise.");
    if (user.role !== "admin" || !user.companyId) return reject("Action réservée aux administrateurs.");

    const blob = await ctx.storage.get(storageId);
    if (!blob) return reject("Fichier introuvable dans le stockage.");
    if (blob.size > MAX_TEMPLATE_BYTES) return reject("Fichier trop volumineux (5 Mo maximum).");
    if (!/\.xlsx$/i.test(fileName)) return reject("Le modèle doit être un fichier Excel .xlsx.");

    let source: Buffer = Buffer.from(await blob.arrayBuffer());
    if (mapping) {
      try {
        source = await applyMapping(source, mapping, kind);
      } catch (err) {
        return reject(err instanceof Error ? err.message : String(err));
      }
      // Le fichier balisé remplace le fichier envoyé.
      const prepared = await ctx.storage.store(new Blob([new Uint8Array(source)], { type: XLSX_MIME }));
      await ctx.storage.delete(storageId);
      storageId = prepared;
    }
    const report = await inspectTemplate(source, kind);
    if (!report.ok) return reject(report.errors.join(" "));

    const cleanName = name.trim() || fileName.replace(/\.xlsx$/i, "");
    await ctx.runMutation(internal.exportTemplates.insert, {
      companyId: user.companyId,
      userId: user._id,
      name: cleanName.slice(0, 80),
      fileName: fileName.slice(0, 200),
      storageId,
      size: source.length,
      kind,
    });
    return { warnings: report.warnings };
  },
});

/**
 * Regarde un fichier envoyé : s'il contient déjà des repères, il peut être enregistré tel quel ; sinon l'application
 * propose une association (colonnes du tableau, cases d'information) à faire valider.
 */
export const analyze = action({
  args: { kind: templateKind, storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, { kind, storageId, fileName }): Promise<{ hasTokens: true } | { hasTokens: false; analysis: TemplateAnalysis }> => {
    const reject = async (message: string): Promise<never> => {
      await ctx.storage.delete(storageId);
      throw new Error(message);
    };
    const user = await ctx.runQuery(api.users.getBusinessUser, {});
    if (!user) return reject("Authentification requise.");
    if (user.role !== "admin" || !user.companyId) return reject("Action réservée aux administrateurs.");
    const blob = await ctx.storage.get(storageId);
    if (!blob) return reject("Fichier introuvable dans le stockage.");
    if (blob.size > MAX_TEMPLATE_BYTES) return reject("Fichier trop volumineux (5 Mo maximum).");
    if (!/\.xlsx$/i.test(fileName)) return reject("Le modèle doit être un fichier Excel .xlsx.");
    const buffer = Buffer.from(await blob.arrayBuffer());
    const report = await inspectTemplate(buffer, kind);
    if (report.tokens.length > 0) return { hasTokens: true };
    try {
      return { hasTokens: false, analysis: await analyzeTemplate(buffer, kind) };
    } catch (err) {
      return reject(err instanceof Error ? err.message : String(err));
    }
  },
});

/** Abandon d'un import : supprime le fichier envoyé. */
export const discard = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<null> => {
    await requireAdminUser(ctx);
    await ctx.storage.delete(storageId);
    return null;
  },
});

/** Télécharge un modèle importé (fichier d'origine). */
export const download = action({
  args: { templateId: v.id("exportTemplates") },
  handler: async (ctx, { templateId }): Promise<{ fileName: string; base64: string }> => {
    const user = await requireAdminUser(ctx);
    const template = await ctx.runQuery(internal.exportTemplates.getOwnedTemplate, { companyId: user.companyId, templateId });
    if (!template) throw new Error("Modèle introuvable.");
    const blob = await ctx.storage.get(template.storageId);
    if (!blob) throw new Error("Fichier du modèle introuvable.");
    return { fileName: template.fileName, base64: Buffer.from(await blob.arrayBuffer()).toString("base64") };
  },
});

/** Modèle de départ, déjà balisé. */
export const baseTemplate = action({
  args: { kind: templateKind },
  handler: async (ctx, { kind }): Promise<{ fileName: string; base64: string }> => {
    await requireAdminUser(ctx);
    if (kind === "quotation") return { fileName: "modele-export-base.xlsx", base64: (await buildBaseTemplate()).toString("base64") };
    return { fileName: `modele-${kind === "purchase_order" ? "purchase-order" : "delivery-note"}-base.xlsx`, base64: (await buildBaseOrderTemplate()).toString("base64") };
  },
});

/** Essai d'un modèle avec des données fictives (et le logo de l'entreprise) : l'admin voit le résultat avant de l'adopter. */
export const test = action({
  args: { kind: templateKind, templateId: v.id("exportTemplates") },
  handler: async (ctx, { kind, templateId }): Promise<{ fileName: string; base64: string; mime: string }> => {
    const user = await requireAdminUser(ctx);
    const template = await ctx.runQuery(internal.exportTemplates.getOwnedTemplate, { companyId: user.companyId, templateId });
    if (!template) throw new Error("Modèle introuvable.");
    const blob = await ctx.storage.get(template.storageId);
    if (!blob) throw new Error("Fichier du modèle introuvable.");
    const brand = await ctx.runQuery(api.branding.get, {});
    const logo = (await fetchCompanyLogo(brand.logoUrl)) ?? undefined;
    const fileBuffer = Buffer.from(await blob.arrayBuffer());
    const buffer =
      kind === "quotation"
        ? await renderTemplate(fileBuffer, { ...SAMPLE_EXPORT, logo, company: { ...SAMPLE_EXPORT.company, name: brand.name } })
        : await renderOrderTemplate(fileBuffer, { ...SAMPLE_ORDER_DOCUMENT, logo, company: { ...SAMPLE_ORDER_DOCUMENT.company, name: brand.name } });
    return { fileName: `essai - ${template.name}.xlsx`, base64: buffer.toString("base64"), mime: XLSX_MIME };
  },
});
