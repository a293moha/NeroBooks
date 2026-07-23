import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

/**
 * Local-disk storage adapter, scoped one directory per company:
 * `<STORAGE_ROOT>/<companyId>/<uuid>-<sanitized-original-name>`.
 *
 * This is a reference implementation for this repo/sandbox. A real
 * deployment should swap this for an S3/GCS adapter with the identical
 * scoping principle — one bucket prefix (or a bucket per company, for
 * stronger isolation) keyed by the server-verified company id, never a
 * client-supplied path. Every caller in this codebase passes `companyId`
 * from `req.companyId` (set only by requireCompanyAccess after a verified
 * membership check) — never from a request body/header/query string.
 *
 * `assertPathWithinCompanyDir` is a second, independent defense: even if a
 * `documents.storage_path` value were somehow wrong (a bug elsewhere, a
 * corrupted row), a read/write is refused unless the resolved filesystem
 * path is physically inside the *caller's own* company directory. Path
 * traversal via a crafted original filename (e.g. `../../etc/passwd`) is
 * also closed off by sanitizing the filename before it ever reaches the
 * filesystem.
 */

function sanitizeFileName(name: string): string {
  const base = path.basename(name); // strips any directory components
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150) || "file";
}

function companyDir(companyId: string): string {
  return path.resolve(config.storageRoot, companyId);
}

function assertPathWithinCompanyDir(companyId: string, fullPath: string): void {
  const dir = companyDir(companyId);
  const resolved = path.resolve(fullPath);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
    throw new Error(`Refusing storage access: resolved path escapes company ${companyId}'s directory.`);
  }
}

export interface SavedFile {
  storagePath: string; // relative to STORAGE_ROOT, e.g. "<companyId>/<uuid>-name.pdf"
  sizeBytes: number;
}

export async function saveCompanyFile(
  companyId: string,
  buffer: Buffer,
  originalName: string
): Promise<SavedFile> {
  const dir = companyDir(companyId);
  await mkdir(dir, { recursive: true });

  const fileName = `${randomUUID()}-${sanitizeFileName(originalName)}`;
  const fullPath = path.join(dir, fileName);
  assertPathWithinCompanyDir(companyId, fullPath);

  await writeFile(fullPath, buffer);
  return { storagePath: `${companyId}/${fileName}`, sizeBytes: buffer.length };
}

export async function readCompanyFile(companyId: string, storagePath: string): Promise<Buffer> {
  const fullPath = path.resolve(config.storageRoot, storagePath);
  assertPathWithinCompanyDir(companyId, fullPath);
  return readFile(fullPath);
}

export async function deleteCompanyFile(companyId: string, storagePath: string): Promise<void> {
  const fullPath = path.resolve(config.storageRoot, storagePath);
  assertPathWithinCompanyDir(companyId, fullPath);
  await unlink(fullPath).catch(() => undefined); // already gone is not an error
}
