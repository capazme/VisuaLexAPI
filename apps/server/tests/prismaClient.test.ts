import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every PrismaClient owns a connection pool (physical CPUs * 2 + 1 connections
// by default). The server used to load eighteen of them, one per module, so a
// long-running process could hold eighteen pools against Postgres'
// max_connections. The one client is src/lib/prisma.ts and everything under
// src/ imports it; the test harness (setup.ts, helpers.ts) keeps its own.
const SRC = fileURLToPath(new URL('../src', import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('PrismaClient', () => {
  it('is constructed in src/lib/prisma.ts and nowhere else under src/', () => {
    const constructing = tsFiles(SRC)
      // `\b`, not `\(`: `new PrismaClient<Prisma.PrismaClientOptions>()` is a
      // client too, while `new Prisma.PrismaClientKnownRequestError` is not.
      .filter((file) => /\bnew\s+PrismaClient\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(constructing).toEqual(['lib/prisma.ts']);
  });
});
