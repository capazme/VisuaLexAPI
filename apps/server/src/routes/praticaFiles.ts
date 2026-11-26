import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z, ZodError } from 'zod';
import type { Prisma, PraticaFileAzione } from '../lib/db';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { hasNoNul } from '../lingo/noNul';
import { prisma } from '../lib/prisma';
import { provenanceFromRequest } from '../controllers/dossierController';
import { readBlob, removeBlob, requireStore, writeBlob } from '../pratica/fileStore';
import { EXTRACTABLE, PDF_MIME, extractText, pdfText, textToDocx } from '../pratica/docText';
import { advisoryXactLock } from '../lib/sqlDialect';

/**
 * A case's act files and its instructions for Claude (LC50, server part; testing only, no real client files).
 * Mounted at `/api/dossiers`. The user's session, and for three routes an exchanged MCP token too (LC56, below);
 * every other route here is outside the delegated table, so a token gets the default-deny 403 there.
 *
 * - `GET    /:dossierId/files` — `{ files: [original + versioni[]], cestino: [] }`;
 * - `POST   /:dossierId/files` (multipart, field `file`) — 201 `{ file }`;
 * - `GET    /:dossierId/files/:fileId/content` — the file, decrypted, as an attachment with its name;
 * - `POST   /:dossierId/files/:fileId/versions` (multipart) — 201 `{ file }`, a new version under the original;
 * - `POST   /:dossierId/files/:fileId/trash` · `/restore` — `{ file }`; an original takes its versions with it;
 * - `DELETE /:dossierId/files/:fileId` — 204, only from the trash: the rows and the files on disk go;
 * - `GET|PUT /:dossierId/istruzioni { testo }` — `{ istruzioni }`.
 *
 * In the delegated table since LC56 (owner, 16 November 2026; testing only), each for the dossier's owner:
 * - `GET  /:dossierId/contesto` — `{ istruzioni, files }`: the instructions and the live files, no trash;
 * - `GET  /:dossierId/files/:fileId/text?parte=n` — `{ file, parte, parti, testo, motivo }`: the text extracted from
 *   a PDF (LC57), DOCX, ODT or TXT, in parts; a DOC, RTF, image or scan answers `testo: null` and says why;
 * - `POST /:dossierId/files/atto { nome, testo, versioneDi? }` — 201 `{ file }`: the text made a DOCX and deposited as
 *   a new file or a new version, as the uploads are (same ceilings, lock and log line); never over another file.
 *
 * Another user's dossier or file answers 404, never 403. Without the server key the file routes answer 503 (the
 * instructions hold no file and keep working). Each listing, download, deposit, trash, restore and deletion
 * writes a line in `pratica_file_accessi`. A file name may name a client: no log line repeats it.
 */
const router = Router();

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CASE_BYTES = 500 * 1024 * 1024;
export const MAX_USER_BYTES = 2 * 1024 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_ISTRUZIONI = 20_000;
/** An act Claude deposits, in characters: its JSON stays well under the 2 MB the API parses. */
export const MAX_ATTO_CHARS = 500_000;
/** The text of a file goes out in parts of this many characters. */
export const TEXT_PAGE = 50_000;

// ─── What a file is, from its first bytes ────────────────────────────────────────────────────────────────

const startsWith = (buf: Buffer, sig: number[] | string, at = 0) => {
  const bytes = typeof sig === 'string' ? Buffer.from(sig, 'latin1') : Buffer.from(sig);
  return buf.length >= at + bytes.length && buf.subarray(at, at + bytes.length).equals(bytes);
};
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const isUtf8Text = (buf: Buffer) => {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
};

/**
 * The formats allowed, by extension, each with the check its content must pass. The extension must agree with
 * the content: a text named `.pdf` is refused. Limits, said in the PR: DOCX and ODT are ZIPs recognised by an
 * entry name; the DOC check is the OLE header, which Excel and PowerPoint files share.
 */
const FORMATS: Record<string, { mime: string; matches: (buf: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', matches: (b) => startsWith(b, '%PDF-') },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    matches: (b) => startsWith(b, ZIP) && b.includes('word/document.xml'),
  },
  // An ODF package stores its type first, uncompressed: the entry `mimetype` at byte 30, its content right after.
  odt: {
    mime: 'application/vnd.oasis.opendocument.text',
    matches: (b) => startsWith(b, ZIP) && startsWith(b, 'mimetypeapplication/vnd.oasis.opendocument.text', 30),
  },
  doc: { mime: 'application/msword', matches: (b) => startsWith(b, OLE) },
  rtf: { mime: 'application/rtf', matches: (b) => startsWith(b, '{\\rtf') },
  txt: { mime: 'text/plain', matches: isUtf8Text },
  jpg: { mime: 'image/jpeg', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: 'image/jpeg', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  png: { mime: 'image/png', matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
};

export function detectMime(buf: Buffer, name: string): string | null {
  const format = FORMATS[path.extname(name).slice(1).toLowerCase()];
  return format && buf.length > 0 && format.matches(buf) ? format.mime : null;
}

/** The name shown: no path, no control character, at most 255 characters. */
function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const name = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 255);
  return name || 'file';
}

// ─── The upload, as merlt/contrib.ts does it ─────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  // One file, nothing else buffered. UTF-8 file names: an accented Italian name otherwise arrives as latin1.
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 1 },
  defParamCharset: 'utf8',
});

/** A body whose declared length is over the ceiling is refused before anything reads it. */
function rejectOversized(req: Request, res: Response, next: NextFunction): void {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    res.set('Connection', 'close');
    res.status(413).json({ detail: 'Il file supera 25 MB.' });
    return;
  }
  next();
}

function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ detail: 'Il file supera 25 MB.' });
      return;
    }
    res.status(400).json({ detail: 'Caricamento non valido: un solo file, nel campo «file».' });
  });
}

// ─── Guards ──────────────────────────────────────────────────────────────────────────────────────────────

const wrap = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
  handler(req, res).catch((error: unknown) => {
    if (error instanceof ZodError) return next(new AppError(400, error.issues[0]?.message ?? 'Richiesta non valida.'));
    if (error instanceof AppError) return next(error);
    console.error('[pratica-files] unexpected error:', error instanceof Error ? error.name : typeof error);
    next(new AppError(500, 'Errore interno.'));
  });

/** 503 before the body is read when the store has no key. */
const storeGuard = (_req: Request, _res: Response, next: NextFunction) => {
  try {
    requireStore();
    next();
  } catch (error) {
    next(error);
  }
};

/** The dossier is the caller's, or a 404 that says nothing of anyone else's. */
const ownDossier = (req: Request, _res: Response, next: NextFunction) => {
  const { dossierId } = req.params;
  if (!hasNoNul(dossierId)) return next(new AppError(404, 'Pratica non trovata.'));
  prisma.dossier
    .findFirst({ where: { id: dossierId, userId: req.user!.id }, select: { id: true } })
    .then((dossier) => next(dossier ? undefined : new AppError(404, 'Pratica non trovata.')))
    .catch(() => next(new AppError(500, 'Errore interno.')));
};

const files = [authenticate, storeGuard, ownDossier];
const uploads = [authenticate, storeGuard, rejectOversized, ownDossier, uploadSingle];

// ─── Rows ────────────────────────────────────────────────────────────────────────────────────────────────

// Every column but the wrapped key, which never leaves the server.
const PUBLIC = {
  id: true, dossierId: true, nome: true, mime: true, peso: true, sha256: true, versioneDi: true, versione: true,
  autore: true, createdByClientId: true, createdByClientName: true, pseudonimizzato: true, createdAt: true, updatedAt: true, deletedAt: true,
} as const satisfies Prisma.PraticaFileSelect;
type PublicRow = Prisma.PraticaFileGetPayload<{ select: typeof PUBLIC }>;

const serialize = ({ createdByClientId, createdByClientName, ...row }: PublicRow) => ({
  ...row,
  createdBy: createdByClientId ? { clientName: createdByClientName } : null,
});

async function ownFile(req: Request, where: Prisma.PraticaFileWhereInput = {}, db: Prisma.TransactionClient = prisma) {
  const { fileId, dossierId } = req.params;
  const row = hasNoNul(fileId) ? await db.praticaFile.findFirst({ where: { id: fileId, dossierId, userId: req.user!.id, ...where } }) : null;
  if (!row) throw new AppError(404, 'File non trovato.');
  return row;
}

/** One change to a user's case files at a time: deposits, trash, restore and deletion queue on it. */
const lockUserFiles = (tx: Prisma.TransactionClient, userId: string) =>
  advisoryXactLock(tx, `pratica-files:${userId}`);

const logLine = (req: Request, azione: PraticaFileAzione, fileId: string | null) => {
  const { createdByClientId, createdByClientName } = provenanceFromRequest(req);
  return { userId: req.user!.id, dossierId: req.params.dossierId, fileId, azione, clientId: createdByClientId, clientName: createdByClientName };
};

// ─── Files ───────────────────────────────────────────────────────────────────────────────────────────────

router.get('/:dossierId/files', files, wrap(async (req, res) => {
  const rows = await prisma.praticaFile.findMany({
    where: { userId: req.user!.id, dossierId: req.params.dossierId },
    orderBy: [{ createdAt: 'asc' }, { versione: 'asc' }, { id: 'asc' }],
    select: PUBLIC,
  });
  await prisma.praticaFileAccesso.create({ data: logLine(req, 'elenco', null) });
  res.json({ files: originals(rows), cestino: rows.filter((row) => row.deletedAt).map(serialize) });
}));

/** The live files, each original with its versions in order. */
const originals = (rows: PublicRow[]) => {
  const live = rows.filter((row) => !row.deletedAt);
  return live.filter((row) => !row.versioneDi).map((original) => ({
    ...serialize(original),
    versioni: live.filter((v) => v.versioneDi === original.id).sort((a, b) => a.versione - b.versione).map(serialize),
  }));
};

/** Stores a file, or a new version of `baseId`'s group, under the ceilings, the user's lock held. */
async function deposit(req: Request, res: Response, file: { buffer: Buffer; originalname: string; size: number } | undefined, baseId?: string) {
  const config = requireStore();
  if (!file) throw new AppError(400, 'Nessun file: va nel campo «file».');
  const mime = detectMime(file.buffer, file.originalname);
  if (!mime) throw new AppError(415, 'Formato non ammesso: PDF, DOCX, DOC, ODT, RTF, TXT, JPG o PNG, controllati sul contenuto.');
  const userId = req.user!.id;
  const { dossierId } = req.params;
  const fileId = randomUUID();
  const provenance = provenanceFromRequest(req);
  let written = false;
  try {
    const row = await prisma.$transaction(async (tx) => {
      // The sums below and the insert cannot race another upload, nor a trash of the version's original.
      await lockUserFiles(tx, userId);
      let versioneDi: string | null = null;
      let versione = 1;
      if (baseId) {
        const base = hasNoNul(baseId) ? await tx.praticaFile.findFirst({ where: { id: baseId, userId, dossierId, deletedAt: null } }) : null;
        if (!base) throw new AppError(404, 'File non trovato.');
        versioneDi = base.versioneDi ?? base.id;
        const last = await tx.praticaFile.aggregate({ where: { OR: [{ id: versioneDi }, { versioneDi }] }, _max: { versione: true } });
        versione = (last._max.versione ?? 1) + 1;
      }
      // The trash counts: its files are still on disk.
      const inCase = await tx.praticaFile.aggregate({ where: { userId, dossierId }, _sum: { peso: true } });
      if ((inCase._sum.peso ?? 0) + file.size > MAX_CASE_BYTES) throw new AppError(413, 'La pratica supera 500 MB di file (cestino compreso).');
      const inAccount = await tx.praticaFile.aggregate({ where: { userId }, _sum: { peso: true } });
      if ((inAccount._sum.peso ?? 0) + file.size > MAX_USER_BYTES) throw new AppError(413, 'Il tuo account supera 2 GB di file (cestino compreso).');

      const chiaveCifrata = await writeBlob(config, { userId, dossierId, fileId }, file.buffer);
      written = true;
      const created = await tx.praticaFile.create({
        data: {
          id: fileId,
          userId,
          dossierId,
          nome: cleanName(file.originalname),
          mime,
          peso: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          versioneDi,
          versione,
          autore: provenance.createdByClientId ? 'claude' : 'utente',
          ...provenance,
          // Prisma 7 types Bytes as a Uint8Array over its own ArrayBuffer; a Buffer may sit on a shared one.
          chiaveCifrata: Uint8Array.from(chiaveCifrata),
        },
        select: PUBLIC,
      });
      await tx.praticaFileAccesso.create({ data: logLine(req, 'deposito', fileId) });
      return created;
    }, { timeout: 30_000 });
    res.status(201).json({ file: serialize(row) });
  } catch (error) {
    // The row was not written: the blob goes too.
    if (written) await removeBlob(config.dir, { id: fileId, userId, dossierId }).catch(() => undefined);
    throw error;
  }
}

router.post('/:dossierId/files', uploads, wrap((req, res) => deposit(req, res, req.file)));
router.post('/:dossierId/files/:fileId/versions', uploads, wrap((req, res) => deposit(req, res, req.file, req.params.fileId)));

router.get('/:dossierId/files/:fileId/content', files, wrap(async (req, res) => {
  const config = requireStore();
  const row = await ownFile(req, { deletedAt: null });
  // Decrypted whole and its tag verified before a byte is sent (25 MB at most): no unauthenticated plaintext.
  const content = await readBlob(config, row);
  await prisma.praticaFileAccesso.create({ data: logLine(req, 'scaricamento', row.id) });
  res.set('Cache-Control', 'no-store');
  res.attachment(row.nome);
  res.type(row.mime);
  res.send(content);
}));

/** The rows a trash, restore or deletion of `row` reaches: an original takes its versions with it. */
const groupOf = (row: { id: string; versioneDi: string | null }): Prisma.PraticaFileWhereInput =>
  row.versioneDi ? { id: row.id } : { OR: [{ id: row.id }, { versioneDi: row.id }] };

router.post('/:dossierId/files/:fileId/trash', files, wrap(async (req, res) => {
  const row = await prisma.$transaction(async (tx) => {
    await lockUserFiles(tx, req.user!.id);
    const found = await ownFile(req, { deletedAt: null }, tx);
    await tx.praticaFile.updateMany({ where: { ...groupOf(found), userId: req.user!.id, deletedAt: null }, data: { deletedAt: new Date() } });
    await tx.praticaFileAccesso.create({ data: logLine(req, 'cestino', found.id) });
    return found;
  });
  res.json({ file: serialize(await prisma.praticaFile.findUniqueOrThrow({ where: { id: row.id }, select: PUBLIC })) });
}));

router.post('/:dossierId/files/:fileId/restore', files, wrap(async (req, res) => {
  const row = await prisma.$transaction(async (tx) => {
    await lockUserFiles(tx, req.user!.id);
    const found = await ownFile(req, { deletedAt: { not: null } }, tx);
    if (found.versioneDi && (await tx.praticaFile.count({ where: { id: found.versioneDi, deletedAt: { not: null } } })) > 0) {
      throw new AppError(409, "Ripristina prima l'originale di questa versione.");
    }
    // The versions that went with the original (same time) come back with it; one trashed before stays.
    await tx.praticaFile.updateMany({ where: { ...groupOf(found), userId: req.user!.id, deletedAt: found.deletedAt }, data: { deletedAt: null } });
    await tx.praticaFileAccesso.create({ data: logLine(req, 'ripristino', found.id) });
    return found;
  });
  res.json({ file: serialize(await prisma.praticaFile.findUniqueOrThrow({ where: { id: row.id }, select: PUBLIC })) });
}));

router.delete('/:dossierId/files/:fileId', files, wrap(async (req, res) => {
  const config = requireStore();
  const gone = await prisma.$transaction(async (tx) => {
    await lockUserFiles(tx, req.user!.id);
    const row = await ownFile(req, {}, tx);
    if (!row.deletedAt) throw new AppError(409, 'Sposta prima il file nel cestino.');
    const group = await tx.praticaFile.findMany({ where: { ...groupOf(row), userId: req.user!.id }, select: { id: true, userId: true, dossierId: true } });
    await tx.praticaFile.deleteMany({ where: { id: { in: group.map((g) => g.id) } } });
    await tx.praticaFileAccesso.createMany({ data: group.map((g) => logLine(req, 'cancellazione', g.id)) });
    return group;
  });
  // After the commit: a file left on disk by a failure here is unreadable without its row's wrapped key.
  for (const file of gone) {
    await removeBlob(config.dir, file).catch((error: unknown) => console.error('[pratica-files] removal failed:', error instanceof Error ? error.name : typeof error));
  }
  res.status(204).end();
}));

// ─── What an MCP token may do (LC56) ─────────────────────────────────────────────────────────────────────

/** The case as Claude reads it first: the lawyer's instructions and the live files. One `elenco` line. */
router.get('/:dossierId/contesto', [authenticate, ownDossier], wrap(async (req, res) => {
  const { dossierId } = req.params;
  const istruzioni = await prisma.praticaIstruzioni.findFirst({ where: { dossierId, userId: req.user!.id } });
  const rows = await prisma.praticaFile.findMany({
    where: { userId: req.user!.id, dossierId, deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { versione: 'asc' }, { id: 'asc' }],
    select: PUBLIC,
  });
  await prisma.praticaFileAccesso.create({ data: logLine(req, 'elenco', null) });
  res.json({ istruzioni: serializeIstruzioni(istruzioni), files: originals(rows) });
}));

const KIND: Record<string, string> = {
  'application/pdf': 'PDF', 'application/msword': 'DOC', 'application/rtf': 'RTF',
};

const parteQuery = z.coerce.number().int().min(1).max(10_000).default(1);

/**
 * The text of a live file, a part at a time, never its bytes. One `scaricamento` line per read that gives out text,
 * with the client (the log has no separate value for a text read; adding one is a schema change). Images, scans,
 * damaged files and the formats without an extractor answer `testo: null`, say why and write no line (LC57).
 */
router.get('/:dossierId/files/:fileId/text', files, wrap(async (req, res) => {
  const config = requireStore();
  // The text of a client's act goes to the model only for a grant that consented to the texts' current words.
  if (req.delegation && !req.delegation.readsActs) {
    throw new AppError(403, "Per leggere i file della pratica l'applicazione va ricollegata: il permesso «Leggere i testi» ora comprende anche gli atti.");
  }
  const parte = parteQuery.parse(req.query.parte);
  const row = await ownFile(req, { deletedAt: null });
  let text: string | null = null;
  let motivo: string | null = null;
  if (row.mime.startsWith('image/')) motivo = "È un'immagine: il testo non si estrae.";
  else if (row.mime === PDF_MIME) ({ text, motivo } = await pdfText(await readBlob(config, row)));
  else if (!EXTRACTABLE.has(row.mime)) motivo = `Il testo di un file ${KIND[row.mime] ?? row.mime} non si estrae ancora: solo PDF, DOCX, ODT e TXT.`;
  else {
    text = extractText(await readBlob(config, row), row.mime);
    if (text === null) motivo = 'Il file non si legge: è danneggiato o non è un documento valido.';
  }
  const parti = Math.max(1, Math.ceil((text?.length ?? 0) / TEXT_PAGE));
  if (parte > parti) throw new AppError(400, `Il testo ha ${parti} ${parti === 1 ? 'parte' : 'parti'}.`);
  if (text !== null) await prisma.praticaFileAccesso.create({ data: logLine(req, 'scaricamento', row.id) });
  res.set('Cache-Control', 'no-store');
  res.json({
    file: { id: row.id, nome: row.nome, mime: row.mime, versione: row.versione, versioneDi: row.versioneDi, autore: row.autore },
    parte,
    parti,
    testo: text === null ? null : text.slice((parte - 1) * TEXT_PAGE, parte * TEXT_PAGE),
    motivo,
  });
}));

// Plain text: new lines and tabs, nothing else below U+0020 (as the glosses route takes it).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const attoBody = z
  .object({
    nome: z.string().trim().min(1).max(200).refine((text) => !CONTROL.test(text), { message: 'Il nome contiene un carattere non valido.' }),
    testo: z
      .string()
      .min(1, { message: "L'atto è vuoto." })
      .max(MAX_ATTO_CHARS, { message: "L'atto è troppo lungo (al massimo 500.000 caratteri)." })
      .refine((text) => !CONTROL.test(text), { message: 'Il testo contiene un carattere non valido.' }),
    versioneDi: z.string().min(1).max(64).optional(),
  })
  .strict();

/** An act as text, made a DOCX and deposited as a new file or a new version: the original is never touched. */
router.post('/:dossierId/files/atto', files, wrap(async (req, res) => {
  const { nome, testo, versioneDi } = attoBody.parse(req.body);
  const buffer = textToDocx(testo);
  const originalname = `${cleanName(nome).replace(/\.docx$/i, '').slice(0, 250)}.docx`;
  // `deposit` checks the type on the content, as it does for an upload.
  await deposit(req, res, { buffer, originalname, size: buffer.length }, versioneDi);
}));

// ─── Instructions for Claude ─────────────────────────────────────────────────────────────────────────────

const istruzioniBody = z
  .object({
    testo: z
      .string()
      .max(MAX_ISTRUZIONI, { message: 'Le istruzioni sono troppo lunghe (al massimo 20.000 caratteri).' })
      .refine(hasNoNul, { message: 'Il testo contiene un carattere non valido.' }),
  })
  .strict();

const serializeIstruzioni = (row: { testo: string; updatedAt: Date; updatedByClientId: string | null; updatedByClientName: string | null } | null) => ({
  testo: row?.testo ?? '',
  updatedAt: row?.updatedAt ?? null,
  updatedBy: row?.updatedByClientId ? { clientName: row.updatedByClientName } : null,
});

router.get('/:dossierId/istruzioni', [authenticate, ownDossier], wrap(async (req, res) => {
  const row = await prisma.praticaIstruzioni.findFirst({ where: { dossierId: req.params.dossierId, userId: req.user!.id } });
  res.json({ istruzioni: serializeIstruzioni(row) });
}));

router.put('/:dossierId/istruzioni', [authenticate, ownDossier], wrap(async (req, res) => {
  const { testo } = istruzioniBody.parse(req.body);
  const { createdByClientId, createdByClientName } = provenanceFromRequest(req);
  const by = { updatedByClientId: createdByClientId, updatedByClientName: createdByClientName };
  const row = await prisma.praticaIstruzioni.upsert({
    where: { dossierId: req.params.dossierId },
    create: { dossierId: req.params.dossierId, userId: req.user!.id, testo, ...by },
    update: { testo, ...by },
  });
  res.json({ istruzioni: serializeIstruzioni(row) });
}));

export default router;
