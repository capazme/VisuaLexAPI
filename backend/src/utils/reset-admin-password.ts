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

import { PrismaClient } from '@prisma/client';
import { hashPassword } from './password';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

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

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
    select: {
      id: true,
      email: true,
      username: true,
      isAdmin: true,
      isActive: true,
    },
  });

  console.log('\nPassword reset successfully:');
  console.log(`  ID: ${updated.id}`);
  console.log(`  Email: ${updated.email}`);
  console.log(`  Username: ${updated.username}`);
  console.log(`  Is Admin: ${updated.isAdmin}`);
  console.log(`  Is Active: ${updated.isActive}`);
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
