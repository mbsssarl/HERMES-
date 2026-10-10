/**
 * Documents imprimables d'une commande validée, au format des documents MBSS : en-tête de l'entreprise (logo et
 * slogan) et pied de page avec les mentions légales sur chaque page, bloc d'informations (navire, agent, port...),
 * tableau des articles, puis « MASTER / MBSS SARL ». Le Purchase Order porte les prix d'achat, le Delivery Note est
 * le même document sans prix. Ouvre une fenêtre d'impression (imprimer ou « Enregistrer au format PDF »).
 */
export type OrderDocumentKind = 'purchase' | 'delivery';

export interface OrderDocumentInfo {
  vessel: string;
  agent: string;
  port: string;
  orderNo: string;
  rfqNo: string;
  supplyDate: string; // AAAA-MM-JJ
  category: string;
  /** Nom (1re ligne) puis adresse (lignes suivantes) du donneur d'ordre. */
  onBehalf: string;
}

export interface OrderDocumentLine {
  no: number;
  description: string;
  code: string;
  unit: string;
  quantity: number | null;
  /** Prix unitaire d'achat (Purchase Order uniquement). */
  unitPrice: number | null;
}

const LETTERHEAD = [
  '<b>MARINI AND BRICE SHIPCHANDLER SUPPLIER S.A.R.L.</b>',
  'Company N°: RC/DLA/2015/B/3937 – Tax payer N°: MO91514946931Y –',
  'SGC / IBAN: CM21 10003 01900 06191305311 74',
  'Tel: +237 679 69 38 05 - Email 1: <u>christinedemanga@yahoo.fr</u> - Email 2 : <u>mbss.sarl.2015@gmail.com</u>',
  'Headquarters: 533 rue Charley EYOUM EBELLE – Deido – PO BOX: 3057 – Douala – CAMEROON',
  'Douala Authorized Shipchandler N°: 4398-20 DG/PAD - Kribi Authorized Shipchandler N°:',
  '0339L/23/PAK/DG/DEX/DpDSC/SACO/afd',
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const qty = (n: number | null) => (n === null ? '' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n));

function formatSupplyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
}

export function buildOrderDocumentHtml(opts: {
  kind: OrderDocumentKind;
  info: OrderDocumentInfo;
  lines: OrderDocumentLine[];
  currency: string;
  imageUrl: string;
  /** Remise (%) appliquée au total du Purchase Order ; 0 ou absente = aucune. */
  discountPercent?: number;
}): string {
  const { kind, info, lines, currency, imageUrl, discountPercent = 0 } = opts;
  const withPrices = kind === 'purchase';
  const title = withPrices ? 'PURCHASE ORDER MBSS SARL' : 'DELIVERY NOTE MBSS SARL';

  const [onBehalfName = '', ...onBehalfAddress] = info.onBehalf.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const infoRows: [string, string, boolean?][] = [
    ['VESSEL NAME', info.vessel],
    ['AGENT', info.agent],
    ['DELIVERY PORT', info.port],
    ['ORDER NO', info.orderNo],
    ['RFQ N°', info.rfqNo],
    ['SUPPLY DATE', info.supplyDate ? formatSupplyDate(info.supplyDate) : ''],
    ['CATEGORY', info.category, true],
  ];

  const total = lines.reduce((sum, l) => sum + (l.unitPrice !== null && l.quantity !== null ? Math.round(l.unitPrice * l.quantity * 100) / 100 : 0), 0);
  // Total du Purchase Order : sans remise, une ligne ; avec remise, sous-total, remise et total net.
  const discountAmount = Math.round(total * discountPercent) / 100;
  const totalRows =
    discountPercent > 0
      ? `<tr class="total"><td colspan="6" class="r">SUBTOTAL ${esc(currency)}</td><td class="r">${money(total)}</td></tr>
          <tr class="total"><td colspan="6" class="r">DISCOUNT ${discountPercent}%</td><td class="r">-${money(discountAmount)}</td></tr>
          <tr class="total"><td colspan="6" class="r">TOTAL NET ${esc(currency)}</td><td class="r">${money(Math.round((total - discountAmount) * 100) / 100)}</td></tr>`
      : `<tr class="total"><td colspan="6" class="r">TOTAL ${esc(currency)}</td><td class="r">${money(total)}</td></tr>`;
  const rows = lines
    .map(
      (l) => `<tr>
        <td class="c">${l.no}</td>
        <td>${esc(l.description)}</td>
        <td>${esc(l.code)}</td>
        <td class="c">${esc(l.unit)}</td>
        <td class="r">${qty(l.quantity)}</td>
        ${
          withPrices
            ? `<td class="r">${l.unitPrice === null ? '' : money(l.unitPrice)}</td>
               <td class="r">${l.unitPrice === null || l.quantity === null ? '' : money(Math.round(l.unitPrice * l.quantity * 100) / 100)}</td>`
            : ''
        }
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}${info.vessel ? ' - ' + esc(info.vessel) : ''}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .hdr { position: fixed; top: 0; left: 0; right: 0; height: 36mm; }
  .hdr img { position: absolute; right: 12mm; top: 7mm; width: 92mm; height: auto; }
  .ftr { position: fixed; bottom: 6mm; left: 12mm; right: 12mm; border-top: 2px solid #2f80d6; padding-top: 3mm;
         text-align: center; font-family: "Cambria", "Times New Roman", serif; font-style: italic; font-size: 8pt; line-height: 1.45; color: #3a6fc4; }
  table.page { width: 100%; border-collapse: collapse; }
  table.page > thead > tr > td { height: 38mm; padding: 0; }
  table.page > tfoot > tr > td { height: 44mm; padding: 0; }
  table.page > tbody > tr > td { padding: 0 12mm; }
  .info { display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 7mm; }
  .info table td { padding: 1px 12px 1px 0; font-size: 10.5pt; vertical-align: top; }
  .info table td.v { font-weight: 700; }
  .info table td.v.green { color: #2e9a2e; }
  .behalf { width: 80mm; }
  .behalf .t { font-weight: 700; font-size: 10.5pt; }
  .behalf .n { font-weight: 700; font-size: 14pt; margin: 3mm 0 2mm; }
  .behalf .a { font-weight: 700; font-size: 10pt; line-height: 1.35; }
  h1 { text-align: center; font-family: "Times New Roman", serif; font-size: 14pt; text-decoration: underline; margin: 4mm 0 5mm; font-weight: 700; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { background: #92d050; border: 1px solid #555; padding: 3px 5px; font-size: 9.5pt; text-align: center; }
  table.items td { border: 1px solid #555; padding: 2px 5px; font-size: 9.5pt; vertical-align: middle; }
  table.items tr { page-break-inside: avoid; }
  .c { text-align: center; } .r { text-align: right; }
  .total td { font-weight: 700; background: #f2f2f2; }
  .sign { display: flex; justify-content: space-between; margin: 6mm 12mm 0 12mm; font-family: "Cambria", "Times New Roman", serif; font-weight: 700; text-decoration: underline; font-size: 11pt; }
</style></head>
<body>
  <div class="hdr"><img src="${esc(imageUrl)}" alt="M.B.S.S Sarl"></div>
  <div class="ftr">${LETTERHEAD.join('<br>')}</div>
  <table class="page">
    <thead><tr><td></td></tr></thead>
    <tfoot><tr><td></td></tr></tfoot>
    <tbody><tr><td>
      <div class="info">
        <table>${infoRows.map(([k, v, green]) => `<tr><td>${k}</td><td class="v${green ? ' green' : ''}">${esc(v)}</td></tr>`).join('')}</table>
        <div class="behalf">
          <div class="t">ON BEHALF</div>
          <div class="n">${esc(onBehalfName)}</div>
          <div class="a">${onBehalfAddress.map(esc).join('<br>')}</div>
        </div>
      </div>
      <h1>${esc(title)}</h1>
      <table class="items">
        <thead><tr>
          <th style="width:9mm">No.</th><th>DESCRIPTION</th><th style="width:24mm">Item Code /<br>Part No.</th><th style="width:20mm">UoM</th><th style="width:17mm">QTY REQ</th>
          ${withPrices ? `<th style="width:26mm">UNIT PRICE<br>${esc(currency)}</th><th style="width:28mm">TOTAL<br>${esc(currency)}</th>` : ''}
        </tr></thead>
        <tbody>
          ${rows}
          ${withPrices ? totalRows : ''}
        </tbody>
      </table>
      <div class="sign"><span>MASTER</span><span>MBSS SARL</span></div>
    </td></tr></tbody>
  </table>
  <script>window.onload = function () { setTimeout(function () { window.focus(); window.print(); }, 400); };</script>
</body></html>`;
}

/** Ouvre le document dans un nouvel onglet et lance l'impression. Renvoie false si le navigateur a bloqué la fenêtre. */
export function printOrderDocument(opts: Omit<Parameters<typeof buildOrderDocumentHtml>[0], 'imageUrl'>): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(buildOrderDocumentHtml({ ...opts, imageUrl: `${window.location.origin}/mbss-header.png` }));
  win.document.close();
  return true;
}
