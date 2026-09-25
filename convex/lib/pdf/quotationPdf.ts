"use node";

import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { createElement as h } from "react";

export interface QuotationPdfLine {
  code?: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  finalPrice: number;
  total: number;
}

export interface QuotationPdfData {
  reference: string;
  date: string;
  clientName: string;
  clientAddress?: string;
  companyName: string;
  companyAddress?: string;
  companyEmail?: string;
  vessel?: string;
  eta?: string;
  supplyPlace?: string;
  lines: QuotationPdfLine[];
  grandTotal: number;
  currency: string;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  companyBlock: { maxWidth: 260 },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  small: { fontSize: 9, color: "#444" },
  section: { marginBottom: 14 },
  table: { display: "flex", width: "100%", borderTop: "1px solid #ccc" },
  tableRow: { flexDirection: "row", borderBottom: "1px solid #eee", paddingVertical: 4 },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottom: "1px solid #333",
    paddingVertical: 4,
    fontWeight: 700,
  },
  colCode: { width: "10%" },
  colDescription: { width: "34%" },
  colUnit: { width: "8%" },
  colQty: { width: "8%", textAlign: "right" },
  colPrice: { width: "12%", textAlign: "right" },
  colDiscount: { width: "10%", textAlign: "right" },
  colTotal: { width: "18%", textAlign: "right" },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 12 },
  totalLabel: { fontSize: 11, fontWeight: 700, marginRight: 12 },
  totalValue: { fontSize: 11, fontWeight: 700 },
});

function formatMoney(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function buildShippingInfo(data: QuotationPdfData) {
  const parts: string[] = [];
  if (data.vessel) parts.push(`Navire : ${data.vessel}`);
  if (data.eta) parts.push(`ETA : ${data.eta}`);
  if (data.supplyPlace) parts.push(`Port : ${data.supplyPlace}`);
  if (parts.length === 0) return null;
  return h(Text, { style: { fontSize: 9, color: "#444" } }, parts.join("   ·   "));
}

function buildDocument(data: QuotationPdfData) {
  return h(
    Document,
    {},
    h(
      Page,
      { size: "A4", style: styles.page },
      h(
        View,
        { style: styles.headerRow },
        h(
          View,
          { style: styles.companyBlock },
          h(Text, { style: styles.title }, data.companyName),
          data.companyAddress ? h(Text, { style: styles.small }, data.companyAddress) : null,
          data.companyEmail ? h(Text, { style: styles.small }, data.companyEmail) : null,
        ),
        h(
          View,
          {},
          h(Text, { style: styles.title }, `Quotation ${data.reference}`),
          h(Text, { style: styles.small }, `Date : ${data.date}`),
        ),
      ),
      h(
        View,
        { style: styles.section },
        h(Text, { style: { fontWeight: 700, marginBottom: 2 } }, "Client"),
        h(Text, {}, data.clientName),
        data.clientAddress ? h(Text, { style: styles.small }, data.clientAddress) : null,
        buildShippingInfo(data),
      ),
      h(
        View,
        { style: styles.table },
        h(
          View,
          { style: styles.tableHeaderRow },
          h(Text, { style: styles.colCode }, "Code"),
          h(Text, { style: styles.colDescription }, "Description"),
          h(Text, { style: styles.colUnit }, "Unit"),
          h(Text, { style: styles.colQty }, "Qty"),
          h(Text, { style: styles.colPrice }, "Unit price"),
          h(Text, { style: styles.colDiscount }, "Disc. %"),
          h(Text, { style: styles.colTotal }, "Total"),
        ),
        ...data.lines.map((line, index) =>
          h(
            View,
            { style: styles.tableRow, key: index },
            h(Text, { style: styles.colCode }, line.code ?? ""),
            h(Text, { style: styles.colDescription }, line.description),
            h(Text, { style: styles.colUnit }, line.unit),
            h(Text, { style: styles.colQty }, String(line.quantity)),
            h(Text, { style: styles.colPrice }, formatMoney(line.unitPrice, data.currency)),
            h(Text, { style: styles.colDiscount }, line.discountPercent ? `${line.discountPercent}%` : "-"),
            h(Text, { style: styles.colTotal }, formatMoney(line.total, data.currency)),
          ),
        ),
      ),
      h(
        View,
        { style: styles.totalRow },
        h(Text, { style: styles.totalLabel }, "Grand total"),
        h(Text, { style: styles.totalValue }, formatMoney(data.grandTotal, data.currency)),
      ),
    ),
  );
}

export async function renderQuotationPdf(data: QuotationPdfData): Promise<Buffer> {
  const instance = pdf(buildDocument(data));
  const result = await instance.toBuffer();
  return await streamToBuffer(result as unknown as NodeJS.ReadableStream | Buffer);
}

function streamToBuffer(source: NodeJS.ReadableStream | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(source)) return Promise.resolve(source);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    source.on("data", (chunk: Buffer) => chunks.push(chunk));
    source.on("end", () => resolve(Buffer.concat(chunks)));
    source.on("error", reject);
  });
}
