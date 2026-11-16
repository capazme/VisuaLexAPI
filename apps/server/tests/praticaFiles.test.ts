import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { deleteUserAccount } from '../src/lingo/deleteUserAccount';
import { sweepExpiredTrash } from '../src/trash/trash';
import { readPraticaFileContent } from '../src/pratica/fileStore';

/** A case's act files (LC50): encrypted at rest, versions, trash, instructions, access log, owner only. */

const SECRET = 'Il signor Mario Rossi, cliente riservato';
const PDF = Buffer.from(`%PDF-1.4\n1 0 obj << /Title (${SECRET}) >> endobj\n%%EOF\n`);
// The ZIP signature and the entry name Word writes: enough for the check on the first bytes.
const DOCX = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.from(`\x14\x00\x00\x00word/document.xml ${SECRET} [Content_Types].xml`)]);
const ODT = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(26), Buffer.from('mimetypeapplication/vnd.oasis.opendocument.text rest')]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const EXE = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'), randomBytes(64)]);

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pratica-files-'));
  process.env.PRATICA_FILES_DIR = dir;
  // A test key, generated here: never a real one.
  process.env.PRATICA_FILES_KEY = randomBytes(32).toString('base64');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.PRATICA_FILES_DIR;
  delete process.env.PRATICA_FILES_KEY;
});

async function setup(name: string) {
  const user = await createTestUser(name);
  const dossier = await prisma.dossier.create({ data: { name: 'Pratica', userId: user.id } });
  return { user, dossier };
}

const upload = (user: TestUser, dossierId: string, buf: Buffer, name: string) =>
  request(app).post(`/api/dossiers/${dossierId}/files`).set(authHeader(user)).attach('file', buf, name);

/** Every file under the store, as paths relative to it. */
function filesOnDisk(): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
}

describe('Pratica files', () => {
  it('uploads, lists and downloads a file identical to the original, encrypted on disk', async () => {
    const { user, dossier } = await setup('pf-owner');
    const res = await upload(user, dossier.id, PDF, 'Atto di citazione.pdf');
    expect(res.status).toBe(201);
    expect(res.body.file).toMatchObject({ nome: 'Atto di citazione.pdf', mime: 'application/pdf', peso: PDF.length, sha256: sha(PDF), versione: 1, versioneDi: null, autore: 'utente', pseudonimizzato: false });
    expect(res.body.file.chiaveCifrata).toBeUndefined();
    const id = res.body.file.id;

    // On disk: one file, named by its id, without the plaintext.
    const onDisk = filesOnDisk();
    expect(onDisk).toEqual([path.join(user.id, dossier.id, id)]);
    const blob = readFileSync(path.join(dir, onDisk[0]));
    expect(blob.includes(Buffer.from(SECRET))).toBe(false);
    expect(blob.includes(Buffer.from('%PDF'))).toBe(false);
    expect(blob.length).toBeGreaterThan(PDF.length);

    const list = await request(app).get(`/api/dossiers/${dossier.id}/files`).set(authHeader(user));
    expect(list.status).toBe(200);
    expect(list.body.files).toHaveLength(1);
    expect(list.body.files[0]).toMatchObject({ id, versioni: [] });
    expect(list.body.cestino).toEqual([]);

    const down = await request(app).get(`/api/dossiers/${dossier.id}/files/${id}/content`).set(authHeader(user)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(down.status).toBe(200);
    expect(down.headers['content-type']).toContain('application/pdf');
    expect(down.headers['content-disposition']).toContain('Atto di citazione.pdf');
    expect(sha(down.body as Buffer)).toBe(sha(PDF));

    // The internal reader the MCP's text extraction will use.
    expect(sha(await readPraticaFileContent(user.id, id))).toBe(sha(PDF));
  });

  it('keeps an accented file name', async () => {
    const { user, dossier } = await setup('pf-accent');
    const res = await upload(user, dossier.id, DOCX, 'Comparsa – è già.docx');
    expect(res.status).toBe(201);
    expect(res.body.file).toMatchObject({ nome: 'Comparsa – è già.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  });

  it('accepts the listed formats by their first bytes', async () => {
    const { user, dossier } = await setup('pf-formats');
    expect((await upload(user, dossier.id, ODT, 'a.odt')).body.file.mime).toBe('application/vnd.oasis.opendocument.text');
    expect((await upload(user, dossier.id, PNG, 'a.png')).body.file.mime).toBe('image/png');
    expect((await upload(user, dossier.id, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'a.jpg')).body.file.mime).toBe('image/jpeg');
    expect((await upload(user, dossier.id, Buffer.from('{\\rtf1 testo}'), 'a.rtf')).body.file.mime).toBe('application/rtf');
    expect((await upload(user, dossier.id, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'a.doc')).body.file.mime).toBe('application/msword');
    expect((await upload(user, dossier.id, Buffer.from('Appunti, è così.'), 'a.txt')).body.file.mime).toBe('text/plain');
  });

  it('refuses a format on its content even with the right name (415)', async () => {
    const { user, dossier } = await setup('pf-415');
    expect((await upload(user, dossier.id, EXE, 'atto.pdf')).status).toBe(415);
    expect((await upload(user, dossier.id, Buffer.from('solo testo'), 'atto.pdf')).status).toBe(415);
    // A ZIP that is not a Word document.
    expect((await upload(user, dossier.id, Buffer.from('PK\x03\x04 other.xml', 'latin1'), 'atto.docx')).status).toBe(415);
    expect((await upload(user, dossier.id, PDF, 'atto.exe')).status).toBe(415);
    expect(filesOnDisk()).toEqual([]);
    expect(await prisma.praticaFile.count()).toBe(0);
  });

  it('refuses a file over 25 MB (413)', async () => {
    const { user, dossier } = await setup('pf-413-file');
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(25 * 1024 * 1024 + 1, 0x20)]);
    const res = await upload(user, dossier.id, big, 'grande.pdf');
    expect(res.status).toBe(413);
    expect(filesOnDisk()).toEqual([]);
  });

  it('refuses a file over the case ceiling (500 MB) and over the user ceiling (2 GB) (413)', async () => {
    const { user, dossier } = await setup('pf-413-quota');
    const fake = (dossierId: string, peso: number) =>
      prisma.praticaFile.create({ data: { userId: user.id, dossierId, nome: 'x.pdf', mime: 'application/pdf', peso, sha256: 'x', chiaveCifrata: Buffer.alloc(60) } });
    await fake(dossier.id, 500 * 1024 * 1024 - 10);
    const atCase = await upload(user, dossier.id, PDF, 'a.pdf');
    expect(atCase.status).toBe(413);
    expect(atCase.body.detail).toMatch(/pratica/);

    const other = await prisma.dossier.create({ data: { name: 'Altra', userId: user.id } });
    for (let i = 0; i < 3; i += 1) {
      const d = await prisma.dossier.create({ data: { name: `D${i}`, userId: user.id } });
      await fake(d.id, 500 * 1024 * 1024);
    }
    await fake(other.id, 48 * 1024 * 1024);
    // 2 GB minus 10 bytes are taken across the user's cases: one more PDF is over.
    const atUser = await upload(user, other.id, PDF, 'b.pdf');
    expect(atUser.status).toBe(413);
    expect(atUser.body.detail).toMatch(/account/);
  });

  it('answers 404 to another user on every route, and leaves the file alone', async () => {
    const { user, dossier } = await setup('pf-victim');
    const attacker = await createTestUser('pf-attacker');
    const id = (await upload(user, dossier.id, PDF, 'a.pdf')).body.file.id;
    const base = `/api/dossiers/${dossier.id}`;
    const h = authHeader(attacker);
    expect((await request(app).get(`${base}/files`).set(h)).status).toBe(404);
    expect((await request(app).post(`${base}/files`).set(h).attach('file', PDF, 'x.pdf')).status).toBe(404);
    expect((await request(app).get(`${base}/files/${id}/content`).set(h)).status).toBe(404);
    expect((await request(app).post(`${base}/files/${id}/versions`).set(h).attach('file', PDF, 'x.pdf')).status).toBe(404);
    expect((await request(app).post(`${base}/files/${id}/trash`).set(h)).status).toBe(404);
    expect((await request(app).post(`${base}/files/${id}/restore`).set(h)).status).toBe(404);
    expect((await request(app).delete(`${base}/files/${id}`).set(h)).status).toBe(404);
    expect((await request(app).get(`${base}/istruzioni`).set(h)).status).toBe(404);
    expect((await request(app).put(`${base}/istruzioni`).set(h).send({ testo: 'x' })).status).toBe(404);
    // Their own dossier does not reach the victim's file either.
    const own = await prisma.dossier.create({ data: { name: 'Mia', userId: attacker.id } });
    expect((await request(app).get(`/api/dossiers/${own.id}/files/${id}/content`).set(h)).status).toBe(404);
    expect((await prisma.praticaFile.findUnique({ where: { id } }))?.deletedAt).toBeNull();
    expect(filesOnDisk()).toHaveLength(1);
  });

  it('needs a session', async () => {
    expect((await request(app).get('/api/dossiers/x/files')).status).toBe(401);
  });

  it('answers 503 on every file route when the key is missing or not 32 bytes', async () => {
    const { user, dossier } = await setup('pf-503');
    delete process.env.PRATICA_FILES_KEY;
    const res = await request(app).get(`/api/dossiers/${dossier.id}/files`).set(authHeader(user));
    expect(res.status).toBe(503);
    expect(res.body.detail).toMatch(/non è configurato/);
    expect((await upload(user, dossier.id, PDF, 'a.pdf')).status).toBe(503);
    process.env.PRATICA_FILES_KEY = randomBytes(16).toString('base64');
    expect((await upload(user, dossier.id, PDF, 'a.pdf')).status).toBe(503);
  });

  it('files a new version under the original, numbered, even when made from a version', async () => {
    const { user, dossier } = await setup('pf-versions');
    const original = (await upload(user, dossier.id, PDF, 'atto.pdf')).body.file;
    const v2 = await request(app).post(`/api/dossiers/${dossier.id}/files/${original.id}/versions`).set(authHeader(user)).attach('file', DOCX, 'atto v2.docx');
    expect(v2.status).toBe(201);
    expect(v2.body.file).toMatchObject({ versioneDi: original.id, versione: 2, nome: 'atto v2.docx' });
    const v3 = await request(app).post(`/api/dossiers/${dossier.id}/files/${v2.body.file.id}/versions`).set(authHeader(user)).attach('file', PDF, 'atto v3.pdf');
    expect(v3.body.file).toMatchObject({ versioneDi: original.id, versione: 3 });

    const list = await request(app).get(`/api/dossiers/${dossier.id}/files`).set(authHeader(user));
    expect(list.body.files).toHaveLength(1);
    expect(list.body.files[0].id).toBe(original.id);
    expect(list.body.files[0].versioni.map((v: { versione: number }) => v.versione)).toEqual([2, 3]);
    // The original is never overwritten.
    expect(sha(await readPraticaFileContent(user.id, original.id))).toBe(sha(PDF));
  });

  it('trashes, restores and deletes for good, removing the file from disk', async () => {
    const { user, dossier } = await setup('pf-trash');
    const h = authHeader(user);
    const base = `/api/dossiers/${dossier.id}/files`;
    const original = (await upload(user, dossier.id, PDF, 'atto.pdf')).body.file;
    const v2 = (await request(app).post(`${base}/${original.id}/versions`).set(h).attach('file', PDF, 'v2.pdf')).body.file;
    expect(filesOnDisk()).toHaveLength(2);

    // Only from the trash.
    expect((await request(app).delete(`${base}/${original.id}`).set(h)).status).toBe(409);

    expect((await request(app).post(`${base}/${original.id}/trash`).set(h)).status).toBe(200);
    let list = await request(app).get(base).set(h);
    expect(list.body.files).toEqual([]);
    expect(list.body.cestino.map((f: { id: string }) => f.id).sort()).toEqual([original.id, v2.id].sort());
    expect((await request(app).get(`${base}/${original.id}/content`).set(h)).status).toBe(404);
    // A version cannot come back without its original.
    expect((await request(app).post(`${base}/${v2.id}/restore`).set(h)).status).toBe(409);

    expect((await request(app).post(`${base}/${original.id}/restore`).set(h)).status).toBe(200);
    list = await request(app).get(base).set(h);
    expect(list.body.files[0].versioni).toHaveLength(1);

    // A version alone: trashed, then deleted for good.
    await request(app).post(`${base}/${v2.id}/trash`).set(h);
    expect((await request(app).delete(`${base}/${v2.id}`).set(h)).status).toBe(204);
    expect(filesOnDisk()).toEqual([path.join(user.id, dossier.id, original.id)]);

    // The original with its group.
    await request(app).post(`${base}/${original.id}/trash`).set(h);
    expect((await request(app).delete(`${base}/${original.id}`).set(h)).status).toBe(204);
    expect(filesOnDisk()).toEqual([]);
    expect(await prisma.praticaFile.count()).toBe(0);
  });

  it('reads and writes the case instructions', async () => {
    const { user, dossier } = await setup('pf-istruzioni');
    const base = `/api/dossiers/${dossier.id}/istruzioni`;
    const empty = await request(app).get(base).set(authHeader(user));
    expect(empty.status).toBe(200);
    expect(empty.body.istruzioni).toMatchObject({ testo: '', updatedAt: null });
    const put = await request(app).put(base).set(authHeader(user)).send({ testo: '# Linea\nCita solo Cassazione.' });
    expect(put.status).toBe(200);
    expect(put.body.istruzioni).toMatchObject({ testo: '# Linea\nCita solo Cassazione.', updatedBy: null });
    expect((await request(app).get(base).set(authHeader(user))).body.istruzioni.testo).toBe('# Linea\nCita solo Cassazione.');
    expect((await request(app).put(base).set(authHeader(user)).send({ testo: 'x'.repeat(20_001) })).status).toBe(400);
    expect((await request(app).put(base).set(authHeader(user)).send({ testo: 'x', other: 1 })).status).toBe(400);
  });

  it('writes one access-log line for every listing, download, deposit and deletion', async () => {
    const { user, dossier } = await setup('pf-log');
    const h = authHeader(user);
    const base = `/api/dossiers/${dossier.id}/files`;
    const id = (await upload(user, dossier.id, PDF, 'a.pdf')).body.file.id;
    const v2 = (await request(app).post(`${base}/${id}/versions`).set(h).attach('file', PDF, 'b.pdf')).body.file.id;
    await request(app).get(base).set(h);
    await request(app).get(`${base}/${id}/content`).set(h);
    await request(app).post(`${base}/${id}/trash`).set(h);
    await request(app).post(`${base}/${id}/restore`).set(h);
    await request(app).post(`${base}/${id}/trash`).set(h);
    await request(app).delete(`${base}/${id}`).set(h);
    const rows = await prisma.praticaFileAccesso.findMany({ orderBy: { createdAt: 'asc' } });
    // Deleting the original deletes its version: one line for each file removed.
    expect(rows.map((r) => r.azione)).toEqual(['deposito', 'deposito', 'elenco', 'scaricamento', 'cestino', 'ripristino', 'cestino', 'cancellazione', 'cancellazione']);
    expect(rows.every((r) => r.userId === user.id && r.dossierId === dossier.id && r.clientId === null)).toBe(true);
    expect(rows.filter((r) => r.azione !== 'elenco').every((r) => r.fileId !== null)).toBe(true);
    // The lines outlive the files.
    expect(rows.slice(-2).map((r) => r.fileId).sort()).toEqual([id, v2].sort());
    expect(await prisma.praticaFile.count()).toBe(0);
  });

  it('keeps the files while the dossier is in the trash, brings them back on restore, removes them when the entry is emptied', async () => {
    const { user, dossier } = await setup('pf-dossier-trash');
    const h = authHeader(user);
    const id = (await upload(user, dossier.id, PDF, 'a.pdf')).body.file.id;
    await request(app).put(`/api/dossiers/${dossier.id}/istruzioni`).set(h).send({ testo: 'Istruzioni' });

    const trashed = await request(app).delete(`/api/dossiers/${dossier.id}`).set(h);
    expect(trashed.status).toBe(200);
    expect(filesOnDisk()).toHaveLength(1);
    expect((await request(app).get(`/api/dossiers/${dossier.id}/files`).set(h)).status).toBe(404);

    expect((await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(h).send({})).status).toBe(200);
    expect((await request(app).get(`/api/dossiers/${dossier.id}/files/${id}/content`).set(h)).status).toBe(200);
    expect((await request(app).get(`/api/dossiers/${dossier.id}/istruzioni`).set(h)).body.istruzioni.testo).toBe('Istruzioni');

    const again = await request(app).delete(`/api/dossiers/${dossier.id}`).set(h);
    expect((await request(app).delete(`/api/trash/${again.body.trashId}`).set(h)).status).toBe(204);
    expect(filesOnDisk()).toEqual([]);
    expect(await prisma.praticaFile.count()).toBe(0);
    expect(await prisma.praticaIstruzioni.count()).toBe(0);
  });

  it('removes the files of a dossier whose trash entry expires', async () => {
    const { user, dossier } = await setup('pf-dossier-sweep');
    await upload(user, dossier.id, PDF, 'a.pdf');
    const trashed = await request(app).delete(`/api/dossiers/${dossier.id}`).set(authHeader(user));
    await prisma.trashEntry.update({ where: { id: trashed.body.trashId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await sweepExpiredTrash();
    expect(filesOnDisk()).toEqual([]);
    expect(await prisma.praticaFile.count()).toBe(0);
  });

  it('removes every file of an account that is deleted, and no one else\'s', async () => {
    const { user, dossier } = await setup('pf-account');
    const { user: other, dossier: otherDossier } = await setup('pf-account-other');
    await upload(user, dossier.id, PDF, 'a.pdf');
    await upload(other, otherDossier.id, PDF, 'b.pdf');
    await deleteUserAccount(user.id);
    expect(filesOnDisk().every((f) => f.startsWith(other.id))).toBe(true);
    expect(filesOnDisk()).toHaveLength(1);
    expect(await prisma.praticaFile.count({ where: { userId: user.id } })).toBe(0);
  });
});
