/*
# Create the quotation MVP data model

1. New tables
- `countries` stores delivery countries and their default currency.
- `products` stores the company product catalogue.
- `product_aliases` stores alternate customer descriptions.
- `product_prices` stores country-specific base prices.
- `quotations` stores imported quotation requests and their workflow status.
- `quotation_items` stores each requested line, including unmatched lines and frozen calculated prices.

2. Data integrity
- Foreign keys connect prices and quotation lines to their parent records.
- Product references and country codes are unique.
- Quotation line prices are nullable so unknown products remain visible for review.

3. Security
- Row level security is enabled on every table.
- This first single-tenant MVP intentionally allows anonymous and authenticated users to manage the shared catalogue and quotations.

4. Important notes
- This migration does not create authentication or user ownership columns because the current MVP has no sign-in screen.
- Existing quotation lines retain their original calculated values when catalogue prices change later.
*/

CREATE TABLE IF NOT EXISTS countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  unit text NOT NULL DEFAULT 'PCS',
  category text NOT NULL DEFAULT 'General',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, alias)
);

CREATE TABLE IF NOT EXISTS product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  base_price numeric(12,2) NOT NULL CHECK (base_price >= 0),
  currency text NOT NULL,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, country_id)
);

CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number text NOT NULL UNIQUE,
  customer_name text NOT NULL,
  customer_email text,
  country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
  source_file_name text,
  status text NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK (status IN ('DRAFT','PROCESSING','REVIEW_REQUIRED','READY','EXPORTED','SENT','CANCELLED')),
  margin_percentage numeric(5,2) NOT NULL DEFAULT 30,
  total numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  original_description text NOT NULL,
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  base_price numeric(12,2),
  margin_percentage numeric(5,2) NOT NULL DEFAULT 30,
  final_unit_price numeric(12,2),
  total_price numeric(12,2),
  match_status text NOT NULL DEFAULT 'NOT_FOUND' CHECK (match_status IN ('MATCHED','REVIEW','NOT_FOUND')),
  match_score numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_prices_country_idx ON product_prices(country_id);
CREATE INDEX IF NOT EXISTS quotation_items_quotation_idx ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS quotations_created_at_idx ON quotations(created_at DESC);

ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shared countries select" ON countries;
CREATE POLICY "shared countries select" ON countries FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared countries insert" ON countries;
CREATE POLICY "shared countries insert" ON countries FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared countries update" ON countries;
CREATE POLICY "shared countries update" ON countries FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared countries delete" ON countries;
CREATE POLICY "shared countries delete" ON countries FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "shared products select" ON products;
CREATE POLICY "shared products select" ON products FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared products insert" ON products;
CREATE POLICY "shared products insert" ON products FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared products update" ON products;
CREATE POLICY "shared products update" ON products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared products delete" ON products;
CREATE POLICY "shared products delete" ON products FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "shared aliases select" ON product_aliases;
CREATE POLICY "shared aliases select" ON product_aliases FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared aliases insert" ON product_aliases;
CREATE POLICY "shared aliases insert" ON product_aliases FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared aliases update" ON product_aliases;
CREATE POLICY "shared aliases update" ON product_aliases FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared aliases delete" ON product_aliases;
CREATE POLICY "shared aliases delete" ON product_aliases FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "shared prices select" ON product_prices;
CREATE POLICY "shared prices select" ON product_prices FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared prices insert" ON product_prices;
CREATE POLICY "shared prices insert" ON product_prices FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared prices update" ON product_prices;
CREATE POLICY "shared prices update" ON product_prices FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared prices delete" ON product_prices;
CREATE POLICY "shared prices delete" ON product_prices FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "shared quotations select" ON quotations;
CREATE POLICY "shared quotations select" ON quotations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared quotations insert" ON quotations;
CREATE POLICY "shared quotations insert" ON quotations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared quotations update" ON quotations;
CREATE POLICY "shared quotations update" ON quotations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared quotations delete" ON quotations;
CREATE POLICY "shared quotations delete" ON quotations FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "shared quotation items select" ON quotation_items;
CREATE POLICY "shared quotation items select" ON quotation_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared quotation items insert" ON quotation_items;
CREATE POLICY "shared quotation items insert" ON quotation_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared quotation items update" ON quotation_items;
CREATE POLICY "shared quotation items update" ON quotation_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared quotation items delete" ON quotation_items;
CREATE POLICY "shared quotation items delete" ON quotation_items FOR DELETE TO anon, authenticated USING (true);

INSERT INTO countries (code, name, currency) VALUES
  ('CM', 'Cameroon', 'XAF'),
  ('GA', 'Gabon', 'XAF'),
  ('FR', 'France', 'EUR'),
  ('CI', 'Côte d’Ivoire', 'XAF')
ON CONFLICT (code) DO NOTHING;

INSERT INTO products (reference, name, description, unit, category) VALUES
  ('PRD-001', 'Safety Helmet', 'Industrial protective helmet', 'PCS', 'PPE'),
  ('PRD-002', 'Safety Shoes', 'Protective work shoes', 'PAIR', 'PPE'),
  ('PRD-003', 'Protective Gloves', 'Cut-resistant protective gloves', 'PAIR', 'PPE'),
  ('PRD-004', 'Fire Extinguisher', 'Portable powder fire extinguisher', 'PCS', 'Fire safety'),
  ('PRD-005', 'Safety Vest', 'High visibility safety vest', 'PCS', 'PPE')
ON CONFLICT (reference) DO NOTHING;

INSERT INTO product_aliases (product_id, alias)
SELECT id, alias FROM products CROSS JOIN (VALUES
  ('PRD-001', 'Protective Helmet'), ('PRD-001', 'Hard Hat'),
  ('PRD-002', 'Protective Shoes'), ('PRD-003', 'Work Gloves'),
  ('PRD-004', 'Extinguisher'), ('PRD-005', 'Reflective Vest')
) AS aliases(reference, alias) WHERE products.reference = aliases.reference
ON CONFLICT (product_id, alias) DO NOTHING;

INSERT INTO product_prices (product_id, country_id, base_price, currency)
SELECT p.id, c.id, prices.amount, c.currency
FROM (VALUES
  ('PRD-001', 'CM', 20000::numeric), ('PRD-002', 'CM', 40000::numeric), ('PRD-003', 'CM', 5000::numeric),
  ('PRD-004', 'CM', 35000::numeric), ('PRD-005', 'CM', 7500::numeric),
  ('PRD-001', 'GA', 22000::numeric), ('PRD-002', 'GA', 43000::numeric), ('PRD-003', 'GA', 5500::numeric),
  ('PRD-001', 'FR', 20::numeric), ('PRD-002', 'FR', 40::numeric), ('PRD-003', 'FR', 5::numeric)
) AS prices(reference, code, amount)
JOIN products p ON p.reference = prices.reference
JOIN countries c ON c.code = prices.code
ON CONFLICT (product_id, country_id) DO NOTHING;

INSERT INTO quotations (quotation_number, customer_name, customer_email, country_id, source_file_name, status, margin_percentage, total)
SELECT 'QT-2026-0012', 'ABC Shipping & Logistics', 'purchasing@abc-shipping.com', id, 'quotation_request_cameroon.xlsx', 'REVIEW_REQUIRED', 30, 1365000
FROM countries WHERE code = 'CM'
ON CONFLICT (quotation_number) DO NOTHING;

INSERT INTO quotation_items (quotation_id, product_id, original_description, quantity, base_price, margin_percentage, final_unit_price, total_price, match_status, match_score)
SELECT q.id, p.id, 'Safety Helmet', 20, 20000, 30, 26000, 520000, 'MATCHED', 100
FROM quotations q JOIN products p ON p.reference = 'PRD-001' WHERE q.quotation_number = 'QT-2026-0012'
AND NOT EXISTS (SELECT 1 FROM quotation_items WHERE quotation_id = q.id AND original_description = 'Safety Helmet');
INSERT INTO quotation_items (quotation_id, product_id, original_description, quantity, base_price, margin_percentage, final_unit_price, total_price, match_status, match_score)
SELECT q.id, p.id, 'Safety Shoes', 10, 40000, 30, 52000, 520000, 'MATCHED', 100
FROM quotations q JOIN products p ON p.reference = 'PRD-002' WHERE q.quotation_number = 'QT-2026-0012'
AND NOT EXISTS (SELECT 1 FROM quotation_items WHERE quotation_id = q.id AND original_description = 'Safety Shoes');
INSERT INTO quotation_items (quotation_id, product_id, original_description, quantity, base_price, margin_percentage, final_unit_price, total_price, match_status, match_score)
SELECT q.id, p.id, 'Protective Gloves', 50, 5000, 30, 6500, 325000, 'REVIEW', 94
FROM quotations q JOIN products p ON p.reference = 'PRD-003' WHERE q.quotation_number = 'QT-2026-0012'
AND NOT EXISTS (SELECT 1 FROM quotation_items WHERE quotation_id = q.id AND original_description = 'Protective Gloves');
INSERT INTO quotation_items (quotation_id, original_description, quantity, margin_percentage, match_status)
SELECT q.id, 'Satellite Phone', 5, 30, 'NOT_FOUND'
FROM quotations q WHERE q.quotation_number = 'QT-2026-0012'
AND NOT EXISTS (SELECT 1 FROM quotation_items WHERE quotation_id = q.id AND original_description = 'Satellite Phone');
