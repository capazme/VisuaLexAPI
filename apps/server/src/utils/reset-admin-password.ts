/**
 * Reset password of an existing admin user.
 *
 * Use this when you've lost the admin password.
 *
 * Usage:
 *   ADMIN_PASSWORD="<new_password>" npm run db:reset-admin
 *
 * Optionally override the target email:
 *   ADMIN_EMAIL="other-admin@example.com" ADMIN_PASSWORD="..." npm run db:reset-admin
 *
 * Environment variables:
 * - ADMIN_EMAIL:    Target user email (default: admin@visualex.it)
 * - ADMIN_PASSWORD: New password (REQUIRED, no default for security)
 *
 * If the user doesn't exist, run `npm run db:seed` first.
 */

import { prisma } from '../lib/prisma';
import { hashPassword } from './password';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@visualex.it';
  const newPassword = process.env.ADMIN_PASSWORD;

  if (!newPassword) {
    console.error('Error: ADMIN_PASSWORD environment variable is required');
    console.error('  Usage: ADMIN_PASSWORD="<new>" npm run db:reset-admin');
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error('Error: password must be at least 8 characters');
    process.exit(1);
  }

  console.log(`Resetting password for: ${adminEmail}`);

  const user = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!user) {
    console.error(`Error: user with email ${adminEmail} not found`);
    console.error('  Run `npm run db:seed` first to create the admin user');
    process.exit(1);
  }

  const hashedPassword = await hashPassword(newPassword);

  // As the administrator's reset on the admin page (A.1, D3): a lost or compromised password, so every web session
  // of the account ends and every connected application is revoked. Written here rather than imported, so the
  // command needs nothing but the database.
  const now = new Date();
  const [updated, sessions] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
      select: {
        id: true,
        email: true,
        username: true,
        isAdmin: true,
        isActive: true,
      },
    }),
    prisma.webSession.deleteMany({ where: { userId: user.id } }),
    prisma.oAuthToken.updateMany({ where: { grant: { userId: user.id }, revokedAt: null }, data: { revokedAt: now } }),
    prisma.oAuthGrant.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
  ]);

  console.log('\nPassword reset successfully:');
  console.log(`  ID: ${updated.id}`);
  console.log(`  Email: ${updated.email}`);
  console.log(`  Username: ${updated.username}`);
  console.log(`  Is Admin: ${updated.isAdmin}`);
  console.log(`  Is Active: ${updated.isActive}`);
  console.log(`  Web sessions ended: ${sessions.count}; connected applications revoked.`);
  console.log('\nYou can now log in at http://localhost:5173 with the new password.');
}

main()
  .catch((e) => {
    console.error('Reset failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
