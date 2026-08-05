import { Router } from "express";
import multer from "multer";
import { withTenantContext } from "../db/context.js";
import { requireAuth, requireCompanyAccess } from "../auth/middleware.js";
import { recordAuditEntry } from "../services/auditService.js";
import { hasPermission } from "../services/permissionService.js";
import { saveCompanyFile, readCompanyFile } from "../storage/localAdapter.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * Minimal real CRUD for employees/payroll/invoices/documents — enough
 * surface area to be a genuine target for the cross-company security
 * tests in server/tests/, not a full payroll/invoicing product. Every
 * handler follows the same shape: requireCompanyAccess has already turned
 * an unverified req.params.companyId into a server-confirmed req.companyId
 * before any of these run, every query filters explicitly by company_id
 * (belt-and-suspenders on top of the RLS policies from 0017 doing the same
 * thing independently), and a record that exists but belongs to a
 * different company produces the same 404 as a record that doesn't exist
 * at all — see docs/multi-tenant-security.md.
 */
// mergeParams: true is required because this router is mounted under a
// parent path with its own dynamic segment (`/api/companies/:companyId`,
// in app.ts) — without it, req.params.companyId would be empty inside
// every handler here (and, critically, inside requireCompanyAccess),
// since a sub-router's own routing normally replaces the parent's params
// rather than inheriting them.
export const resourcesRouter = Router({ mergeParams: true });
resourcesRouter.use(requireAuth, requireCompanyAccess);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function notFound(res: import("express").Response): void {
  res.status(404).json({ error: "Not found." });
}

// ---------- Employees ----------

resourcesRouter.get(
  "/employees",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT id, employee_number, first_name, last_name, work_email, employment_status
       FROM employees WHERE company_id = $1 AND deleted_at IS NULL ORDER BY last_name`,
        [req.companyId]
      )
    );
    res.json(result.rows);
  })
);

resourcesRouter.get(
  "/employees/:employeeId",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT id, employee_number, first_name, last_name, work_email, employment_status, hire_date
       FROM employees WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [req.params.employeeId, req.companyId]
      )
    );
    if (result.rows.length === 0) return notFound(res);
    res.json(result.rows[0]);
  })
);

// ---------- Payroll ----------

resourcesRouter.get(
  "/payroll-runs/:runId",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT id, payroll_period_id, run_type, status, total_gross, total_net
       FROM payroll_runs WHERE id = $1 AND company_id = $2`,
        [req.params.runId, req.companyId]
      )
    );
    if (result.rows.length === 0) return notFound(res);
    res.json(result.rows[0]);
  })
);

resourcesRouter.patch(
  "/payroll-runs/:runId",
  asyncHandler(async (req, res) => {
    const { status } = req.body ?? {};

    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const before = await client.query("SELECT * FROM payroll_runs WHERE id = $1 AND company_id = $2", [
        req.params.runId,
        req.companyId,
      ]);
      if (before.rows.length === 0) return null;

      // Deliberately does not attempt to bypass trg_payroll_runs_immutable
      // (0007) — an edit attempt against an approved/paid run in another
      // company would be blocked twice over: once by not being found here
      // at all (company_id mismatch), and, even for a run within the
      // caller's own company, again by that trigger once approved.
      const updated = await client.query(
        "UPDATE payroll_runs SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING *",
        [status, req.params.runId, req.companyId]
      );
      await recordAuditEntry(client, {
        companyId: req.companyId!,
        actorUserId: req.userId!,
        action: "payroll_run.updated",
        entityType: "payroll_run",
        entityId: req.params.runId,
        before: before.rows[0],
        after: updated.rows[0],
      });
      return updated.rows[0];
    });

    if (!result) return notFound(res);
    res.json(result);
  })
);

// ---------- Invoices ----------

resourcesRouter.get(
  "/invoices/:invoiceId",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT id, invoice_number, customer_id, issue_date, due_date, status, total, subtotal, currency,
              amount_paid, notes, last_edited_at
       FROM invoices WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [req.params.invoiceId, req.companyId]
      )
    );
    if (result.rows.length === 0) return notFound(res);
    res.json(result.rows[0]);
  })
);

// ---------- Customers ----------

resourcesRouter.get(
  "/customers",
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT id, name, company_name, email, phone, default_currency, created_at
       FROM customers
       WHERE company_id = $1 AND deleted_at IS NULL
         AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
       ORDER BY name`,
        [req.companyId, search]
      )
    );
    res.json(result.rows);
  })
);

resourcesRouter.get(
  "/customers/:customerId",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT * FROM customers WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [req.params.customerId, req.companyId]
      )
    );
    if (result.rows.length === 0) return notFound(res);
    res.json(result.rows[0]);
  })
);

const CUSTOMER_FIELDS: Record<string, string> = {
  name: "name",
  companyName: "company_name",
  email: "email",
  phone: "phone",
  billingLine1: "billing_line1",
  billingCity: "billing_city",
  billingState: "billing_state",
  billingPostalCode: "billing_postal_code",
  billingCountryCode: "billing_country_code",
  defaultCurrency: "default_currency",
};

resourcesRouter.post(
  "/customers",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      res.status(400).json({ error: "Customer name is required." });
      return;
    }

    const created = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const result = await client.query(
        `INSERT INTO customers (company_id, name, company_name, email, phone, billing_line1, billing_city,
                                 billing_state, billing_postal_code, billing_country_code, default_currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 'USD'))
         RETURNING *`,
        [
          req.companyId,
          body.name.trim(),
          body.companyName ?? null,
          body.email ?? null,
          body.phone ?? null,
          body.billingLine1 ?? null,
          body.billingCity ?? null,
          body.billingState ?? null,
          body.billingPostalCode ?? null,
          typeof body.billingCountryCode === "string" ? body.billingCountryCode.toUpperCase() : null,
          typeof body.defaultCurrency === "string" ? body.defaultCurrency.toUpperCase() : null,
        ]
      );
      const row = result.rows[0];
      await recordAuditEntry(client, {
        companyId: req.companyId!,
        actorUserId: req.userId!,
        action: "customer.created",
        entityType: "customer",
        entityId: row.id,
        after: row,
      });
      return row;
    });

    res.status(201).json(created);
  })
);

resourcesRouter.patch(
  "/customers/:customerId",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [bodyKey, column] of Object.entries(CUSTOMER_FIELDS)) {
      if (bodyKey in body) {
        const value =
          column === "billing_country_code" || column === "default_currency"
            ? typeof body[bodyKey] === "string"
              ? body[bodyKey].toUpperCase()
              : body[bodyKey]
            : body[bodyKey];
        values.push(value);
        setClauses.push(`${column} = $${values.length}`);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: "No recognized fields to update." });
      return;
    }

    values.push(req.params.customerId, req.companyId);

    const updated = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const before = await client.query("SELECT * FROM customers WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
        req.params.customerId,
        req.companyId,
      ]);
      if (before.rows.length === 0) return null;

      const result = await client.query(
        `UPDATE customers SET ${setClauses.join(", ")} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
        values
      );
      await recordAuditEntry(client, {
        companyId: req.companyId!,
        actorUserId: req.userId!,
        action: "customer.updated",
        entityType: "customer",
        entityId: req.params.customerId,
        before: before.rows[0],
        after: result.rows[0],
      });
      return result.rows[0];
    });

    if (!updated) return notFound(res);
    res.json(updated);
  })
);

// Archived, never hard-deleted -- historical invoices/payments must keep
// referencing a valid customer row (see 0009's own comment on the table).
resourcesRouter.delete(
  "/customers/:customerId",
  asyncHandler(async (req, res) => {
    const archived = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const before = await client.query("SELECT * FROM customers WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
        req.params.customerId,
        req.companyId,
      ]);
      if (before.rows.length === 0) return null;

      const result = await client.query(
        "UPDATE customers SET deleted_at = now() WHERE id = $1 AND company_id = $2 RETURNING id",
        [req.params.customerId, req.companyId]
      );
      await recordAuditEntry(client, {
        companyId: req.companyId!,
        actorUserId: req.userId!,
        action: "customer.archived",
        entityType: "customer",
        entityId: req.params.customerId,
        before: before.rows[0],
      });
      return result.rows[0];
    });

    if (!archived) return notFound(res);
    res.status(204).end();
  })
);

// ---------- Vendors (minimal — a lookup for expenses, not a full feature) ----------

resourcesRouter.get(
  "/vendors",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT id, name, email, category, default_currency FROM vendors
       WHERE company_id = $1 AND deleted_at IS NULL ORDER BY name`,
        [req.companyId]
      )
    );
    res.json(result.rows);
  })
);

resourcesRouter.post(
  "/vendors",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      res.status(400).json({ error: "Vendor name is required." });
      return;
    }

    const created = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const result = await client.query(
        `INSERT INTO vendors (company_id, name, email, phone, category, default_currency)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'USD')) RETURNING *`,
        [
          req.companyId,
          body.name.trim(),
          body.email ?? null,
          body.phone ?? null,
          body.category ?? null,
          typeof body.defaultCurrency === "string" ? body.defaultCurrency.toUpperCase() : null,
        ]
      );
      const row = result.rows[0];
      await recordAuditEntry(client, {
        companyId: req.companyId!,
        actorUserId: req.userId!,
        action: "vendor.created",
        entityType: "vendor",
        entityId: row.id,
        after: row,
      });
      return row;
    });

    res.status(201).json(created);
  })
);

// ---------- Expenses ----------

resourcesRouter.get(
  "/expenses",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const vendorId = typeof req.query.vendorId === "string" ? req.query.vendorId : null;

    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT e.id, e.date, e.vendor_id, ec.name AS category, e.amount, e.currency, e.memo,
              e.payment_method, e.status, e.created_at
       FROM expenses e
       JOIN expense_categories ec ON ec.id = e.expense_category_id
       WHERE e.company_id = $1 AND e.deleted_at IS NULL
         AND ($2::text IS NULL OR e.status = $2)
         AND ($3::uuid IS NULL OR e.vendor_id = $3)
       ORDER BY e.date DESC, e.created_at DESC`,
        [req.companyId, status, vendorId]
      )
    );
    res.json(result.rows);
  })
);

resourcesRouter.get(
  "/expenses/:expenseId",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT e.*, ec.name AS category FROM expenses e
       JOIN expense_categories ec ON ec.id = e.expense_category_id
       WHERE e.id = $1 AND e.company_id = $2 AND e.deleted_at IS NULL`,
        [req.params.expenseId, req.companyId]
      )
    );
    if (result.rows.length === 0) return notFound(res);
    res.json(result.rows[0]);
  })
);

const EXPENSE_HISTORY_FIELDS: Record<string, string> = {
  amount: "Amount",
  currency: "Currency",
  date: "Date",
  memo: "Memo",
  payment_method: "Payment method",
  status: "Status",
  vendor_id: "Vendor",
  expense_category_id: "Category",
};

// Per-field before/after diff, built from audit_logs rather than a
// dedicated history table -- 0022 removed the DB-level immutability that
// used to make this unnecessary, so this endpoint (plus the audit entry
// every PATCH above already writes) is now the only record of what an
// expense looked like before an edit. vendor_id/expense_category_id are
// resolved to their *current* name for readability; if a vendor/category
// was later renamed, history shows the current name, not the name at the
// time of the edit -- acceptable for a lightweight audit view, not a
// point-in-time ledger.
resourcesRouter.get(
  "/expenses/:expenseId/history",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const expense = await client.query("SELECT id FROM expenses WHERE id = $1 AND company_id = $2", [
        req.params.expenseId,
        req.companyId,
      ]);
      if (expense.rows.length === 0) return null;

      const [logs, vendors, categories] = await Promise.all([
        client.query<{ id: string; action: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; created_at: string }>(
          `SELECT id, action, before_data, after_data, created_at
           FROM audit_logs
           WHERE company_id = $1 AND entity_type = 'expense' AND entity_id = $2
           ORDER BY created_at ASC`,
          [req.companyId, req.params.expenseId]
        ),
        client.query<{ id: string; name: string }>("SELECT id, name FROM vendors WHERE company_id = $1", [req.companyId]),
        client.query<{ id: string; name: string }>(
          "SELECT id, name FROM expense_categories WHERE company_id = $1 OR company_id IS NULL",
          [req.companyId]
        ),
      ]);

      const vendorNames = new Map(vendors.rows.map((v) => [v.id, v.name]));
      const categoryNames = new Map(categories.rows.map((c) => [c.id, c.name]));
      const resolve = (field: string, value: unknown) => {
        if (value === null || value === undefined) return null;
        if (field === "vendor_id") return vendorNames.get(value as string) ?? null;
        if (field === "expense_category_id") return categoryNames.get(value as string) ?? null;
        return value;
      };

      return logs.rows.map((row) => {
        const before = row.before_data;
        const after = row.after_data;
        const changes: { field: string; label: string; from: unknown; to: unknown }[] = [];
        if (before && after) {
          for (const [column, label] of Object.entries(EXPENSE_HISTORY_FIELDS)) {
            if (JSON.stringify(before[column]) !== JSON.stringify(after[column])) {
              changes.push({ field: column, label, from: resolve(column, before[column]), to: resolve(column, after[column]) });
            }
          }
        }
        return { id: row.id, action: row.action, createdAt: row.created_at, changes };
      });
    });

    if (!result) return notFound(res);
    res.json(result);
  })
);

async function resolveExpenseCategoryId(
  client: import("pg").PoolClient,
  companyId: string,
  categoryName: string
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM expense_categories
     WHERE (company_id = $1 OR company_id IS NULL) AND name = $2 AND deleted_at IS NULL
     ORDER BY company_id NULLS LAST LIMIT 1`,
    [companyId, categoryName]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const created = await client.query<{ id: string }>(
    `INSERT INTO expense_categories (company_id, name) VALUES ($1, $2) RETURNING id`,
    [companyId, categoryName]
  );
  return created.rows[0].id;
}

resourcesRouter.post(
  "/expenses",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const amount = Number(body.amount);

    if (!body.date || typeof body.date !== "string") {
      res.status(400).json({ error: "date is required." });
      return;
    }
    if (typeof body.category !== "string" || body.category.trim().length === 0) {
      res.status(400).json({ error: "category is required." });
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ error: "amount must be a non-negative number." });
      return;
    }

    const created = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const allowed = await hasPermission(client, req.companyId!, req.userId!, "expenses.create");
      if (!allowed) return "forbidden" as const;

      const categoryId = await resolveExpenseCategoryId(client, req.companyId!, body.category.trim());

      const result = await client.query(
        `INSERT INTO expenses (company_id, vendor_id, expense_category_id, date, amount, currency,
                                memo, payment_method, submitted_by)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'USD'), $7, COALESCE($8, 'credit_card'), $9)
         RETURNING *`,
        [
          req.companyId,
          body.vendorId ?? null,
          categoryId,
          body.date,
          amount,
          typeof body.currency === "string" ? body.currency.toUpperCase() : null,
          body.memo ?? null,
          body.paymentMethod ?? null,
          req.userId,
        ]
      );
      const row = result.rows[0];
      await recordAuditEntry(client, {
        companyId: req.companyId!,
        actorUserId: req.userId!,
        action: "expense.created",
        entityType: "expense",
        entityId: row.id,
        after: row,
      });
      return { ...row, category: body.category.trim() };
    });

    if (created === "forbidden") {
      res.status(403).json({ error: "Access denied." });
      return;
    }
    res.status(201).json(created);
  })
);

const EXPENSE_STATUS_ACTIONS: Record<string, { status: string; permission: string }> = {
  approve: { status: "approved", permission: "expenses.approve" },
  reject: { status: "rejected", permission: "expenses.approve" },
  reimburse: { status: "reimbursed", permission: "expenses.approve" },
};

resourcesRouter.patch(
  "/expenses/:expenseId",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const action = typeof body.action === "string" ? EXPENSE_STATUS_ACTIONS[body.action] : undefined;

    try {
      const updated = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const before = await client.query("SELECT * FROM expenses WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
          req.params.expenseId,
          req.companyId,
        ]);
        if (before.rows.length === 0) return "not_found" as const;

        if (action) {
          const allowed = await hasPermission(client, req.companyId!, req.userId!, action.permission);
          if (!allowed) return "forbidden" as const;

          const result = await client.query(
            `UPDATE expenses SET status = $1,
                approved_by = CASE WHEN $1 IN ('approved','rejected','reimbursed') THEN $2 ELSE approved_by END,
                approved_at = CASE WHEN $1 IN ('approved','rejected','reimbursed') THEN now() ELSE approved_at END
             WHERE id = $3 AND company_id = $4 RETURNING *`,
            [action.status, req.userId, req.params.expenseId, req.companyId]
          );
          await recordAuditEntry(client, {
            companyId: req.companyId!,
            actorUserId: req.userId!,
            action: `expense.${body.action}`,
            entityType: "expense",
            entityId: req.params.expenseId,
            before: before.rows[0],
            after: result.rows[0],
          });
          return result.rows[0];
        }

        // Plain field edit -- as of 0022, allowed at any status (not just
        // pending); the client warns before editing a finalized expense,
        // but the write itself is never blocked here. Full before/after is
        // recorded in audit_logs below, which is the only safety net now
        // that the DB trigger no longer refuses these writes.
        if (body.amount !== undefined && (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount < 0)) {
          return "invalid_amount" as const;
        }

        const setClauses: string[] = [];
        const values: unknown[] = [];
        if (typeof body.memo === "string") {
          values.push(body.memo);
          setClauses.push(`memo = $${values.length}`);
        }
        if (typeof body.amount === "number") {
          values.push(body.amount);
          setClauses.push(`amount = $${values.length}`);
        }
        if (typeof body.paymentMethod === "string") {
          values.push(body.paymentMethod);
          setClauses.push(`payment_method = $${values.length}`);
        }
        if (typeof body.date === "string" && body.date) {
          values.push(body.date);
          setClauses.push(`date = $${values.length}`);
        }
        if ("vendorId" in body) {
          values.push(body.vendorId || null);
          setClauses.push(`vendor_id = $${values.length}`);
        }
        if (typeof body.category === "string" && body.category.trim()) {
          const categoryId = await resolveExpenseCategoryId(client, req.companyId!, body.category.trim());
          values.push(categoryId);
          setClauses.push(`expense_category_id = $${values.length}`);
        }
        if (setClauses.length === 0) return "no_fields" as const;

        values.push(req.params.expenseId, req.companyId);
        const result = await client.query(
          `UPDATE expenses SET ${setClauses.join(", ")} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
          values
        );
        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "expense.updated",
          entityType: "expense",
          entityId: req.params.expenseId,
          before: before.rows[0],
          after: result.rows[0],
        });
        return { ...result.rows[0], category: typeof body.category === "string" ? body.category.trim() : undefined };
      });

      if (updated === "not_found") return notFound(res);
      if (updated === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (updated === "no_fields") {
        res.status(400).json({ error: "No recognized fields to update." });
        return;
      }
      if (updated === "invalid_amount") {
        res.status(400).json({ error: "amount must be a non-negative number." });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof Error && /locked once approved/.test(err.message)) {
        res.status(409).json({ error: "This expense is no longer editable in its current status." });
        return;
      }
      throw err;
    }
  })
);

resourcesRouter.delete(
  "/expenses/:expenseId",
  asyncHandler(async (req, res) => {
    try {
      const deleted = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const before = await client.query("SELECT * FROM expenses WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
          req.params.expenseId,
          req.companyId,
        ]);
        if (before.rows.length === 0) return "not_found" as const;

        await client.query("DELETE FROM expenses WHERE id = $1 AND company_id = $2", [
          req.params.expenseId,
          req.companyId,
        ]);
        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "expense.deleted",
          entityType: "expense",
          entityId: req.params.expenseId,
          before: before.rows[0],
        });
        return "ok" as const;
      });

      if (deleted === "not_found") return notFound(res);
      res.status(204).end();
    } catch (err) {
      if (err instanceof Error && /only a pending expense can be deleted/.test(err.message)) {
        res.status(409).json({ error: "Only a pending expense can be deleted." });
        return;
      }
      throw err;
    }
  })
);

// ---------- Invoices ----------

resourcesRouter.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT id, invoice_number, customer_id, issue_date, due_date, status, currency, total, amount_paid, last_edited_at
       FROM invoices
       WHERE company_id = $1 AND deleted_at IS NULL AND ($2::text IS NULL OR status = $2)
       ORDER BY issue_date DESC, created_at DESC`,
        [req.companyId, status]
      )
    );
    res.json(result.rows);
  })
);

resourcesRouter.get(
  "/invoices/:invoiceId/items",
  asyncHandler(async (req, res) => {
    const invoice = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query("SELECT id FROM invoices WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
        req.params.invoiceId,
        req.companyId,
      ])
    );
    if (invoice.rows.length === 0) return notFound(res);

    const items = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        "SELECT id, description, quantity, unit_price, amount FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order",
        [req.params.invoiceId]
      )
    );
    res.json(items.rows);
  })
);

interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

function validateLineItems(input: unknown): LineItemInput[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const items: LineItemInput[] = [];
  for (const raw of input) {
    if (typeof raw?.description !== "string" || raw.description.trim().length === 0) return null;
    const quantity = Number(raw.quantity);
    const unitPrice = Number(raw.unitPrice);
    if (!Number.isFinite(quantity) || quantity < 0) return null;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
    items.push({ description: raw.description.trim(), quantity, unitPrice });
  }
  return items;
}

resourcesRouter.post(
  "/invoices",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const lineItems = validateLineItems(body.lineItems);
    const status = body.status === "sent" ? "sent" : "draft";

    if (typeof body.customerId !== "string") {
      res.status(400).json({ error: "customerId is required." });
      return;
    }
    if (!body.issueDate || !body.dueDate) {
      res.status(400).json({ error: "issueDate and dueDate are required." });
      return;
    }
    if (!lineItems) {
      res.status(400).json({ error: "At least one valid line item is required." });
      return;
    }

    try {
      const created = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const allowed = await hasPermission(client, req.companyId!, req.userId!, "invoices.create");
        if (!allowed) return "forbidden" as const;
        if (status === "sent") {
          const canSend = await hasPermission(client, req.companyId!, req.userId!, "invoices.send");
          if (!canSend) return "forbidden" as const;
        }

        const customer = await client.query("SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
          body.customerId,
          req.companyId,
        ]);
        if (customer.rows.length === 0) return "no_customer" as const;

        // Atomically claim the next invoice number: locking the settings
        // row prevents two concurrent invoice creations in the same
        // company from ever computing the same number.
        const settings = await client.query<{ invoice_number_prefix: string; next_invoice_sequence: number }>(
          "SELECT invoice_number_prefix, next_invoice_sequence FROM company_settings WHERE company_id = $1 FOR UPDATE",
          [req.companyId]
        );
        const prefix = settings.rows[0]?.invoice_number_prefix ?? "INV-";
        const sequence = settings.rows[0]?.next_invoice_sequence ?? 1;
        const invoiceNumber = `${prefix}${sequence}`;
        await client.query("UPDATE company_settings SET next_invoice_sequence = next_invoice_sequence + 1 WHERE company_id = $1", [
          req.companyId,
        ]);

        const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
        const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "USD";

        // Always inserted as 'draft' first, regardless of the requested
        // status: trg_invoice_items_immutable (0010) rejects inserting
        // line items against any invoice whose status isn't 'draft', so
        // creating directly with status='sent' and then inserting items
        // in the same transaction would always fail. Transitioning to
        // 'sent' happens as a separate UPDATE below, once items already
        // exist -- exactly the sequence the trigger was designed around
        // (create as draft, add items, then send).
        const invoice = await client.query(
          `INSERT INTO invoices (company_id, customer_id, invoice_number, issue_date, due_date, status,
                                  currency, subtotal, tax_total, total, notes)
           VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, 0, $7, $8)
           RETURNING *`,
          [req.companyId, body.customerId, invoiceNumber, body.issueDate, body.dueDate, currency, subtotal, body.notes ?? null]
        );
        const invoiceId = invoice.rows[0].id;

        for (const [index, item] of lineItems.entries()) {
          await client.query(
            `INSERT INTO invoice_items (company_id, invoice_id, description, quantity, unit_price, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.companyId, invoiceId, item.description, item.quantity, item.unitPrice, index]
          );
        }

        let finalInvoice = invoice.rows[0];
        if (status === "sent") {
          const sent = await client.query("UPDATE invoices SET status = 'sent' WHERE id = $1 RETURNING *", [invoiceId]);
          finalInvoice = sent.rows[0];
        }

        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "invoice.created",
          entityType: "invoice",
          entityId: invoiceId,
          after: finalInvoice,
        });

        return finalInvoice;
      });

      if (created === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (created === "no_customer") {
        res.status(422).json({ error: "That customer does not belong to this company." });
        return;
      }
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof Error && /duplicate key value/.test(err.message)) {
        res.status(409).json({ error: "Could not allocate a unique invoice number. Please retry." });
        return;
      }
      throw err;
    }
  })
);

const INVOICE_STATUSES = ["draft", "sent", "paid", "partially_paid", "overdue", "void"];

// Full-record edit -- distinct from the /status endpoint below, which is
// the constrained "mark as sent/paid" quick action and enforces
// INVOICE_STATUS_TRANSITIONS. This endpoint is the "fix anything on this
// invoice" form: per 0022, customer/dates/line items/amounts are editable
// at any status (not just draft), so it does not walk that transition
// graph -- it only checks that the requested status is a real status and,
// if the edit is entering 'sent' for the first time, that the actor still
// holds invoices.send (closing the obvious bypass of using this form to
// send an invoice without that permission). Every write here is recorded
// in audit_logs with full before/after (invoice fields + line items) and
// stamps last_edited_at, since the database no longer refuses these edits
// on its own -- see 0022's header comment.
resourcesRouter.patch(
  "/invoices/:invoiceId",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const lineItems = validateLineItems(body.lineItems);

    if (typeof body.customerId !== "string") {
      res.status(400).json({ error: "customerId is required." });
      return;
    }
    if (!body.issueDate || !body.dueDate) {
      res.status(400).json({ error: "issueDate and dueDate are required." });
      return;
    }
    if (new Date(body.dueDate) < new Date(body.issueDate)) {
      res.status(400).json({ error: "Due date must be on or after the issue date." });
      return;
    }
    if (!lineItems) {
      res.status(400).json({ error: "At least one valid line item is required." });
      return;
    }
    if (body.status !== undefined && !INVOICE_STATUSES.includes(body.status)) {
      res.status(400).json({ error: "status is not a recognized invoice status." });
      return;
    }

    try {
      const updated = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const allowed = await hasPermission(client, req.companyId!, req.userId!, "invoices.create");
        if (!allowed) return "forbidden" as const;

        const before = await client.query("SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
          req.params.invoiceId,
          req.companyId,
        ]);
        if (before.rows.length === 0) return "not_found" as const;

        const nextStatus = body.status ?? before.rows[0].status;
        if (nextStatus === "sent" && before.rows[0].status !== "sent") {
          const canSend = await hasPermission(client, req.companyId!, req.userId!, "invoices.send");
          if (!canSend) return "forbidden" as const;
        }

        const customer = await client.query("SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
          body.customerId,
          req.companyId,
        ]);
        if (customer.rows.length === 0) return "no_customer" as const;

        const beforeItems = await client.query(
          "SELECT id, description, quantity, unit_price FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order",
          [req.params.invoiceId]
        );

        const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
        const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : before.rows[0].currency;
        const taxTotal = Number(before.rows[0].tax_total);

        const result = await client.query(
          `UPDATE invoices
           SET customer_id = $1, issue_date = $2, due_date = $3, status = $4,
               currency = $5, subtotal = $6, total = $6 + $7, notes = $8, last_edited_at = now()
           WHERE id = $9 AND company_id = $10
           RETURNING *`,
          [
            body.customerId,
            body.issueDate,
            body.dueDate,
            nextStatus,
            currency,
            subtotal,
            taxTotal,
            body.notes ?? before.rows[0].notes,
            req.params.invoiceId,
            req.companyId,
          ]
        );

        await client.query("DELETE FROM invoice_items WHERE invoice_id = $1", [req.params.invoiceId]);
        for (const [index, item] of lineItems.entries()) {
          await client.query(
            `INSERT INTO invoice_items (company_id, invoice_id, description, quantity, unit_price, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.companyId, req.params.invoiceId, item.description, item.quantity, item.unitPrice, index]
          );
        }

        const afterItems = await client.query(
          "SELECT id, description, quantity, unit_price FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order",
          [req.params.invoiceId]
        );

        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "invoice.updated",
          entityType: "invoice",
          entityId: req.params.invoiceId,
          before: { ...before.rows[0], lineItems: beforeItems.rows },
          after: { ...result.rows[0], lineItems: afterItems.rows },
        });

        return { ...result.rows[0], lineItems: afterItems.rows };
      });

      if (updated === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (updated === "not_found") return notFound(res);
      if (updated === "no_customer") {
        res.status(422).json({ error: "That customer does not belong to this company." });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof Error && /due_date/.test(err.message)) {
        res.status(400).json({ error: "Due date must be on or after the issue date." });
        return;
      }
      throw err;
    }
  })
);

const INVOICE_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["sent", "void"],
  sent: ["paid", "partially_paid", "overdue", "void"],
  partially_paid: ["paid", "void"],
  overdue: ["paid", "partially_paid", "void"],
};

resourcesRouter.patch(
  "/invoices/:invoiceId/status",
  asyncHandler(async (req, res) => {
    const { status: nextStatus } = req.body ?? {};

    try {
      const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const before = await client.query("SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
          req.params.invoiceId,
          req.companyId,
        ]);
        if (before.rows.length === 0) return "not_found" as const;

        const canSend = await hasPermission(client, req.companyId!, req.userId!, "invoices.send");
        if (!canSend) return "forbidden" as const;

        const allowed = INVOICE_STATUS_TRANSITIONS[before.rows[0].status] ?? [];
        if (!allowed.includes(nextStatus)) return "invalid_transition" as const;

        const updated = await client.query("UPDATE invoices SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING *", [
          nextStatus,
          req.params.invoiceId,
          req.companyId,
        ]);
        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: `invoice.status_changed.${nextStatus}`,
          entityType: "invoice",
          entityId: req.params.invoiceId,
          before: before.rows[0],
          after: updated.rows[0],
        });
        return updated.rows[0];
      });

      if (result === "not_found") return notFound(res);
      if (result === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (result === "invalid_transition") {
        res.status(422).json({ error: `Cannot change invoice status to '${nextStatus}' from its current status.` });
        return;
      }
      res.json(result);
    } catch (err) {
      if (err instanceof Error && /locked once sent/.test(err.message)) {
        res.status(409).json({ error: "This invoice is locked and can no longer change status this way." });
        return;
      }
      throw err;
    }
  })
);

resourcesRouter.delete(
  "/invoices/:invoiceId",
  asyncHandler(async (req, res) => {
    try {
      const deleted = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
        const before = await client.query("SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL", [
          req.params.invoiceId,
          req.companyId,
        ]);
        if (before.rows.length === 0) return "not_found" as const;

        const allowed = await hasPermission(client, req.companyId!, req.userId!, "invoices.delete");
        if (!allowed) return "forbidden" as const;

        await client.query("DELETE FROM invoices WHERE id = $1 AND company_id = $2", [req.params.invoiceId, req.companyId]);
        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "invoice.deleted",
          entityType: "invoice",
          entityId: req.params.invoiceId,
          before: before.rows[0],
        });
        return "ok" as const;
      });

      if (deleted === "not_found") return notFound(res);
      if (deleted === "forbidden") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      res.status(204).end();
    } catch (err) {
      if (err instanceof Error && /only a draft invoice can be deleted/.test(err.message)) {
        res.status(409).json({ error: "Only a draft invoice can be deleted." });
        return;
      }
      throw err;
    }
  })
);

// ---------- Documents (generic company files) ----------

resourcesRouter.post(
  "/documents",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded." });
      return;
    }

    const saved = await saveCompanyFile(req.companyId!, req.file.buffer, req.file.originalname);

    const documentId = await withTenantContext(
      { userId: req.userId!, companyId: req.companyId! },
      async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO documents (company_id, owner_type, owner_id, file_name, file_size_bytes, content_type, storage_path, uploaded_by)
       VALUES ($1, 'general', $1, $2, $3, $4, $5, $6) RETURNING id`,
          [req.companyId, req.file!.originalname, saved.sizeBytes, req.file!.mimetype, saved.storagePath, req.userId]
        );
        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "document.uploaded",
          entityType: "document",
          entityId: result.rows[0].id,
        });
        return result.rows[0].id;
      }
    );

    res.status(201).json({ id: documentId, fileName: req.file.originalname });
  })
);

resourcesRouter.get(
  "/documents/:documentId",
  asyncHandler(async (req, res) => {
    // The document's metadata lookup is itself company-scoped (explicit
    // WHERE + RLS, doubly enforced), and readCompanyFile independently
    // refuses to serve a path outside req.companyId's own directory even
    // if the metadata lookup's scoping ever had a bug — see
    // storage/localAdapter.ts.
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        "SELECT storage_path, content_type, file_name FROM documents WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL",
        [req.params.documentId, req.companyId]
      )
    );

    const doc = result.rows[0];
    if (!doc) return notFound(res);

    const buffer = await readCompanyFile(req.companyId!, doc.storage_path);
    res.setHeader("Content-Type", doc.content_type ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.file_name}"`);
    res.send(buffer);
  })
);
