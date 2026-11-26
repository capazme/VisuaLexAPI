import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '../lib/db';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';

/**
 * A case's act files at rest (LC50). Testing only: no real client file until an off-server backup exists.
 *
 * Each file has its own random 256-bit key. The content is encrypted with it (AES-256-GCM, a random 96-bit IV),
 * and the key is wrapped with the server key, `PRATICA_FILES_KEY` (32 bytes, base64; AES-256-GCM too). The file's
 * id is the additional authenticated data of both, so a blob or a wrapped key moved under another id does not open.
 *
 * - on disk, `PRATICA_FILES_DIR/<userId>/<dossierId>/<fileId>`: iv (12) | tag (16) | ciphertext. Never the name.
 * - in Postgres, `pratica_files.chiave_cifrata`: iv (12) | tag (16) | wrapped key (32), plus the metadata in clear
 *   (name, type, size, SHA-256 of the plaintext).
 * - the server key: only in the server's environment (apps/server/.env on the host), never in the repository,
 *   the database or the volume.
 *
 * The key and the directory are read at each call, not at import: without them the server starts and the file
 * routes answer 503.
 */

const ALG = 'aes-256-gcm';
const IV = 12;
const TAG = 16;
// Ids come from Postgres (uuid); anything else never reaches a path.
const SAFE_ID = /^[0-9a-zA-Z-]{1,64}$/;

export interface StoreConfig {
  dir: string;
  key: Buffer;
}

/** The store's settings, or null when the key is missing or not exactly 32 bytes, or the directory is unset. */
export function storeConfig(): StoreConfig | null {
  const dir = process.env.PRATICA_FILES_DIR;
  const raw = process.env.PRATICA_FILES_KEY;
  if (!dir || !raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) return null;
  return { dir: path.resolve(dir), key };
}

export function requireStore(): StoreConfig {
  const config = storeConfig();
  if (!config) throw new AppError(503, "L'archivio dei file della pratica non è configurato su questo server.");
  return config;
}

function safe(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error('unsafe id in a file path');
  return id;
}

const userDir = (dir: string, userId: string) => path.join(dir, safe(userId));
const dossierDir = (dir: string, userId: string, dossierId: string) => path.join(userDir(dir, userId), safe(dossierId));
const blobPath = (dir: string, userId: string, dossierId: string, fileId: string) => path.join(dossierDir(dir, userId, dossierId), safe(fileId));

function seal(key: Buffer, plain: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv(ALG, key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Throws when the tag does not verify: nothing unauthenticated ever comes out. */
function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  const decipher = createDecipheriv(ALG, key, sealed.subarray(0, IV));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
  return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]);
}

/** Encrypts and writes a new file; returns its wrapped key, for the row. Written to a temporary name, then renamed. */
export async function writeBlob(config: StoreConfig, ids: { userId: string; dossierId: string; fileId: string }, plain: Buffer): Promise<Buffer> {
  const fileKey = randomBytes(32);
  const target = blobPath(config.dir, ids.userId, ids.dossierId, ids.fileId);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(`${target}.tmp`, seal(fileKey, plain, ids.fileId), { mode: 0o600 });
  await rename(`${target}.tmp`, target);
  return seal(config.key, fileKey, ids.fileId);
}

/**
 * A tag that does not verify (the server key changed since the file was stored, or the blob or its wrapped key
 * was altered) is a 500 with a message that says so; no byte of the file goes out. There is no key rotation:
 * a lost or changed PRATICA_FILES_KEY makes every stored file unreadable.
 */
export async function readBlob(config: StoreConfig, row: { id: string; userId: string; dossierId: string; chiaveCifrata: Uint8Array }): Promise<Buffer> {
  const sealed = await readFile(blobPath(config.dir, row.userId, row.dossierId, row.id));
  try {
    return open(open(config.key, Buffer.from(row.chiaveCifrata), row.id), sealed, row.id);
  } catch {
    throw new AppError(500, 'Il file non si può decifrare: la chiave del server è cambiata o il file è danneggiato.');
  }
}

/** Removes one file from disk; a file already gone is not an error. */
export async function removeBlob(dir: string, row: { id: string; userId: string; dossierId: string }): Promise<void> {
  await unlink(blobPath(dir, row.userId, row.dossierId, row.id)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

/** The store's directory for removals: they need no key, so a server without one still deletes. */
const removalDir = () => (process.env.PRATICA_FILES_DIR ? path.resolve(process.env.PRATICA_FILES_DIR) : null);

/**
 * A dossier gone for good (its trash entry emptied or swept), inside the transaction that deletes the entry: its
 * files' rows (with their wrapped keys), its instructions, and one `cancellazione` line per file. Nothing when a
 * live dossier holds the id. Returns whether there is a directory to remove after the commit.
 */
export async function deleteDossierFileRows(tx: Prisma.TransactionClient, userId: string, dossierId: string): Promise<boolean> {
  if (await tx.dossier.findFirst({ where: { id: dossierId }, select: { id: true } })) return false;
  const files = await tx.praticaFile.findMany({ where: { userId, dossierId }, select: { id: true } });
  await tx.praticaFile.deleteMany({ where: { userId, dossierId } });
  await tx.praticaIstruzioni.deleteMany({ where: { userId, dossierId } });
  await tx.praticaFileAccesso.createMany({ data: files.map((f) => ({ userId, dossierId, fileId: f.id, azione: 'cancellazione' as const })) });
  return true;
}

const logRemovalFailure = (error: unknown) =>
  console.error(`[pratica-files] removal from disk failed: ${error instanceof Error ? error.name : typeof error}`);

/**
 * After the commit, best-effort: a directory left by a failure holds only blobs whose wrapped keys are gone with
 * their rows, so nothing in it can be decrypted. The kind of error is logged, never a path.
 */
export async function removeDossierDir(userId: string, dossierId: string): Promise<void> {
  const dir = removalDir();
  if (dir) await rm(dossierDir(dir, userId, dossierId), { recursive: true, force: true }).catch(logRemovalFailure);
}

/** An account gone: its directory (the rows went with the user's cascade). Best-effort, as above. */
export async function removeUserFiles(userId: string): Promise<void> {
  const dir = removalDir();
  if (dir) await rm(userDir(dir, userId), { recursive: true, force: true }).catch(logRemovalFailure);
}

/**
 * The decrypted content of a live file of the user's, for internal use only: no route calls it (the MCP's text
 * route, LC56, reads through `ownFile` and `readBlob`, which also check the dossier in the path). 404 when the file
 * is not the user's, in the trash, or its dossier is gone. It writes no access-log line: a caller must.
 */
export async function readPraticaFileContent(userId: string, fileId: string): Promise<Buffer> {
  const config = requireStore();
  const row = await prisma.praticaFile.findFirst({ where: { id: fileId, userId, deletedAt: null } });
  if (!row || !(await prisma.dossier.findFirst({ where: { id: row.dossierId, userId }, select: { id: true } }))) {
    throw new AppError(404, 'File non trovato.');
  }
  return readBlob(config, row);
}
