import { PrismaClient } from './db';
import { createPgAdapter } from './pgAdapter';

// The one PrismaClient of the server (tests/prismaClient.test.ts): Postgres through node-postgres (G-612).
export const prisma = new PrismaClient({ adapter: createPgAdapter(process.env.DATABASE_URL ?? '') });
