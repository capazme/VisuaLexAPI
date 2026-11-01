#!/usr/bin/env node
/**
 * Opens the DOCX writer's copies in LibreOffice (spec 2026-10-31-document-hyperlinks-design.md §10.2, L4).
 * Run by hand and in the browser pass, not in CI (CI has no LibreOffice):
 *
 *   node tools/e2e/docx-roundtrip/run.mjs [folder]
 *
 * It runs the writer's Vitest suite with `DOCX_ROUNDTRIP_OUT=<folder>` (a new temporary folder when none is given),
 * which writes each fixture's input, its copy and the addresses linked; then converts every input and copy with
 * `soffice --headless` to HTML and PDF and fails on a conversion error, on a copy whose HTML does not carry exactly
 * the links the writer reported (one `<a href>` per link, by address), on a PDF without each address, and on a copy
 * whose text differs from its input's. Word is not checked here: an owner opens the copies on a Mac once per writer
 * PR and says so in the PR.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const folder = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'docx-roundtrip-')));
mkdirSync(folder, { recursive: true });
const soffice = process.env.SOFFICE ?? 'soffice';

execFileSync('npm', ['--prefix', join(repo, 'apps/web'), 'exec', '--', 'vitest', 'run',
  'src/components/features/documents/__tests__/docxWriter.test.ts'], {
  cwd: join(repo, 'apps/web'),
  env: { ...process.env, DOCX_ROUNDTRIP_OUT: folder },
  stdio: 'inherit',
});

// A profile of its own, so a LibreOffice already open does not take the conversion over.
const profile = mkdtempSync(join(tmpdir(), 'docx-roundtrip-profile-'));
function convert(file, format) {
  const out = join(folder, format);
  execFileSync(soffice, [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', format, '--outdir', out, file], { stdio: 'pipe' });
  const converted = join(out, `${basename(file, '.docx')}.${format}`);
  if (!existsSync(converted)) throw new Error(`${basename(file)}: LibreOffice wrote no ${format}`);
  return converted;
}

const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// Inline elements (a link, a font change) are taken out with nothing in their place; any other tag ends a word.
const INLINE = /<\/?(?:a|span|font|b|i|u|em|strong|sup|sub)\b[^>]*>/gi;
const textOf = html => decode(html.replace(/<head[\s\S]*?<\/head>/i, '').replace(INLINE, '').replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ').trim();
const count = values => values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map());

let failures = 0;
const copies = readdirSync(folder).filter(name => name.endsWith('.docx') && !name.endsWith('.input.docx'));
if (copies.length === 0) throw new Error(`no copies in ${folder}`);
for (const name of copies) {
  const stem = basename(name, '.docx');
  const expected = JSON.parse(readFileSync(join(folder, `${stem}.json`), 'utf8')).links;
  const html = readFileSync(convert(join(folder, name), 'html'), 'utf8');
  const inputHtml = readFileSync(convert(join(folder, `${stem}.input.docx`), 'html'), 'utf8');
  const pdf = readFileSync(convert(join(folder, name), 'pdf')).toString('latin1');
  const problems = [];

  // Links already in the input (the author's own) are in both: count only what the copy adds.
  const hrefs = html => [...html.matchAll(/<a\s[^>]*href="([^"]*)"/gi)].map(match => decode(match[1]));
  const before = count(hrefs(inputHtml));
  const after = count(hrefs(html));
  const added = new Map([...after].map(([href, n]) => [href, n - (before.get(href) ?? 0)]).filter(([, n]) => n > 0));
  const wanted = count(expected);
  for (const [href, n] of wanted) if (added.get(href) !== n) problems.push(`${href}: ${added.get(href) ?? 0} links in the HTML, ${n} reported`);
  for (const [href, n] of added) if (!wanted.has(href)) problems.push(`${href}: ${n} links in the HTML, none reported`);
  for (const href of new Set(expected)) if (!pdf.includes(href)) problems.push(`${href}: not in the PDF`);
  if (textOf(html) !== textOf(inputHtml)) problems.push('the text differs from the input’s');

  if (problems.length > 0) {
    failures += 1;
    console.error(`✗ ${name}\n  ${problems.join('\n  ')}`);
  } else {
    console.log(`✓ ${name}: ${expected.length} links, the text unchanged, HTML and PDF written`);
  }
}
console.log(`\nCopies and conversions in ${folder}`);
process.exit(failures > 0 ? 1 : 0);
