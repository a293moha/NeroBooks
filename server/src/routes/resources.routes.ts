import { Router } from "express";
import multer from "multer";
import { withTenantContext } from "../db/context.js";
import { requireAuth, requireCompanyAccess } from "../auth/middleware.js";
import { recordAuditEntry } from "../services/auditService.js";
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
        `SELECT id, invoice_number, customer_id, status, total, currency
       FROM invoices WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [req.params.invoiceId, req.companyId]
      )
    );
    if (result.rows.length === 0) return notFound(res);
    res.json(result.rows[0]);
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
