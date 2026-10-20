"use node";

import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PAGE_SIZE = 1500;
/** Le fichier temporaire est supprimé du stockage après ce délai (le navigateur le télécharge aussitôt). */
const TEMP_FILE_TTL_MS = 15 * 60 * 1000;

interface CatalogExportResult { url: string; fileName: string; products: number; priced: number }

/**
 * Exporte TOUT le catalogue de l'entreprise (produits et prix en vigueur) dans un fichier Excel : une ligne par produit,
 * puis deux colonnes (prix, devise) par région qui a au moins un prix. Réservé aux administrateurs.
 * Le fichier peut peser plusieurs Mo (le catalogue compte des dizaines de milliers d'articles) : il est déposé dans le
 * stockage et l'action renvoie son adresse, pas son contenu.
 */
export const exportCatalogXlsx = action({
  args: {},
  handler: async (ctx): Promise<CatalogExportResult> => {
    const user = await ctx.runQuery(api.users.getBusinessUser, {});
    if (!user || user.role !== "admin" || !user.companyId) throw new Error("Action réservée aux administrateurs.");
    return await buildCatalogExport(ctx, user.companyId);
  },
});

/** Même export, lancé depuis le terminal pour une entreprise donnée (vérification, dépannage) : `npx convex run productExport:exportForCompany`. */
export const exportForCompany = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }): Promise<CatalogExportResult> => await buildCatalogExport(ctx, companyId),
});

async function buildCatalogExport(ctx: ActionCtx, companyId: Id<"companies">): Promise<CatalogExportResult> {
  {

    // --- lecture page par page
    type ProductRow = { id: Id<"products">; code: string; name: string; description: string; unit: string; category: string };
    const products: ProductRow[] = [];
    for (let cursor: string | null = null; ; ) {
      const page: { page: ProductRow[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.productExportData.productsPage, {
        companyId,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      });
      products.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    type PriceRow = { productId: Id<"products">; countryId: Id<"countries">; price: number; currency: string };
    const prices: PriceRow[] = [];
    for (let cursor: string | null = null; ; ) {
      const page: { page: PriceRow[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.productExportData.currentPricesPage, {
        companyId,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      });
      prices.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    const countries = await ctx.runQuery(internal.productExportData.countriesOf, { companyId });
    // Seules les régions qui ont au moins un prix en vigueur reçoivent des colonnes.
    const pricedCountryIds = new Set(prices.map((p) => p.countryId));
    const columnsCountries = countries.filter((c) => pricedCountryIds.has(c.id));
    const pricesByProduct = new Map<string, Map<string, PriceRow>>();
    for (const p of prices) {
      const byCountry = pricesByProduct.get(p.productId) ?? new Map<string, PriceRow>();
      byCountry.set(p.countryId, p);
      pricesByProduct.set(p.productId, byCountry);
    }

    // --- classeur, écrit en flux : un grand catalogue (plus de 50 000 lignes) ne tiendrait pas en mémoire autrement
    const priceFormat = "#,##0.00"; // les prix s'affichent toujours avec 2 décimales
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on("data", (chunk: Buffer) => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useStyles: true, useSharedStrings: false });
    const columnCount = 5 + columnsCountries.length * 2;
    // Le filtre automatique est accepté à l'exécution mais absent des types du mode flux d'ExcelJS : d'où le cast.
    const ws = workbook.addWorksheet("Produits et prix", {
      views: [{ state: "frozen", ySplit: 1 }],
      autoFilter: { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } },
    } as unknown as Partial<ExcelJS.AddWorksheetOptions>);
    ws.columns = [
      { header: "Code IMPA / interne", key: "code", width: 20 },
      { header: "Désignation", key: "name", width: 60 },
      { header: "Description", key: "description", width: 40 },
      { header: "Unité", key: "unit", width: 10 },
      { header: "Catégorie", key: "category", width: 30 },
      ...columnsCountries.flatMap((c) => [
        { header: `Prix ${c.code}`, key: `price_${c.code}`, width: 14, style: { numFmt: priceFormat } },
        { header: `Devise ${c.code}`, key: `currency_${c.code}`, width: 10 },
      ]),
    ];
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3ECB9" } };
    header.commit();
    for (const p of products) {
      const byCountry = pricesByProduct.get(p.id);
      const row: (string | number | null)[] = [p.code, p.name, p.description, p.unit, p.category];
      for (const c of columnsCountries) {
        const price = byCountry?.get(c.id);
        row.push(price ? price.price : null, price ? price.currency : null);
      }
      ws.addRow(row).commit();
    }
    await ws.commit();
    await workbook.commit();
    const buffer = Buffer.concat(chunks);
    const storageId = await ctx.storage.store(new Blob([Uint8Array.from(buffer)], { type: XLSX_MIME }));
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Le fichier n'a pas pu être préparé.");
    await ctx.scheduler.runAfter(TEMP_FILE_TTL_MS, internal.productExportData.deleteTempFile, { storageId });

    const brand = await ctx.runQuery(api.branding.get, {});
    const brandFile = brand.name.replace(/[\\/:*?"<>|]/g, " ").trim() || "catalogue";
    const day = new Date().toISOString().slice(0, 10);
    return { url, fileName: `${brandFile} - Produits et prix ${day}.xlsx`, products: products.length, priced: pricesByProduct.size };
  }
}
