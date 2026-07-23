-- 0013_banking

CREATE TABLE bank_accounts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name                      text NOT NULL,
  bank_name                 text,
  account_number_encrypted  text,
  account_number_last4      char(4),
  routing_number_encrypted  text,
  currency                  char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  chart_of_account_id       uuid REFERENCES chart_of_accounts (id),
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz
);

COMMENT ON TABLE bank_accounts IS
  'A company''s own bank account (distinct from employee_bank_accounts, which are for paying employees). chart_of_account_id links it to its GL cash account. Same encryption approach as employee_bank_accounts for the account/routing numbers.';

CREATE INDEX idx_bank_accounts_company ON bank_accounts (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bank_accounts_gl_account ON bank_accounts (chart_of_account_id);

CREATE TRIGGER trg_bank_accounts_set_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bank_transactions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  bank_account_id        uuid NOT NULL REFERENCES bank_accounts (id),
  transaction_date       date NOT NULL,
  description            text,
  amount                 numeric(19,4) NOT NULL,
  balance_after          numeric(19,4),
  reconciled             boolean NOT NULL DEFAULT false,
  matched_journal_entry_id uuid REFERENCES journal_entries (id),
  external_transaction_id text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bank_transactions IS
  'amount follows the bank-feed sign convention: positive = deposit, negative = withdrawal. external_transaction_id is the dedupe key from a bank-feed integration (e.g. Plaid) to make repeated imports idempotent. Immutable once reconciled — see trg_bank_transactions_immutable.';

CREATE INDEX idx_bank_transactions_account ON bank_transactions (bank_account_id, transaction_date);
CREATE INDEX idx_bank_transactions_company ON bank_transactions (company_id);
CREATE INDEX idx_bank_transactions_journal_entry ON bank_transactions (matched_journal_entry_id);
CREATE UNIQUE INDEX idx_bank_transactions_external_id
  ON bank_transactions (bank_account_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

CREATE TRIGGER trg_bank_transactions_set_updated_at
  BEFORE UPDATE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_bank_transactions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.reconciled THEN
      RAISE EXCEPTION 'bank_transactions %: cannot delete a reconciled transaction.', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.reconciled THEN
    IF NEW.amount            IS DISTINCT FROM OLD.amount
       OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
       OR NEW.bank_account_id  IS DISTINCT FROM OLD.bank_account_id
    THEN
      RAISE EXCEPTION 'bank_transactions %: amount/date/account are locked once reconciled.', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_transactions_immutable
  BEFORE UPDATE OR DELETE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION check_bank_transactions_immutable();
