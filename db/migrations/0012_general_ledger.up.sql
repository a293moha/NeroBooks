-- 0012_general_ledger

CREATE TABLE chart_of_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code               text NOT NULL,
  name               text NOT NULL,
  account_type       text NOT NULL
                        CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  parent_account_id  uuid REFERENCES chart_of_accounts (id),
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE (company_id, code)
);

COMMENT ON TABLE chart_of_accounts IS
  'Self-referencing parent_account_id supports a sub-account hierarchy (e.g. 1000 Cash > 1010 Checking). An account referenced by any journal_entry_lines can never be hard-deleted, and cannot be soft-deleted either while it has posted activity — deactivate via is_active instead. Balances are never stored here; compute from journal_entry_lines (see docs/database-schema.md).';

CREATE INDEX idx_chart_of_accounts_company ON chart_of_accounts (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_chart_of_accounts_parent ON chart_of_accounts (parent_account_id);
CREATE INDEX idx_chart_of_accounts_type ON chart_of_accounts (company_id, account_type) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_chart_of_accounts_set_updated_at
  BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE journal_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  entry_date   date NOT NULL,
  reference    text,
  description  text,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
  source_type  text,
  source_id    uuid,
  posted_by    uuid REFERENCES users (id),
  posted_at    timestamptz,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE journal_entries IS
  'The core double-entry ledger. source_type/source_id are an application-enforced polymorphic reference to whatever generated this entry (an invoice, payment, payroll_run, or a manual entry) — not a DB foreign key, since it can point to different tables. Once posted, an entry is permanently immutable: no UPDATE, no DELETE, ever (see trg_journal_entries_immutable). A mistake in a posted entry is corrected only by posting a new reversing entry, matching standard accounting practice — see docs/database-schema.md.';
COMMENT ON COLUMN journal_entries.status IS
  'draft entries may still be edited or deleted freely. void applies only to an abandoned draft that never got posted; a posted entry is never voided in place — it is reversed by a new entry instead.';

CREATE INDEX idx_journal_entries_company ON journal_entries (company_id);
CREATE INDEX idx_journal_entries_date ON journal_entries (company_id, entry_date);
CREATE INDEX idx_journal_entries_source ON journal_entries (source_type, source_id);
CREATE INDEX idx_journal_entries_status ON journal_entries (company_id, status);

CREATE TRIGGER trg_journal_entries_set_updated_at
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE journal_entry_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  journal_entry_id  uuid NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES chart_of_accounts (id),
  debit             numeric(19,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit            numeric(19,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit = 0 AND credit > 0) OR (debit > 0 AND credit = 0))
);

COMMENT ON TABLE journal_entry_lines IS
  'Each line is either a debit or a credit, never both/neither (see CHECK constraint). The parent journal_entry''s trigger validates that SUM(debit) = SUM(credit) across all of its lines at the moment it is posted. ON DELETE CASCADE from journal_entries only ever fires while the parent is still a draft, because a posted parent cannot be deleted (see trg_journal_entries_immutable) — so this cascade never touches posted financial history.';

CREATE INDEX idx_journal_entry_lines_company ON journal_entry_lines (company_id);
CREATE INDEX idx_journal_entry_lines_entry ON journal_entry_lines (journal_entry_id);
CREATE INDEX idx_journal_entry_lines_account ON journal_entry_lines (account_id);

CREATE TRIGGER trg_journal_entry_lines_set_updated_at
  BEFORE UPDATE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Immutability + the balanced-books guarantee. Both concerns live on the
-- journal_entries trigger because "is it allowed to post" and "is it allowed
-- to change after posting" are two checks on the same status transition.
CREATE FUNCTION check_journal_entry_immutable() RETURNS trigger AS $$
DECLARE
  total_debit numeric(19,4);
  total_credit numeric(19,4);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION
        'journal_entries %: a posted entry can never be deleted. Post a reversing entry instead.', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION
      'journal_entries %: this entry is posted and permanently immutable. Post a reversing entry to correct it.',
      OLD.id;
  END IF;

  IF NEW.status = 'posted' AND OLD.status <> 'posted' THEN
    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0)
      INTO total_debit, total_credit
      FROM journal_entry_lines WHERE journal_entry_id = OLD.id;

    IF total_debit <> total_credit THEN
      RAISE EXCEPTION
        'journal_entries %: cannot post an unbalanced entry (debits % <> credits %).',
        OLD.id, total_debit, total_credit;
    END IF;

    IF total_debit = 0 THEN
      RAISE EXCEPTION 'journal_entries %: cannot post an entry with no lines.', OLD.id;
    END IF;

    NEW.posted_at := coalesce(NEW.posted_at, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION check_journal_entry_immutable();

CREATE FUNCTION check_journal_entry_lines_immutable() RETURNS trigger AS $$
DECLARE
  parent_status text;
  parent_id uuid;
BEGIN
  parent_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT status INTO parent_status FROM journal_entries WHERE id = parent_id;

  IF parent_status = 'posted' THEN
    RAISE EXCEPTION
      'journal_entry_lines: parent journal_entry % is posted; its lines are permanently immutable.',
      parent_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entry_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION check_journal_entry_lines_immutable();
