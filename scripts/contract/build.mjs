#!/usr/bin/env node
// Generates the contract files in conventions/contract/ from the core's sources.
//
// The web app and the MCP server keep hand-made copies of a few values the core owns (the password
// rule, the page ceiling, the codes table, the courts' families, the article suffixes) and tests
// that check the copies did not drift. Those tests used to read the core's source files; once the
// web lives in its own repository it has no core to read, so it reads the files written here.
//
//   node scripts/contract/build.mjs            write conventions/contract/pins.json and frozen_projections.json
//   node scripts/contract/build.mjs --check    write nothing; exit 1 naming the file that is stale
//
// Node only, no dependencies. The parsing below is the one the web and server tests used to run on
// the sources: moved here, not reinvented.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'conventions', 'contract');

const FROZEN_SOURCE = join('services', 'visualex', 'tests', 'fixtures', 'decisions', 'frozen_projections.json');
const FROZEN_COPY = join('conventions', 'contract', 'frozen_projections.json');
const PINS = join('conventions', 'contract', 'pins.json');

function read(...segments) {
  return readFileSync(join(ROOT, ...segments), 'utf8');
}

function fail(message) {
  throw new Error(`contract: ${message}`);
}

function need(condition, message) {
  if (!condition) fail(message);
}

// The block of a Python dict that opens with `marker` and ends at the first closing brace that
// starts a line.
function pythonBlock(python, marker, what) {
  const start = python.indexOf(marker);
  need(start !== -1, `${what}: «${marker}» not found`);
  const end = python.indexOf('\n}', start);
  need(end !== -1, `${what}: the block opened by «${marker}» is never closed`);
  return python.slice(start, end);
}

// The `"key": "value",` rows of map.py's tables.
function stringRows(block) {
  return Object.fromEntries([...block.matchAll(/^\s*"(.+)":\s*"(.+)",?\s*$/gm)].map((m) => [m[1], m[2]]));
}

function passwordRule() {
  // Every path that sets a password reads it there: sign-up, change, the administrator's create and reset.
  const source = read('apps', 'server', 'src', 'utils', 'password.ts');
  const match = source.match(/^export const PASSWORD_RULE = \/(.+)\/([a-z]*);$/m);
  need(match, 'PASSWORD_RULE not found in apps/server/src/utils/password.ts');
  return { source: match[1], flags: match[2] };
}

function maxArticlesPerRequest() {
  const config = read('services', 'visualex', 'visualex_api', 'tools', 'config.py');
  const match = config.match(/^MAX_ARTICLES_PER_REQUEST = .*\bor (\d+)\)\)$/m);
  need(match, 'MAX_ARTICLES_PER_REQUEST not found in services/visualex/visualex_api/tools/config.py');
  return Number(match[1]);
}

function mapTable(name, minimum) {
  const python = read('services', 'visualex', 'visualex_api', 'tools', 'map.py');
  const rows = stringRows(pythonBlock(python, `${name} = {`, name));
  need(Object.keys(rows).length > minimum, `${name} has ${Object.keys(rows).length} rows, expected more than ${minimum}`);
  return rows;
}

// The reader's families (model.py, FAMIGLIE): kind -> family. A kind the reader reads with a family
// must carry the same one in the web, or a citation loses its «ord.» or «decr.».
function decisionFamilies() {
  const python = read('services', 'visualex', 'visualex_api', 'services', 'decisions', 'model.py');
  const start = python.indexOf('FAMIGLIE');
  need(start !== -1, 'FAMIGLIE not found in services/visualex/visualex_api/services/decisions/model.py');
  const end = python.indexOf('\n}', start);
  need(end !== -1, 'FAMIGLIE: the block is never closed');
  const block = python.slice(start, end);
  const families = Object.fromEntries([...block.matchAll(/"(\w+)":\s*\(([^)]*)\)/g)]
    .flatMap((m) => [...m[2].matchAll(/"(\w+)"/g)].map((k) => [k[1], m[1]])));
  need(Object.keys(families).length > 5, `FAMIGLIE yields ${Object.keys(families).length} kinds, expected more than 5`);
  return families;
}

// The block ends at the bracket that opens a line: a comment inside it holds one of its own
// ("vicies semel", 21).
function articleOrdinalSuffixes() {
  const text = read('services', 'visualex', 'visualex_api', 'tools', 'article_suffixes.py');
  const start = text.search(/ARTICLE_ORDINAL_SUFFIXES = \(/);
  need(start !== -1, 'ARTICLE_ORDINAL_SUFFIXES not found in services/visualex/visualex_api/tools/article_suffixes.py');
  const end = text.indexOf('\n)', start);
  need(end !== -1, 'ARTICLE_ORDINAL_SUFFIXES: the tuple is never closed');
  const block = text.slice(start, end);
  const suffixes = [...block.matchAll(/["']([a-z]+)["']/g)].map((m) => m[1]);
  need(suffixes.length > 20, `ARTICLE_ORDINAL_SUFFIXES has ${suffixes.length} entries, expected more than 20`);
  return suffixes;
}

export function buildPins() {
  const pins = {
    version: 1,
    note: 'Generated by scripts/contract/build.mjs from the core\'s sources; do not edit by hand. Regenerate with `node scripts/contract/build.mjs`.',
    password_rule: passwordRule(),
    max_articles_per_request: maxArticlesPerRequest(),
    normattiva_urn_codici: mapTable('NORMATTIVA_URN_CODICI', 30),
    annexed_acts: mapTable('ANNEXED_ACTS', 0),
    annex_sigle: mapTable('ANNEX_SIGLE', 0),
    annex_headings: mapTable('ANNEX_HEADINGS', 0),
    decision_families: decisionFamilies(),
    article_ordinal_suffixes: articleOrdinalSuffixes(),
  };
  return JSON.stringify(pins, null, 2) + '\n';
}

// What each generated file must hold: [path relative to the root, content].
export function expectedFiles() {
  need(existsSync(join(ROOT, FROZEN_SOURCE)), `${FROZEN_SOURCE} not found`);
  return [
    [PINS, Buffer.from(buildPins(), 'utf8')],
    [FROZEN_COPY, readFileSync(join(ROOT, FROZEN_SOURCE))],
  ];
}

function main() {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [file, content] of expectedFiles()) {
    const target = join(ROOT, file);
    const current = existsSync(target) ? readFileSync(target) : null;
    if (current && current.equals(content)) continue;
    if (check) stale.push(file);
    else {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(target, content);
      console.log(`wrote ${file}`);
    }
  }
  if (stale.length) {
    for (const file of stale) console.error(`${file} is stale: run node scripts/contract/build.mjs and commit the result`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
