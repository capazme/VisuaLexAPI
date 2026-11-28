#!/usr/bin/env node
// The desktop app's local server as the app's shell will start it (G-612, spec §6): `dist-local/`, with
// - main.cjs, one esbuild bundle of src/local/main.ts with the server and both generated Prisma clients;
// - sql/, the local SQL it migrates the file with (prisma/local: init.sql, migrations/);
// - node_modules/better-sqlite3, the encrypted SQLite driver (better-sqlite3-multiple-ciphers): its JavaScript and
//   the one native addon of this platform, nothing else.
//   npm run build:local        (after `npx prisma generate` and `npm run local:generate`)
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const OUT = path.join(root, 'dist-local');
const started = Date.now();

for (const generated of ['src/generated/prisma/client.ts', 'src/generated/prisma-local/client.ts']) {
  if (!existsSync(path.join(root, generated))) {
    console.error(`[build-local] ${generated} is missing: run \`npx prisma generate\` and \`npm run local:generate\` first`);
    process.exit(1);
  }
}

rmSync(OUT, { recursive: true, force: true });
const result = await build({
  entryPoints: [path.join(root, 'src/local/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: path.join(OUT, 'main.cjs'),
  // The driver is native, beside the bundle; pg's optional native binding is never used.
  external: ['better-sqlite3', 'pg-native', '*.node'],
  logLevel: 'warning',
  metafile: true,
});
writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(result.metafile));

cpSync(path.join(root, 'prisma/local/init.sql'), path.join(OUT, 'sql/init.sql'));
if (existsSync(path.join(root, 'prisma/local/migrations'))) {
  cpSync(path.join(root, 'prisma/local/migrations'), path.join(OUT, 'sql/migrations'), { recursive: true });
}

const driver = path.dirname(require.resolve('better-sqlite3/package.json'));
const addon = `${process.platform}-${process.arch}.node`;
if (!existsSync(path.join(driver, 'prebuilds', addon))) {
  console.error(`[build-local] the driver has no native addon for ${addon}`);
  process.exit(1);
}
const target = path.join(OUT, 'node_modules/better-sqlite3');
mkdirSync(path.join(target, 'prebuilds'), { recursive: true });
cpSync(path.join(driver, 'lib'), path.join(target, 'lib'), { recursive: true, dereference: true });
cpSync(path.join(driver, 'package.json'), path.join(target, 'package.json'), { dereference: true });
cpSync(path.join(driver, 'LICENSE'), path.join(target, 'LICENSE'), { dereference: true });
cpSync(path.join(driver, 'prebuilds', addon), path.join(target, 'prebuilds', addon), { dereference: true });

const size = (at) => (statSync(at).isDirectory() ? readdirSync(at).reduce((sum, entry) => sum + size(path.join(at, entry)), 0) : statSync(at).size);
const mb = (bytes) => Math.round(bytes / 104857.6) / 10;
console.log(JSON.stringify({ ms: Date.now() - started, totalMB: mb(size(OUT) - size(path.join(OUT, 'meta.json'))), bundleMB: mb(size(path.join(OUT, 'main.cjs'))), driverMB: mb(size(target)), addon }));
