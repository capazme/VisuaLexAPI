/**
 * Reset admin user credentials
 * Usage: npx tsx src/utils/resetAdmin.ts
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword } from './password';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const newEmail = process.env.ADMIN_EMAIL || 'admin@visualex.it';
  const newPassword = process.env.ADMIN_PASSWORD || 'changeme123';

  // Find admin user
  const admin = await prisma.user.findFirst({
    where: { isAdmin: true }
  });

  if (!admin) {
    console.log('No admin user found. Run db:seed first.');
    return;
  }

  console.log('Current admin:', admin.email);

  // Hash new password
  const hashedPassword = await hashPassword(newPassword);

  // Update credentials
  await prisma.user.update({
    where: { id: admin.id },
    data: {
      email: newEmail,
      password: hashedPassword
    }
  });

  console.log('\nAdmin credentials updated:');
  console.log('  Email:', newEmail);
  console.log('  Password:', newPassword);
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
