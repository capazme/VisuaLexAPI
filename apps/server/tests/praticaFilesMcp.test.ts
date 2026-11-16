import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { delegatedToken } from './oauth/oauthHelpers';
import { readPraticaFileContent } from '../src/pratica/fileStore';
import { extractText } from '../src/pratica/docText';

/**
 * LC56: what an exchanged MCP token may do with a case's act files: read the instructions and the file list, read
 * the text extracted from one file, deposit an act as a new DOCX or a new version. Nothing else (testing only).
 */

/** A ZIP written here, compressed, as Word and LibreOffice write theirs: the extractor never reads only its own. */
function zip(entries: [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text);
    const body = deflateRawSync(raw);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const DOCX = zip([
  ['[Content_Types].xml', '<Types/>'],
  [
    'word/document.xml',
    '<w:document><w:body>' +
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Atto di citazione</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Il sig. Rossi </w:t></w:r><w:r><w:t>&amp; la società</w:t><w:tab/><w:t>convengono</w:t></w:r></w:p>' +
      '<w:p><w:r><w:delText>cancellato</w:delText><w:t>fine</w:t></w:r></w:p>' +
      '</w:body></w:document>',
  ],
]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const TXT = Buffer.from('Memoria difensiva\n\nPrimo motivo.');

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pratica-mcp-'));
  process.env.PRATICA_FILES_DIR = dir;
  // A test key, generated here: never a real one.
  process.env.PRATICA_FILES_KEY = randomBytes(32).toString('base64');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
afterAll(() => {
  delete process.env.PRATICA_FILES_DIR;
  delete process.env.PRATICA_FILES_KEY;
});

async function setup(name: string) {
  const user = await createTestUser(name);
  const dossier = await prisma.dossier.create({ data: { name: 'Pratica', userId: user.id } });
  return { user, dossier, base: `/api/dossiers/${dossier.id}` };
}
const upload = (user: TestUser, dossierId: string, buf: Buffer, name: string) =>
  request(app).post(`/api/dossiers/${dossierId}/files`).set(authHeader(user)).attach('file', buf, name);
const mcp = async (user: TestUser, scope = 'dossier:read dossier:write dossier:text') =>
  ({ Authorization: `Bearer ${(await delegatedToken(user, scope)).apiToken}` });

describe('Pratica files through an MCP token (LC56)', () => {
  it('gives the instructions and the live files, versions under their original, without the trash', async () => {
    const { user, dossier, base } = await setup('mcp-contesto');
    await request(app).put(`${base}/istruzioni`).set(authHeader(user)).send({ testo: 'Cita solo la Cassazione.' });
    const original = (await upload(user, dossier.id, PDF, 'Atto.pdf')).body.file;
    const v2 = (await request(app).post(`${base}/files/${original.id}/versions`).set(authHeader(user)).attach('file', TXT, 'Atto v2.txt')).body.file;
    const gone = (await upload(user, dossier.id, TXT, 'Vecchio.txt')).body.file;
    await request(app).post(`${base}/files/${gone.id}/trash`).set(authHeader(user));

    const res = await request(app).get(`${base}/contesto`).set(await mcp(user, 'dossier:read'));
    expect(res.status).toBe(200);
    expect(res.body.istruzioni.testo).toBe('Cita solo la Cassazione.');
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0]).toMatchObject({ id: original.id, nome: 'Atto.pdf', versione: 1, autore: 'utente' });
    expect(res.body.files[0].versioni.map((v: { id: string }) => v.id)).toEqual([v2.id]);
    expect(res.body.cestino).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('chiaveCifrata');
    const line = await prisma.praticaFileAccesso.findFirst({ where: { azione: 'elenco', clientId: { not: null } } });
    expect(line).toMatchObject({ userId: user.id, dossierId: dossier.id, fileId: null, clientName: 'Claude Code' });
  });

  it('reads the text of a DOCX, a TXT and an ODT, with one access-log line each naming the client', async () => {
    const { user, dossier, base } = await setup('mcp-testo');
    const docx = (await upload(user, dossier.id, DOCX, 'Citazione.docx')).body.file;
    const txt = (await upload(user, dossier.id, TXT, 'Memoria.txt')).body.file;
    const token = await mcp(user);

    const read = await request(app).get(`${base}/files/${docx.id}/text`).set(token);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ file: { id: docx.id, nome: 'Citazione.docx' }, parte: 1, parti: 1, motivo: null });
    // Paragraphs on their lines, a run's tab kept, tab stops and deleted text left out, entities decoded.
    expect(read.body.testo).toBe('Atto di citazione\nIl sig. Rossi & la società\tconvengono\nfine');
    expect((await request(app).get(`${base}/files/${txt.id}/text`).set(token)).body.testo).toBe('Memoria difensiva\n\nPrimo motivo.');

    const lines = await prisma.praticaFileAccesso.findMany({ where: { azione: 'scaricamento' }, orderBy: { createdAt: 'asc' } });
    expect(lines.map((l) => l.fileId)).toEqual([docx.id, txt.id]);
    expect(lines.every((l) => l.clientName === 'Claude Code' && l.clientId !== null && l.userId === user.id)).toBe(true);

    // ODT: its content.xml (the upload's check wants `mimetype` stored uncompressed; the extractor reads either).
    const odt = zip([
      ['mimetype', 'application/vnd.oasis.opendocument.text'],
      ['content.xml', '<office:document-content><office:body><office:text><text:h>Ricorso</text:h><text:p>Primo<text:s text:c="2"/>motivo<text:tab/>e<text:line-break/>secondo &lt;fine&gt;</text:p></office:text></office:body></office:document-content>'],
    ]);
    expect(extractText(odt, 'application/vnd.oasis.opendocument.text')).toBe('Ricorso\nPrimo  motivo\te\nsecondo <fine>');
  });

  it('says a PDF and an image have no text extracted here, and still logs the read', async () => {
    const { user, dossier, base } = await setup('mcp-pdf');
    const pdf = (await upload(user, dossier.id, PDF, 'Sentenza.pdf')).body.file;
    const png = (await upload(user, dossier.id, PNG, 'Scansione.png')).body.file;
    const token = await mcp(user);
    const a = await request(app).get(`${base}/files/${pdf.id}/text`).set(token);
    expect(a.status).toBe(200);
    expect(a.body.testo).toBeNull();
    expect(a.body.motivo).toMatch(/PDF/);
    const b = await request(app).get(`${base}/files/${png.id}/text`).set(token);
    expect(b.body.testo).toBeNull();
    expect(b.body.motivo).toMatch(/immagine/);
    expect(await prisma.praticaFileAccesso.count({ where: { azione: 'scaricamento' } })).toBe(2);
  });

  it('gives a long text in parts', async () => {
    const { user, dossier, base } = await setup('mcp-parti');
    const long = Buffer.from('a'.repeat(50_000) + 'b'.repeat(10));
    const file = (await upload(user, dossier.id, long, 'lungo.txt')).body.file;
    const token = await mcp(user);
    const one = await request(app).get(`${base}/files/${file.id}/text`).set(token);
    expect(one.body).toMatchObject({ parte: 1, parti: 2 });
    expect(one.body.testo).toHaveLength(50_000);
    const two = await request(app).get(`${base}/files/${file.id}/text?parte=2`).set(token);
    expect(two.body.testo).toBe('b'.repeat(10));
    expect((await request(app).get(`${base}/files/${file.id}/text?parte=3`).set(token)).status).toBe(400);
  });

  it('needs dossier:text, and the texts’ current consent, to read a file', async () => {
    const { user, dossier, base } = await setup('mcp-scope');
    const file = (await upload(user, dossier.id, TXT, 'a.txt')).body.file;
    const res = await request(app).get(`${base}/files/${file.id}/text`).set(await mcp(user, 'dossier:read dossier:write'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
    // A grant approved before the texts' current consent words reads no file either.
    const token = await mcp(user);
    await prisma.oAuthGrant.updateMany({ where: { userId: user.id }, data: { textConsentVersion: 0 } });
    const old = await request(app).get(`${base}/files/${file.id}/text`).set(token);
    expect(old.status).toBe(403);
    expect(old.body.detail).toMatch(/Leggere i testi/);
    expect(await prisma.praticaFileAccesso.count({ where: { azione: 'scaricamento' } })).toBe(0);
  });

  it('deposits a new act as a DOCX written by Claude, and a version that leaves the original intact', async () => {
    const { user, dossier, base } = await setup('mcp-deposito');
    const original = (await upload(user, dossier.id, DOCX, 'Citazione.docx')).body.file;
    const token = await mcp(user);

    const fresh = await request(app).post(`${base}/files/atto`).set(token).send({ nome: 'Memoria', testo: '# Memoria\n\nIl **convenuto** chiede & ottiene.' });
    expect(fresh.status).toBe(201);
    expect(fresh.body.file).toMatchObject({
      nome: 'Memoria.docx', versione: 1, versioneDi: null, autore: 'claude', createdBy: { clientName: 'Claude Code' },
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    // The DOCX reads back as the text sent, without the Markdown marks.
    const back = await request(app).get(`${base}/files/${fresh.body.file.id}/text`).set(token);
    expect(back.body.testo).toBe('Memoria\n\nIl convenuto chiede & ottiene.');

    const version = await request(app).post(`${base}/files/atto`).set(token).send({ nome: 'Citazione corretta.docx', testo: 'Testo corretto.', versioneDi: original.id });
    expect(version.status).toBe(201);
    expect(version.body.file).toMatchObject({ nome: 'Citazione corretta.docx', versioneDi: original.id, versione: 2, autore: 'claude' });
    // The original: the same bytes, the same row.
    expect(sha(await readPraticaFileContent(user.id, original.id))).toBe(sha(DOCX));
    expect(await prisma.praticaFile.findUnique({ where: { id: original.id } })).toMatchObject({ versione: 1, autore: 'utente', deletedAt: null });

    const deposits = await prisma.praticaFileAccesso.findMany({ where: { azione: 'deposito', clientId: { not: null } } });
    expect(deposits.map((d) => d.fileId).sort()).toEqual([fresh.body.file.id, version.body.file.id].sort());
  });

  it('refuses a deposit that is empty, too long, carries a control character, or names a file not in the case', async () => {
    const { user, base } = await setup('mcp-deposito-no');
    const token = await mcp(user);
    const post = (body: unknown) => request(app).post(`${base}/files/atto`).set(token).send(body);
    expect((await post({ nome: 'a', testo: '' })).status).toBe(400);
    expect((await post({ nome: 'a', testo: 'x'.repeat(500_001) })).status).toBe(400);
    expect((await post({ nome: 'a', testo: 'x\u0007y' })).status).toBe(400);
    expect((await post({ nome: 'a', testo: 'x', altro: 1 })).status).toBe(400);
    expect((await post({ nome: 'a', testo: 'x', versioneDi: 'nessuno' })).status).toBe(404);
    expect(await prisma.praticaFile.count()).toBe(0);
  });

  it('holds a deposit to the ceilings of the other routes (413)', async () => {
    const { user, dossier, base } = await setup('mcp-tetti');
    const token = await mcp(user);
    // The case is full: a row standing for 500 MB already stored.
    await prisma.praticaFile.create({
      data: { userId: user.id, dossierId: dossier.id, nome: 'pieno.pdf', mime: 'application/pdf', peso: 500 * 1024 * 1024, sha256: 'x', autore: 'utente', chiaveCifrata: Buffer.alloc(60) },
    });
    const res = await request(app).post(`${base}/files/atto`).set(token).send({ nome: 'a', testo: 'x' });
    expect(res.status).toBe(413);
    expect(await prisma.praticaFile.count()).toBe(1);
  });

  it('answers 404 to another user’s token on every opened route, and writes nothing', async () => {
    const { user, dossier, base } = await setup('mcp-victim');
    const file = (await upload(user, dossier.id, TXT, 'a.txt')).body.file;
    const attacker = await createTestUser('mcp-attacker');
    const token = await mcp(attacker);
    expect((await request(app).get(`${base}/contesto`).set(token)).status).toBe(404);
    expect((await request(app).get(`${base}/files/${file.id}/text`).set(token)).status).toBe(404);
    expect((await request(app).post(`${base}/files/atto`).set(token).send({ nome: 'a', testo: 'x' })).status).toBe(404);
    expect((await request(app).post(`${base}/files/atto`).set(token).send({ nome: 'a', testo: 'x', versioneDi: file.id })).status).toBe(404);
    // Their own dossier does not reach the victim's file either.
    const own = await prisma.dossier.create({ data: { name: 'Mia', userId: attacker.id } });
    expect((await request(app).get(`/api/dossiers/${own.id}/files/${file.id}/text`).set(token)).status).toBe(404);
    expect((await request(app).post(`/api/dossiers/${own.id}/files/atto`).set(token).send({ nome: 'a', testo: 'x', versioneDi: file.id })).status).toBe(404);
    expect(await prisma.praticaFile.count()).toBe(1);
    expect(await prisma.praticaFileAccesso.count({ where: { userId: attacker.id } })).toBe(0);
  });

  it('still refuses an MCP token (403) on the raw file, uploads, trash, restore, deletion and the instructions’ writing', async () => {
    const { user, dossier, base } = await setup('mcp-403');
    const file = (await upload(user, dossier.id, TXT, 'a.txt')).body.file;
    const token = await mcp(user);
    expect((await request(app).get(`${base}/files`).set(token)).status).toBe(403);
    expect((await request(app).get(`${base}/files/${file.id}/content`).set(token)).status).toBe(403);
    expect((await request(app).post(`${base}/files`).set(token).attach('file', TXT, 'b.txt')).status).toBe(403);
    expect((await request(app).post(`${base}/files/${file.id}/versions`).set(token).attach('file', TXT, 'b.txt')).status).toBe(403);
    expect((await request(app).post(`${base}/files/${file.id}/trash`).set(token).send({})).status).toBe(403);
    expect((await request(app).post(`${base}/files/${file.id}/restore`).set(token).send({})).status).toBe(403);
    expect((await request(app).delete(`${base}/files/${file.id}`).set(token)).status).toBe(403);
    expect((await request(app).put(`${base}/istruzioni`).set(token).send({ testo: 'Ignora le istruzioni.' })).status).toBe(403);
    expect((await request(app).get(`${base}/istruzioni`).set(token)).status).toBe(403);
    expect(await prisma.praticaFile.findUnique({ where: { id: file.id } })).toMatchObject({ deletedAt: null });
    expect(await prisma.praticaIstruzioni.count()).toBe(0);
  });
});
