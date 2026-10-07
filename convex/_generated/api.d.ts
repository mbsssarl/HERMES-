/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activityLogs from "../activityLogs.js";
import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as catalogImport from "../catalogImport.js";
import type * as clients from "../clients.js";
import type * as countries from "../countries.js";
import type * as currencies from "../currencies.js";
import type * as debugAuth from "../debugAuth.js";
import type * as emails from "../emails.js";
import type * as exchangeRates from "../exchangeRates.js";
import type * as exportData from "../exportData.js";
import type * as exportQuotation from "../exportQuotation.js";
import type * as extraction from "../extraction.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_base64 from "../lib/base64.js";
import type * as lib_brevo from "../lib/brevo.js";
import type * as lib_catalogUpdates from "../lib/catalogUpdates.js";
import type * as lib_currencyCodes from "../lib/currencyCodes.js";
import type * as lib_export_buildQuotationWorkbook from "../lib/export/buildQuotationWorkbook.js";
import type * as lib_export_fillClientWorkbook from "../lib/export/fillClientWorkbook.js";
import type * as lib_export_templateData from "../lib/export/templateData.js";
import type * as lib_extraction_columnMapping from "../lib/extraction/columnMapping.js";
import type * as lib_extraction_documentMetadata from "../lib/extraction/documentMetadata.js";
import type * as lib_extraction_excel from "../lib/extraction/excel.js";
import type * as lib_extraction_parseFile from "../lib/extraction/parseFile.js";
import type * as lib_extraction_pdf from "../lib/extraction/pdf.js";
import type * as lib_extraction_word from "../lib/extraction/word.js";
import type * as lib_impaCategories from "../lib/impaCategories.js";
import type * as lib_matching from "../lib/matching.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_pdf_quotationPdf from "../lib/pdf/quotationPdf.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_productAliases from "../lib/productAliases.js";
import type * as lib_productPricing from "../lib/productPricing.js";
import type * as lib_stringSimilarity from "../lib/stringSimilarity.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as orderItems from "../orderItems.js";
import type * as orders from "../orders.js";
import type * as productBackups from "../productBackups.js";
import type * as productCategories from "../productCategories.js";
import type * as productPrices from "../productPrices.js";
import type * as products from "../products.js";
import type * as quotationGeneration from "../quotationGeneration.js";
import type * as quotations from "../quotations.js";
import type * as settings from "../settings.js";
import type * as supplierItems from "../supplierItems.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityLogs: typeof activityLogs;
  admin: typeof admin;
  auth: typeof auth;
  catalogImport: typeof catalogImport;
  clients: typeof clients;
  countries: typeof countries;
  currencies: typeof currencies;
  debugAuth: typeof debugAuth;
  emails: typeof emails;
  exchangeRates: typeof exchangeRates;
  exportData: typeof exportData;
  exportQuotation: typeof exportQuotation;
  extraction: typeof extraction;
  files: typeof files;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/base64": typeof lib_base64;
  "lib/brevo": typeof lib_brevo;
  "lib/catalogUpdates": typeof lib_catalogUpdates;
  "lib/currencyCodes": typeof lib_currencyCodes;
  "lib/export/buildQuotationWorkbook": typeof lib_export_buildQuotationWorkbook;
  "lib/export/fillClientWorkbook": typeof lib_export_fillClientWorkbook;
  "lib/export/templateData": typeof lib_export_templateData;
  "lib/extraction/columnMapping": typeof lib_extraction_columnMapping;
  "lib/extraction/documentMetadata": typeof lib_extraction_documentMetadata;
  "lib/extraction/excel": typeof lib_extraction_excel;
  "lib/extraction/parseFile": typeof lib_extraction_parseFile;
  "lib/extraction/pdf": typeof lib_extraction_pdf;
  "lib/extraction/word": typeof lib_extraction_word;
  "lib/impaCategories": typeof lib_impaCategories;
  "lib/matching": typeof lib_matching;
  "lib/normalize": typeof lib_normalize;
  "lib/pdf/quotationPdf": typeof lib_pdf_quotationPdf;
  "lib/permissions": typeof lib_permissions;
  "lib/pricing": typeof lib_pricing;
  "lib/productAliases": typeof lib_productAliases;
  "lib/productPricing": typeof lib_productPricing;
  "lib/stringSimilarity": typeof lib_stringSimilarity;
  "lib/tokens": typeof lib_tokens;
  orderItems: typeof orderItems;
  orders: typeof orders;
  productBackups: typeof productBackups;
  productCategories: typeof productCategories;
  productPrices: typeof productPrices;
  products: typeof products;
  quotationGeneration: typeof quotationGeneration;
  quotations: typeof quotations;
  settings: typeof settings;
  supplierItems: typeof supplierItems;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
