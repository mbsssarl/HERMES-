/**
 * Les 36 catégories du catalogue IMPA (https://impa.services), dans l'ordre d'affichage du site.
 * Relevées le 2026-10-07. Les codes IMPA ne suivent pas de simples préfixes à 2 chiffres (ex. « Stationery »
 * commence à 111120, entre deux autres catégories) : le classement d'un produit reste donc un choix explicite
 * (menu de la fiche, ou « Classer dans… » en sélection multiple), pas une déduction du code.
 */
/**
 * Catégorie automatique des produits sans code IMPA (créés à l'import ou à la main sans code) : ils ne
 * peuvent pas être rattachés au catalogue IMPA, on les regroupe ici (voir products.insertProduct).
 */
export const NO_IMPA_CATEGORY = "No IMPA";

export const IMPA_CATEGORIES = [
  "Provisions",
  "Whisky & Cigarettes",
  "Welfare Items",
  "Cloth & Linen Products",
  "Tableware & Galley Utensils",
  "Clothing",
  "Rope & Hawsers",
  "Rigging Equipment & General Deck Items",
  "Marine Paint",
  "Painting Equipment",
  "Safety Protection Gear",
  "Safety Equipment",
  "Hose & Couplings",
  "Nautical Equipment",
  "Medicine",
  "Petroleum Products",
  "Stationery",
  "Hardware",
  "Brushes & Mats",
  "Lavatory Equipment",
  "Cleaning Material & Chemicals",
  "Pneumatic & Electrical Tools",
  "Hand Tools",
  "Cutting Tools",
  "Measuring Tools",
  "Metal Sheets, Bars, Etc",
  "Screws & Nuts",
  "Pipes & Tubes",
  "Pipe & Tube Fittings",
  "Valves & Cocks",
  "Bearings",
  "Electrical Equipment",
  "Packing & Jointing",
  "Welding Equipment",
  "Machinery Items",
  "Fishing Tools",
];
