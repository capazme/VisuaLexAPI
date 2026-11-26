// Not a test: a process that opens the local file through the app's own client and keeps it, for
// tests/local/migrate.test.ts («one instance»). Usage: tsx tests/local/holder.ts <file> <keyHex>
import { PrismaClient } from '../../src/generated/prisma-local/client';
import { localAdapter } from '../../src/local/database';

const [file, keyHex] = process.argv.slice(2);
const prisma = new PrismaClient({ adapter: localAdapter({ file, keyHex }) });
prisma.$queryRawUnsafe('SELECT 1').then(() => {
  process.stdout.write('READY\n');
  setInterval(() => undefined, 1000);
});
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
