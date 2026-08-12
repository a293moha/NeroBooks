import { Router } from "express";
import { withTenantContext } from "../db/context.js";
import { requireAuth, requireCompanyAccess } from "../auth/middleware.js";
import { recordAuditEntry } from "../services/auditService.js";
import { hasPermission } from "../services/permissionService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * Chart of accounts + general ledger (journal entries/lines). Split out
 * from resources.routes.ts because this domain has its own non-trivial
 * invariants (balanced double-entry, posting immutability) rather than
 * because of any different security model -- every handler here follows
 * the exact same shape as resources.routes.ts: requireCompanyAccess has
 * already turned req.params.companyId into a server-confirmed
 * req.companyId, every query is explicitly company_id-scoped on top of
 * the 0017 RLS policies, and a record from another company 404s exactly
 * like one that doesn't exist. See docs/multi-tenant-security.md.
 *
 * The DB schema (0012_general_ledger) already enforces the two rules that
 * matter most -- a journal entry can only be posted if its lines balance
 * and it isn't empty, and a posted entry (and its lines) can never be
 * changed or deleted again -- via triggers. Every handler below does the
 * same checks at the application level first (for a clean 4xx instead of
 * a raw Postgres error), then falls back to regex-matching the trigger's
 * exception text as defense in depth, exactly like invoice/expense
 * handling in resources.routes.ts already does.
 */
export const accountingRouter = Router({ mergeParams: true });
accountingRouter.use(requireAuth, requireCompanyAccess);

function notFound(res: import("express").Response): void {
  res.status(404).json({ error: "Not found." });
}

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"];

const JOURNAL_LINE_FIELDS =
  "jel.id, jel.journal_entry_id, jel.account_id, coa.code AS account_code, coa.name AS account_name, jel.debit, jel.credit, jel.description";

// ---------- Accounts ----------

accountingRouter.get(
  "/accounts",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT
           coa.id, coa.code, coa.name, coa.account_type, coa.parent_account_id, coa.is_active,
           CASE WHEN coa.account_type IN ('asset', 'expense')
                THEN COALESCE(SUM(jel.debit)  FILTER (WHERE je.status = 'posted'), 0)
                   - COALESCE(SUM(jel.credit) FILTER (WHERE je.status = 'posted'), 0)
                ELSE COALESCE(SUM(jel.credit) FILTER (WHERE je.status = 'posted'), 0)
                   - COALESCE(SUM(jel.debit)  FILTER (WHERE je.status = 'posted'), 0)
           END AS balance,
           EXISTS (
             SELECT 1 FROM bank_accounts ba
             WHERE ba.chart_of_account_id = coa.id AND ba.company_id = $1 AND ba.deleted_at IS NULL AND ba.is_active
           ) AS is_cash_account,
           EXISTS (
             SELECT 1 FROM journal_entry_lines jel2 WHERE jel2.account_id = coa.id AND jel2.company_id = $1
           ) AS has_activity
         FROM chart_of_accounts coa
         LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id AND jel.company_id = $1
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.company_id = $1
         WHERE coa.company_id = $1 AND coa.deleted_at IS NULL
         GROUP BY coa.id
         ORDER BY coa.code`,
        [req.companyId]
      )
    );
    res.json(result.rows);
  })
);

accountingRouter.post(
  "/accounts",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.code !== "string" || body.code.trim().length === 0) {
      res.status(400).json({ error: "code is required." });
      return;
    }
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    if (typeof body.accountType !== "string" || !ACCOUNT_TYPES.includes(body.accountType)) {
      res.status(400).json({ error: `accountType must be one of: ${ACCOUNT_TYPES.join(", ")}.` });
      return;
    }

    try {
      const created = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const allowed = await hasPermission(client, req.companyId!, req.userId!, "accounting.manage");
        if (!allowed) return "forbidden" as const;

        if (body.parentAccountId) {
          const parent = await client.query(
            "SELECT id FROM chart_of_accounts WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL",
            [body.parentAccountId, req.companyId]
          );
          if (parent.rows.length === 0) return "invalid_parent" as const;
        }

        const result = await client.query(
          `INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_account_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [req.companyId, body.code.trim(), body.name.trim(), body.accountType, body.parentAccountId || null]
        );
        const row = result.rows[0];
        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "account.created",
          entityType: "account",
          entityId: row.id,
          after: row,
        });
        return row;
      });

      if (created === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (created === "invalid_parent") {
        res.status(422).json({ error: "That parent account does not belong to this company." });
        return;
      }
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof Error && /duplicate key value/.test(err.message)) {
        res.status(409).json({ error: "An account with that code already exists." });
        return;
      }
      throw err;
    }
  })
);

accountingRouter.patch(
  "/accounts/:accountId",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};

    try {
      const updated = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const allowed = await hasPermission(client, req.companyId!, req.userId!, "accounting.manage");
        if (!allowed) return "forbidden" as const;

        const before = await client.query(
          "SELECT * FROM chart_of_accounts WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL",
          [req.params.accountId, req.companyId]
        );
        if (before.rows.length === 0) return "not_found" as const;

        if (typeof body.accountType === "string" && body.accountType !== before.rows[0].account_type) {
          if (!ACCOUNT_TYPES.includes(body.accountType)) return "invalid_type" as const;
          const activity = await client.query(
            "SELECT 1 FROM journal_entry_lines WHERE account_id = $1 AND company_id = $2 LIMIT 1",
            [req.params.accountId, req.companyId]
          );
          if (activity.rows.length > 0) return "type_locked" as const;
        }

        if ("parentAccountId" in body && body.parentAccountId) {
          if (body.parentAccountId === req.params.accountId) return "invalid_parent" as const;
          const parent = await client.query(
            "SELECT id, parent_account_id FROM chart_of_accounts WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL",
            [body.parentAccountId, req.companyId]
          );
          if (parent.rows.length === 0) return "invalid_parent" as const;

          // Bounded ancestor walk to reject a cycle -- the chain can't be
          // longer than the company's total account count in practice, 20
          // hops is a generous ceiling for any real chart of accounts.
          let cursor: string | null = parent.rows[0].parent_account_id;
          let hops = 0;
          while (cursor && hops < 20) {
            if (cursor === req.params.accountId) return "invalid_parent" as const;
            const next = await client.query("SELECT parent_account_id FROM chart_of_accounts WHERE id = $1", [cursor]);
            cursor = next.rows[0]?.parent_account_id ?? null;
            hops++;
          }
        }

        const setClauses: string[] = [];
        const values: unknown[] = [];
        if (typeof body.code === "string") {
          values.push(body.code.trim());
          setClauses.push(`code = $${values.length}`);
        }
        if (typeof body.name === "string") {
          values.push(body.name.trim());
          setClauses.push(`name = $${values.length}`);
        }
        if (typeof body.accountType === "string") {
          values.push(body.accountType);
          setClauses.push(`account_type = $${values.length}`);
        }
        if ("parentAccountId" in body) {
          values.push(body.parentAccountId || null);
          setClauses.push(`parent_account_id = $${values.length}`);
        }
        if (typeof body.isActive === "boolean") {
          values.push(body.isActive);
          setClauses.push(`is_active = $${values.length}`);
        }
        if (setClauses.length === 0) return "no_fields" as const;

        values.push(req.params.accountId, req.companyId);
        const result = await client.query(
          `UPDATE chart_of_accounts SET ${setClauses.join(", ")} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
          values
        );
        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "account.updated",
          entityType: "account",
          entityId: req.params.accountId,
          before: before.rows[0],
          after: result.rows[0],
        });
        return result.rows[0];
      });

      if (updated === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (updated === "not_found") return notFound(res);
      if (updated === "invalid_type") {
        res.status(400).json({ error: `accountType must be one of: ${ACCOUNT_TYPES.join(", ")}.` });
        return;
      }
      if (updated === "type_locked") {
        res.status(409).json({ error: "Cannot change the type of an account that already has ledger activity." });
        return;
      }
      if (updated === "invalid_parent") {
        res.status(422).json({ error: "That parent account is invalid or would create a circular hierarchy." });
        return;
      }
      if (updated === "no_fields") {
        res.status(400).json({ error: "No recognized fields to update." });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof Error && /duplicate key value/.test(err.message)) {
        res.status(409).json({ error: "An account with that code already exists." });
        return;
      }
      throw err;
    }
  })
);

accountingRouter.delete(
  "/accounts/:accountId",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const allowed = await hasPermission(client, req.companyId!, req.userId!, "accounting.manage");
      if (!allowed) return "forbidden" as const;

      const before = await client.query(
        "SELECT * FROM chart_of_accounts WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL",
        [req.params.accountId, req.companyId]
      );
      if (before.rows.length === 0) return "not_found" as const;

      const activity = await client.query(
        "SELECT 1 FROM journal_entry_lines WHERE account_id = $1 AND company_id = $2 LIMIT 1",
        [req.params.accountId, req.companyId]
      );
      if (activity.rows.length > 0) return "has_activity" as const;

      await client.query("DELETE FROM chart_of_accounts WHERE id = $1 AND company_id = $2", [
        req.params.accountId,
        req.companyId,
      ]);
      await recordAuditEntry(client, {
        companyId: req.companyId!,
        actorUserId: req.userId!,
        action: "account.deleted",
        entityType: "account",
        entityId: req.params.accountId,
        before: before.rows[0],
      });
      return "ok" as const;
    });

    if (result === "forbidden") {
      res.status(403).json({ error: "Access denied." });
      return;
    }
    if (result === "not_found") return notFound(res);
    if (result === "has_activity") {
      res.status(409).json({ error: "This account has ledger activity and cannot be deleted. Deactivate it instead." });
      return;
    }
    res.status(204).end();
  })
);

// ---------- Journal entries ----------

interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
}

function validateJournalLines(input: unknown): JournalLineInput[] | null {
  if (!Array.isArray(input) || input.length < 2) return null;
  const lines: JournalLineInput[] = [];
  for (const raw of input) {
    if (typeof raw?.accountId !== "string" || raw.accountId.trim().length === 0) return null;
    const debit = Number(raw.debit ?? 0);
    const credit = Number(raw.credit ?? 0);
    if (!Number.isFinite(debit) || debit < 0) return null;
    if (!Number.isFinite(credit) || credit < 0) return null;
    if ((debit > 0 ? 1 : 0) + (credit > 0 ? 1 : 0) !== 1) return null; // exactly one nonzero, mirrors the DB CHECK
    lines.push({
      accountId: raw.accountId,
      debit,
      credit,
      description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : undefined,
    });
  }
  return lines;
}

function isBalanced(lines: { debit: number; credit: number }[]): boolean {
  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
  // Compare at numeric(19,4) precision to avoid float equality bugs.
  return Math.round(totalDebit * 10000) === Math.round(totalCredit * 10000);
}

async function accountsAreUsable(
  client: import("pg").PoolClient,
  companyId: string,
  accountIds: string[]
): Promise<boolean> {
  const unique = [...new Set(accountIds)];
  const result = await client.query(
    "SELECT id FROM chart_of_accounts WHERE id = ANY($1::uuid[]) AND company_id = $2 AND deleted_at IS NULL AND is_active",
    [unique, companyId]
  );
  return result.rows.length === unique.length;
}

type PostResult =
  | { status: "not_found" }
  | { status: "not_draft" }
  | { status: "no_lines" }
  | { status: "unbalanced" }
  | { status: "ok"; before: Record<string, unknown>; after: Record<string, unknown> };

// Shared by POST /journal-entries { post: true } and the dedicated
// /:entryId/post endpoint. Re-checks balance/lines in JS before touching
// the row so both callers get the same clean error shape; the DB trigger
// (check_journal_entry_immutable) remains the real backstop for races.
async function postDraftEntry(
  client: import("pg").PoolClient,
  companyId: string,
  userId: string,
  entryId: string
): Promise<PostResult> {
  const before = await client.query("SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2", [entryId, companyId]);
  if (before.rows.length === 0) return { status: "not_found" };
  if (before.rows[0].status !== "draft") return { status: "not_draft" };

  const lines = await client.query<{ debit: string; credit: string }>(
    "SELECT debit, credit FROM journal_entry_lines WHERE journal_entry_id = $1",
    [entryId]
  );
  if (lines.rows.length === 0) return { status: "no_lines" };
  if (!isBalanced(lines.rows.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) })))) return { status: "unbalanced" };

  const updated = await client.query(
    "UPDATE journal_entries SET status = 'posted', posted_by = $1 WHERE id = $2 AND company_id = $3 AND status = 'draft' RETURNING *",
    [userId, entryId, companyId]
  );
  if (updated.rows.length === 0) return { status: "not_draft" }; // race: posted/deleted between the read above and now
  return { status: "ok", before: before.rows[0], after: updated.rows[0] };
}

accountingRouter.get(
  "/journal-entries",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;

    const entries = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const headers = await client.query(
        `SELECT id, entry_date, reference, description, status, posted_by, posted_at, created_by, created_at
         FROM journal_entries
         WHERE company_id = $1 AND ($2::text IS NULL OR status = $2)
         ORDER BY entry_date DESC, created_at DESC`,
        [req.companyId, status]
      );
      if (headers.rows.length === 0) return [];

      const ids = headers.rows.map((h) => h.id);
      const lines = await client.query(
        `SELECT ${JOURNAL_LINE_FIELDS}
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
         WHERE jel.company_id = $1 AND jel.journal_entry_id = ANY($2::uuid[])
         ORDER BY jel.journal_entry_id, jel.created_at`,
        [req.companyId, ids]
      );

      const linesByEntry = new Map<string, typeof lines.rows>();
      for (const line of lines.rows) {
        const list = linesByEntry.get(line.journal_entry_id) ?? [];
        list.push(line);
        linesByEntry.set(line.journal_entry_id, list);
      }
      return headers.rows.map((h) => ({ ...h, lines: linesByEntry.get(h.id) ?? [] }));
    });

    res.json(entries);
  })
);

accountingRouter.get(
  "/journal-entries/:entryId",
  asyncHandler(async (req, res) => {
    const entry = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const header = await client.query(
        `SELECT id, entry_date, reference, description, status, posted_by, posted_at, created_by, created_at
         FROM journal_entries WHERE id = $1 AND company_id = $2`,
        [req.params.entryId, req.companyId]
      );
      if (header.rows.length === 0) return null;

      const lines = await client.query(
        `SELECT ${JOURNAL_LINE_FIELDS}
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
         WHERE jel.company_id = $1 AND jel.journal_entry_id = $2
         ORDER BY jel.created_at`,
        [req.companyId, req.params.entryId]
      );
      return { ...header.rows[0], lines: lines.rows };
    });

    if (!entry) return notFound(res);
    res.json(entry);
  })
);

accountingRouter.post(
  "/journal-entries",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const lines = validateJournalLines(body.lines);
    const wantsToPost = body.post === true;

    if (!body.entryDate) {
      res.status(400).json({ error: "entryDate is required." });
      return;
    }
    if (!lines) {
      res.status(400).json({ error: "At least two valid journal lines are required (each with exactly one of debit/credit)." });
      return;
    }
    if (wantsToPost && !isBalanced(lines)) {
      res.status(422).json({ error: "This entry is unbalanced and cannot be posted." });
      return;
    }

    try {
      const created = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const allowed = await hasPermission(client, req.companyId!, req.userId!, "accounting.manage");
        if (!allowed) return "forbidden" as const;

        const usable = await accountsAreUsable(client, req.companyId!, lines.map((l) => l.accountId));
        if (!usable) return "invalid_accounts" as const;

        // Always inserted as 'draft' first: check_journal_entry_lines_immutable
        // only allows inserting lines while the parent is a draft, exactly
        // like invoices/invoice_items -- posting (if requested) happens as
        // a separate step below, once lines already exist.
        const entry = await client.query(
          `INSERT INTO journal_entries (company_id, entry_date, reference, description, status, created_by)
           VALUES ($1, $2, $3, $4, 'draft', $5) RETURNING *`,
          [req.companyId, body.entryDate, body.reference ?? null, body.description ?? null, req.userId]
        );
        const entryId = entry.rows[0].id;

        for (const line of lines) {
          await client.query(
            `INSERT INTO journal_entry_lines (company_id, journal_entry_id, account_id, debit, credit, description)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.companyId, entryId, line.accountId, line.debit, line.credit, line.description ?? null]
          );
        }

        let finalEntry = entry.rows[0];
        if (wantsToPost) {
          const posted = await postDraftEntry(client, req.companyId!, req.userId!, entryId);
          if (posted.status === "ok") finalEntry = posted.after;
        }

        const withLines = await client.query(
          `SELECT ${JOURNAL_LINE_FIELDS}
           FROM journal_entry_lines jel
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
           WHERE jel.journal_entry_id = $1 ORDER BY jel.created_at`,
          [entryId]
        );

        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "journal_entry.created",
          entityType: "journal_entry",
          entityId: entryId,
          after: { ...finalEntry, lines: withLines.rows },
        });

        return { ...finalEntry, lines: withLines.rows };
      });

      if (created === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (created === "invalid_accounts") {
        res.status(422).json({ error: "One or more accounts are invalid, inactive, or belong to a different company." });
        return;
      }
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof Error && /cannot post an unbalanced entry/.test(err.message)) {
        res.status(422).json({ error: "This entry is unbalanced and cannot be posted." });
        return;
      }
      if (err instanceof Error && /cannot post an entry with no lines/.test(err.message)) {
        res.status(422).json({ error: "This entry has no lines and cannot be posted." });
        return;
      }
      throw err;
    }
  })
);

accountingRouter.patch(
  "/journal-entries/:entryId",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const lines = validateJournalLines(body.lines);

    if (!body.entryDate) {
      res.status(400).json({ error: "entryDate is required." });
      return;
    }
    if (!lines) {
      res.status(400).json({ error: "At least two valid journal lines are required (each with exactly one of debit/credit)." });
      return;
    }

    try {
      const updated = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const allowed = await hasPermission(client, req.companyId!, req.userId!, "accounting.manage");
        if (!allowed) return "forbidden" as const;

        const before = await client.query("SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2", [
          req.params.entryId,
          req.companyId,
        ]);
        if (before.rows.length === 0) return "not_found" as const;
        if (before.rows[0].status !== "draft") return "not_draft" as const;

        const usable = await accountsAreUsable(client, req.companyId!, lines.map((l) => l.accountId));
        if (!usable) return "invalid_accounts" as const;

        const beforeLines = await client.query("SELECT * FROM journal_entry_lines WHERE journal_entry_id = $1", [
          req.params.entryId,
        ]);

        const result = await client.query(
          `UPDATE journal_entries SET entry_date = $1, reference = $2, description = $3
           WHERE id = $4 AND company_id = $5 RETURNING *`,
          [body.entryDate, body.reference ?? null, body.description ?? null, req.params.entryId, req.companyId]
        );

        await client.query("DELETE FROM journal_entry_lines WHERE journal_entry_id = $1", [req.params.entryId]);
        for (const line of lines) {
          await client.query(
            `INSERT INTO journal_entry_lines (company_id, journal_entry_id, account_id, debit, credit, description)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.companyId, req.params.entryId, line.accountId, line.debit, line.credit, line.description ?? null]
          );
        }

        const afterLines = await client.query(
          `SELECT ${JOURNAL_LINE_FIELDS}
           FROM journal_entry_lines jel
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
           WHERE jel.journal_entry_id = $1 ORDER BY jel.created_at`,
          [req.params.entryId]
        );

        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "journal_entry.updated",
          entityType: "journal_entry",
          entityId: req.params.entryId,
          before: { ...before.rows[0], lines: beforeLines.rows },
          after: { ...result.rows[0], lines: afterLines.rows },
        });

        return { ...result.rows[0], lines: afterLines.rows };
      });

      if (updated === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (updated === "not_found") return notFound(res);
      if (updated === "not_draft") {
        res.status(409).json({ error: "Only a draft journal entry can be edited." });
        return;
      }
      if (updated === "invalid_accounts") {
        res.status(422).json({ error: "One or more accounts are invalid, inactive, or belong to a different company." });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof Error && /permanently immutable/.test(err.message)) {
        res.status(409).json({ error: "This journal entry is posted and can no longer be edited." });
        return;
      }
      throw err;
    }
  })
);

accountingRouter.post(
  "/journal-entries/:entryId/post",
  asyncHandler(async (req, res) => {
    try {
      const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const allowed = await hasPermission(client, req.companyId!, req.userId!, "accounting.manage");
        if (!allowed) return { status: "forbidden" } as const;

        const posted = await postDraftEntry(client, req.companyId!, req.userId!, req.params.entryId);
        if (posted.status !== "ok") return posted;

        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "journal_entry.posted",
          entityType: "journal_entry",
          entityId: req.params.entryId,
          before: posted.before,
          after: posted.after,
        });

        const withLines = await client.query(
          `SELECT ${JOURNAL_LINE_FIELDS}
           FROM journal_entry_lines jel
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
           WHERE jel.journal_entry_id = $1 ORDER BY jel.created_at`,
          [req.params.entryId]
        );
        return { status: "ok", entry: { ...posted.after, lines: withLines.rows } } as const;
      });

      if (result.status === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (result.status === "not_found") return notFound(res);
      if (result.status === "not_draft") {
        res.status(409).json({ error: "Only a draft journal entry can be posted." });
        return;
      }
      if (result.status === "no_lines") {
        res.status(422).json({ error: "This entry has no lines and cannot be posted." });
        return;
      }
      if (result.status === "unbalanced") {
        res.status(422).json({ error: "This entry is unbalanced and cannot be posted." });
        return;
      }
      res.json(result.entry);
    } catch (err) {
      if (err instanceof Error && /cannot post an unbalanced entry/.test(err.message)) {
        res.status(422).json({ error: "This entry is unbalanced and cannot be posted." });
        return;
      }
      if (err instanceof Error && /cannot post an entry with no lines/.test(err.message)) {
        res.status(422).json({ error: "This entry has no lines and cannot be posted." });
        return;
      }
      throw err;
    }
  })
);

accountingRouter.delete(
  "/journal-entries/:entryId",
  asyncHandler(async (req, res) => {
    try {
      const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const allowed = await hasPermission(client, req.companyId!, req.userId!, "accounting.manage");
        if (!allowed) return "forbidden" as const;

        const before = await client.query("SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2", [
          req.params.entryId,
          req.companyId,
        ]);
        if (before.rows.length === 0) return "not_found" as const;
        if (before.rows[0].status !== "draft") return "not_draft" as const;

        const beforeLines = await client.query("SELECT * FROM journal_entry_lines WHERE journal_entry_id = $1", [
          req.params.entryId,
        ]);

        await client.query("DELETE FROM journal_entries WHERE id = $1 AND company_id = $2", [
          req.params.entryId,
          req.companyId,
        ]);
        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "journal_entry.deleted",
          entityType: "journal_entry",
          entityId: req.params.entryId,
          before: { ...before.rows[0], lines: beforeLines.rows },
        });
        return "ok" as const;
      });

      if (result === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (result === "not_found") return notFound(res);
      if (result === "not_draft") {
        res.status(409).json({ error: "Only a draft journal entry can be deleted." });
        return;
      }
      res.status(204).end();
    } catch (err) {
      if (err instanceof Error && /a posted entry can never be deleted/.test(err.message)) {
        res.status(409).json({ error: "Only a draft journal entry can be deleted." });
        return;
      }
      throw err;
    }
  })
);
