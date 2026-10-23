// Repères disponibles dans un modèle d'export (voir templateEngine.ts). Fichier sans dépendance : lu aussi par l'interface.

export const SCALAR_TOKENS: Record<string, string> = {
  reference: "Référence de la quotation",
  date: "Date du jour",
  request_for: "Objet de la demande (ex. PROVISIONS)",
  country: "Pays",
  port: "Port de livraison",
  vessel: "Nom du navire",
  vessel_imo: "N° IMO du navire",
  eta: "ETA du navire",
  ref_no: "Référence de la demande",
  currency: "Devise du fichier",
  company_name: "Raison sociale de l'entreprise",
  company_address: "Adresse de l'entreprise",
  company_postal: "BP, ville, pays",
  company_email: "Email de l'entreprise",
  company_phones: "Téléphone(s) de l'entreprise",
  company_website: "Site web de l'entreprise",
  items_count: "Nombre d'articles",
  subtotal: "Total avant remise",
  discount_percent: "Remise globale (en %, ex. 5)",
  discount_amount: "Montant de la remise",
  transport: "Frais de livraison",
  total: "Total final",
  logo: "Logo de l'entreprise (image placée sur la cellule)",
};

export const ITEM_TOKENS: Record<string, string> = {
  item_no: "N° de ligne",
  item_code: "Code (IMPA/référence)",
  item_description: "Désignation",
  item_unit: "Unité",
  item_quantity: "Quantité",
  item_unit_price: "Prix unitaire (vide si inconnu)",
  item_total: "Total de la ligne (vide si pas de prix)",
  item_remarks: "Remarques",
};

// Repères du Purchase Order et du Delivery Note : ce sont déjà « le même document, avec ou sans prix » dans
// l'app (voir src/lib/printOrderDocument.ts) - un seul jeu de repères pour les deux ; sur un modèle de
// Delivery Note, item_unit_price/item_total restent simplement vides (aucun prix n'est transmis au rendu).
export const ORDER_SCALAR_TOKENS: Record<string, string> = {
  vessel: "Nom du navire",
  agent: "Agent (client)",
  port: "Port de livraison",
  order_no: "N° de commande du client",
  rfq_no: "N° de la demande de prix",
  supply_date: "Date de livraison (ETA)",
  category: "Catégorie",
  on_behalf_name: "Donneur d'ordre - nom",
  on_behalf_address: "Donneur d'ordre - adresse",
  currency: "Devise du fichier",
  company_name: "Raison sociale de l'entreprise",
  company_address: "Adresse de l'entreprise",
  company_postal: "BP, ville, pays",
  company_email: "Email de l'entreprise",
  company_phones: "Téléphone(s) de l'entreprise",
  company_website: "Site web de l'entreprise",
  discount_percent: "Remise globale (en %, ex. 5)",
  discount_amount: "Montant de la remise",
  subtotal: "Total avant remise",
  total: "Total final",
  logo: "Logo de l'entreprise (image placée sur la cellule)",
};

export const ORDER_ITEM_TOKENS: Record<string, string> = {
  item_no: "N° de ligne",
  item_code: "Code (IMPA/référence)",
  item_description: "Désignation",
  item_unit: "Unité",
  item_quantity: "Quantité",
  item_unit_price: "Prix unitaire (vide sur un Delivery Note)",
  item_total: "Total de la ligne (vide sur un Delivery Note)",
};

export type TemplateKind = "quotation" | "purchase_order" | "delivery_note";

export function tokensFor(kind: TemplateKind): { scalar: Record<string, string>; item: Record<string, string> } {
  return kind === "quotation" ? { scalar: SCALAR_TOKENS, item: ITEM_TOKENS } : { scalar: ORDER_SCALAR_TOKENS, item: ORDER_ITEM_TOKENS };
}
