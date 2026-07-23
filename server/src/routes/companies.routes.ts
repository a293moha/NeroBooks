import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { withTenantContext } from "../db/context.js";
import { requireAuth, requireCompanyAccess } from "../auth/middleware.js";
import { recordAuditEntry } from "../services/auditService.js";
import { createCompanyWithOwner } from "../services/companyService.js";
import { saveCompanyFile, readCompanyFile } from "../storage/localAdapter.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const companiesRouter = Router();
companiesRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

/**
 * Create a new company. Any authenticated user may do this — creating a
 * brand-new tenant can never cross into an existing one, so this is the
 * one company-scoped write in this file that does NOT go through
 * requireCompanyAccess (there is no membership to check yet). The new
 * company's id is generated here, in the application, specifically so the
 * very first INSERT can run under that id as the RLS context (see
 * companies_insert / company_memberships_insert policies in
 * 0017_row_level_security.up.sql) rather than needing any RLS bypass.
 */
companiesRouter.post("/", asyncHandler(async (req, res) => {
  const { name, legalName, defaultCurrency, timezone, countryCode } = req.body ?? {};

  if (typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Company name is required." });
    return;
  }

  const companyId = randomUUID();

  const company = await withTenantContext({ userId: req.userId!, companyId }, async (client) => {
    await createCompanyWithOwner(client, {
      companyId,
      ownerUserId: req.userId!,
      name: name.trim(),
      legalName: typeof legalName === "string" ? legalName.trim() : null,
      defaultCurrency: typeof defaultCurrency === "string" ? defaultCurrency.toUpperCase() : undefined,
      timezone: typeof timezone === "string" ? timezone : undefined,
      countryCode: typeof countryCode === "string" ? countryCode.toUpperCase() : null,
    });

    // No RETURNING inside createCompanyWithOwner: Postgres re-checks the
    // companies table's SELECT policy against a RETURNING clause's result
    // row, and no company_memberships row exists until that function's
    // last statement runs — so this SELECT happens only now, after the
    // membership exists and the SELECT policy passes normally.
    const companyResult = await client.query(
      `SELECT id, name, legal_name, default_currency, timezone, country_code, created_at
       FROM companies WHERE id = $1`,
      [companyId]
    );

    await recordAuditEntry(client, {
      companyId,
      actorUserId: req.userId!,
      action: "company.created",
      entityType: "company",
      entityId: companyId,
      after: companyResult.rows[0],
    });

    return companyResult.rows[0];
  });

  res.status(201).json(company);
}));

companiesRouter.get("/:companyId", requireCompanyAccess, asyncHandler(async (req, res) => {
  const company = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
    client.query(
      `SELECT id, name, trading_name, legal_name, tax_id, tax_identifiers, default_currency,
              timezone, fiscal_year_start_month, address_line1, address_line2, city,
              state_province, postal_code, country_code, logo_document_id, status, created_at, updated_at
       FROM companies WHERE id = $1`,
      [req.companyId]
    )
  );

  if (company.rows.length === 0) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json(company.rows[0]);
}));

const PROFILE_FIELDS: Record<string, string> = {
  name: "name",
  tradingName: "trading_name",
  legalName: "legal_name",
  taxId: "tax_id",
  taxIdentifiers: "tax_identifiers",
  defaultCurrency: "default_currency",
  timezone: "timezone",
  fiscalYearStartMonth: "fiscal_year_start_month",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  city: "city",
  stateProvince: "state_province",
  postalCode: "postal_code",
  countryCode: "country_code",
};

companiesRouter.patch("/:companyId", requireCompanyAccess, asyncHandler(async (req, res) => {
  const body = req.body ?? {};
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [bodyKey, column] of Object.entries(PROFILE_FIELDS)) {
    if (bodyKey in body) {
      values.push(column === "tax_identifiers" ? JSON.stringify(body[bodyKey]) : body[bodyKey]);
      setClauses.push(`${column} = $${values.length}`);
    }
  }

  if (setClauses.length === 0) {
    res.status(400).json({ error: "No recognized fields to update." });
    return;
  }

  values.push(req.companyId);

  const updated = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
    const before = await client.query("SELECT * FROM companies WHERE id = $1", [req.companyId]);
    const result = await client.query(
      `UPDATE companies SET ${setClauses.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );
    await recordAuditEntry(client, {
      companyId: req.companyId!,
      actorUserId: req.userId!,
      action: "company.profile_updated",
      entityType: "company",
      entityId: req.companyId,
      before: before.rows[0],
      after: result.rows[0],
    });
    return result.rows[0];
  });

  if (!updated) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json(updated);
}));

companiesRouter.get("/:companyId/settings", requireCompanyAccess, asyncHandler(async (req, res) => {
  const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
    client.query("SELECT * FROM company_settings WHERE company_id = $1", [req.companyId])
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json(result.rows[0]);
}));

const SETTINGS_FIELDS: Record<string, string> = {
  invoiceNumberPrefix: "invoice_number_prefix",
  defaultPaymentTermsDays: "default_payment_terms_days",
  defaultPayFrequency: "default_pay_frequency",
  payrollSettings: "payroll_settings",
  accountingSettings: "accounting_settings",
};

companiesRouter.patch("/:companyId/settings", requireCompanyAccess, asyncHandler(async (req, res) => {
  const body = req.body ?? {};
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [bodyKey, column] of Object.entries(SETTINGS_FIELDS)) {
    if (bodyKey in body) {
      const isJson = column === "payroll_settings" || column === "accounting_settings";
      values.push(isJson ? JSON.stringify(body[bodyKey]) : body[bodyKey]);
      setClauses.push(`${column} = $${values.length}`);
    }
  }

  if (setClauses.length === 0) {
    res.status(400).json({ error: "No recognized fields to update." });
    return;
  }

  values.push(req.companyId);

  const updated = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
    const before = await client.query("SELECT * FROM company_settings WHERE company_id = $1", [req.companyId]);
    const result = await client.query(
      `UPDATE company_settings SET ${setClauses.join(", ")} WHERE company_id = $${values.length} RETURNING *`,
      values
    );
    await recordAuditEntry(client, {
      companyId: req.companyId!,
      actorUserId: req.userId!,
      action: "company.settings_updated",
      entityType: "company_settings",
      entityId: req.companyId,
      before: before.rows[0],
      after: result.rows[0],
    });
    return result.rows[0];
  });

  res.json(updated);
}));

companiesRouter.post("/:companyId/logo", requireCompanyAccess, upload.single("logo"), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded." });
    return;
  }
  if (!req.file.mimetype.startsWith("image/")) {
    res.status(400).json({ error: "Logo must be an image file." });
    return;
  }

  const saved = await saveCompanyFile(req.companyId!, req.file.buffer, req.file.originalname);

  const documentId = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
    const docResult = await client.query<{ id: string }>(
      `INSERT INTO documents (company_id, owner_type, owner_id, file_name, file_size_bytes, content_type, storage_path, uploaded_by)
       VALUES ($1, 'company_logo', $1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.companyId, req.file!.originalname, saved.sizeBytes, req.file!.mimetype, saved.storagePath, req.userId]
    );
    const docId = docResult.rows[0].id;
    await client.query("UPDATE companies SET logo_document_id = $1 WHERE id = $2", [docId, req.companyId]);
    await recordAuditEntry(client, {
      companyId: req.companyId!,
      actorUserId: req.userId!,
      action: "company.logo_updated",
      entityType: "document",
      entityId: docId,
    });
    return docId;
  });

  res.status(201).json({ documentId });
}));

companiesRouter.get("/:companyId/logo", requireCompanyAccess, asyncHandler(async (req, res) => {
  const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
    client.query(
      `SELECT d.storage_path, d.content_type FROM companies c
       JOIN documents d ON d.id = c.logo_document_id
       WHERE c.id = $1`,
      [req.companyId]
    )
  );

  const doc = result.rows[0];
  if (!doc) {
    res.status(404).json({ error: "Not found." });
    return;
  }

  const buffer = await readCompanyFile(req.companyId!, doc.storage_path);
  res.setHeader("Content-Type", doc.content_type ?? "application/octet-stream");
  res.send(buffer);
}));
