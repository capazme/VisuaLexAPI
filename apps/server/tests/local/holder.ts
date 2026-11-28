// Not a test: a process that migrates the local file and opens it through the app's own client, and keeps it,
// for tests/local/migrate.test.ts («one process on the file»). Usage: tsx tests/local/holder.ts <file> <keyHex> <sqlDir>
import path from 'node:path';
import { PrismaClient } from '../../src/generated/prisma-local/client';
import { localAdapter } from '../../src/local/database';
import { migrateLocal } from '../../src/local/migrate';

const [file, keyHex, sqlDir] = process.argv.slice(2);
try {
  migrateLocal({ file, keyHex, sqlDir, backupsDir: path.join(path.dirname(file), 'backups') });
} catch (error) {
  process.stdout.write(`REFUSED ${(error as Error).message}\n`);
  process.exit(3);
}
const prisma = new PrismaClient({ adapter: localAdapter({ file, keyHex }) });
prisma.$queryRawUnsafe('SELECT 1').then(() => {
  process.stdout.write(`READY pid=${process.pid}\n`);
  setInterval(() => undefined, 1000);
}, (error: Error) => {
  process.stdout.write(`REFUSED ${error.message}\n`);
  process.exit(3);
});
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
