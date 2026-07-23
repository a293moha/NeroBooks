-- 0009_customers_vendors

CREATE TABLE customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name              text NOT NULL,
  company_name      text,
  email             citext,
  phone             text,
  billing_line1     text,
  billing_city      text,
  billing_state     text,
  billing_postal_code text,
  billing_country_code char(2) CHECK (billing_country_code ~ '^[A-Z]{2}$'),
  default_currency  char(3) NOT NULL DEFAULT 'USD' CHECK (default_currency ~ '^[A-Z]{3}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

COMMENT ON TABLE customers IS
  'Soft-deleted only: historical invoices/payments must keep referencing a valid customer row even after the customer relationship ends.';

CREATE INDEX idx_customers_company ON customers (company_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_customers_company_email ON customers (company_id, email) WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vendors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name              text NOT NULL,
  email             citext,
  phone             text,
  category          text,
  default_currency  char(3) NOT NULL DEFAULT 'USD' CHECK (default_currency ~ '^[A-Z]{3}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

COMMENT ON TABLE vendors IS
  'Soft-deleted only: historical expenses must keep referencing a valid vendor row even after the vendor relationship ends.';

CREATE INDEX idx_vendors_company ON vendors (company_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_vendors_company_email ON vendors (company_id, email) WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_vendors_set_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
