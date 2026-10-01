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
  city: string | null; // ville/port principal, informatif
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
  // Devise dans laquelle base_price a été enregistré (productPrices.currency au moment du matching) - sert
  // de base au taux de change lors d'une conversion du fichier exporté, indépendamment par ligne.
  price_currency: string | null;
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
  total: number; // net : somme des lignes moins le discount global
  subtotal: number; // somme des lignes, avant discount global
  created_at: string;
  created_by: string | null;
  export_currency: string | null;
  // Un taux par devise d'origine réellement présente parmi les lignes (voir QuotationItem.price_currency) -
  // plusieurs lignes d'une même quotation peuvent avoir été tarifées dans des devises différentes.
  export_rates: { currency: string; rate: number; asOf: string; source: string }[];
  catalog_update: { at: number; lines: number; by: string | null } | null; // mise à jour auto après un ajout au catalogue, non vue
  document_info: DocumentInfo;
  vessel: string | null;
  eta: string | null;
  supply_place: string | null;
  client_order_number: string | null;
  quotation_percent_override: number | null;
  global_discount_percent: number | null;
  item_count: number;
  unresolved_count: number; // lignes cochées encore inconnues ou à confirmer
  countries: Pick<Country, 'id' | 'code' | 'name' | 'city'> | null;
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

export interface ProductCategory {
  id: string;
  name: string;
  active: boolean;
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface AppUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
  theme: 'light' | 'dark';
}
