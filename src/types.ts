export type QuotationStatus =
  | 'DRAFT'
  | 'PROCESSING'
  | 'AWAITING_SUPPLIER'
  | 'PO'
  | 'DELETED'
  | 'REVIEW_REQUIRED'
  | 'READY'
  | 'EXPORTED'
  | 'SENT'
  | 'CANCELLED';

export type MatchStatus = 'MATCHED' | 'REVIEW' | 'NOT_FOUND';

export interface Country {
  id: string;
  code: string;
  name: string;
  currency: string;
  active: boolean;
}

export interface Product {
  id: string;
  reference: string;
  name: string;
  description: string | null;
  unit: string;
  category: string;
  active: boolean;
}

export interface ProductPrice {
  id: string;
  product_id: string;
  country_id: string;
  base_price: number;
  currency: string;
}

export interface QuotationItem {
  id: string;
  quotation_id: string;
  product_id: string | null;
  original_description: string;
  quantity: number;
  base_price: number | null;
  margin_percentage: number;
  final_unit_price: number | null;
  total_price: number | null;
  match_status: MatchStatus;
  match_score: number | null;
  // Champs ajoutés par la jointure Convex (absents du modèle Supabase d'origine)
  line_no: number;
  excluded: boolean;
  raw_code: string | null;
  raw_quantity: number | null;
  unit: string | null;
  origin: string | null;
  req_notes: string;
  enq_notes: string;
  unit_price: number | null; // prix unitaire retenu (catalogue + cotation, ou prix manuel), avant remise
  unit_price_manual: number | null; // prix saisi à la main / lu dans le fichier client
  line_discount_percent: number;
  candidate_products: Product[];
}

export interface QuotationWithRelations {
  id: string;
  quotation_number: string;
  customer_name: string;
  customer_email: string | null;
  country_id: string | null;
  source_file_name: string | null;
  status: QuotationStatus;
  margin_percentage: number;
  total: number;
  created_at: string;
  document_info: DocumentInfo;
  vessel: string | null;
  eta: string | null;
  supply_place: string | null;
  client_order_number: string | null;
  quotation_percent_override: number | null;
  global_discount_percent: number | null;
  item_count: number;
  unresolved_count: number; // lignes cochées encore inconnues ou à confirmer
  countries: Pick<Country, 'id' | 'code' | 'name' | 'currency'> | null;
  quotation_items: QuotationItem[];
}

export interface ProductWithPrices extends Product {
  product_prices: ProductPrice[];
}

/** En-tête du document client (hors tableau), conservé dans orders.documentInfo. */
export interface DocumentInfo {
  issuer?: string;
  instructions?: string;
  enquiryDate?: string;
  enquiryTo?: string;
  replyBy?: string;
  imoNo?: string;
  country?: string;
  category?: string;
  department?: string;
  vendorRef?: string;
  paymentDays?: string;
  currency?: string;
}

export interface AppUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
}
