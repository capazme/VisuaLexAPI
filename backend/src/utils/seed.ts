/**
 * Database seed script
 * Creates initial admin user for the application
 *
 * Usage: npm run db:seed
 *
 * Environment variables:
 * - ADMIN_EMAIL: Admin user email (default: admin@visualex.it)
 * - ADMIN_USERNAME: Admin username (default: admin)
 * - ADMIN_PASSWORD: Admin password (required, no default for security)
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword } from './password';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@visualex.it';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    console.error('Error: ADMIN_PASSWORD environment variable is required');
    console.error('Please set it in your .env file or as an environment variable');
    process.exit(1);
  }

  console.log('Seeding database...\n');

  // Check if admin user already exists
  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        { email: adminEmail },
        { username: adminUsername },
      ],
    },
  });

  if (existingAdmin) {
    console.log('Admin user already exists:');
    console.log(`  Email: ${existingAdmin.email}`);
    console.log(`  Username: ${existingAdmin.username}`);
    console.log(`  Is Admin: ${existingAdmin.isAdmin}`);

    if (!existingAdmin.isAdmin) {
      // Update existing user to be admin
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { isAdmin: true },
      });
      console.log('\n  -> Updated to admin status');
    }

    console.log('\nSeed completed.');
    return;
  }

  // Create admin user
  const hashedPassword = await hashPassword(adminPassword);

  const adminUser = await prisma.user.create({
    data: {
      email: adminEmail,
      username: adminUsername,
      password: hashedPassword,
      isAdmin: true,
      isActive: true,
      isVerified: true,
    },
  });

  console.log('Admin user created successfully:');
  console.log(`  ID: ${adminUser.id}`);
  console.log(`  Email: ${adminUser.email}`);
  console.log(`  Username: ${adminUser.username}`);
  console.log(`  Is Admin: ${adminUser.isAdmin}`);
  console.log(`  Is Active: ${adminUser.isActive}`);
  console.log(`  Is Verified: ${adminUser.isVerified}`);
  console.log('\nSeed completed.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
