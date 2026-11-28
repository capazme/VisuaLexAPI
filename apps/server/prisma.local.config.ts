// The Prisma CLI's configuration for the desktop app's local schema (G-612): `npm run local:generate` and the
// `prisma migrate diff` of `npm run local:schema`. The URL is never opened: the local database is encrypted and
// only the app opens it, through the driver adapter (docs/superpowers/specs/2026-11-26-desktop-local-mode-design.md).
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/local/schema.prisma',
  datasource: { url: 'file:./local-schema-unused.db' },
});
