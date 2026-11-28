#!/usr/bin/env node
// The local CI job's tests (spec §8): tests/local/ and the Work files of tests/local/work-files.txt, on the desktop
// app's encrypted local file (LEXCRAFT_TEST_DB=local, tests/localRun.ts). The same on macOS and Windows: no shell.
//   npm run test:local [-- <vitest arguments>]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
// The suite's environment, as `npm test` loads it (dotenv-cli does not override what is already set).
require('dotenv').config({ path: path.join(root, '.env.test'), quiet: true });
const files = readFileSync(path.join(root, 'tests/local/work-files.txt'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const run = spawnSync(process.execPath, [vitest, 'run', 'tests/local/', ...files, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, LEXCRAFT_TEST_DB: 'local' },
});
process.exit(run.status ?? 1);
