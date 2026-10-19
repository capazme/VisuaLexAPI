require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

(async () => {
  const prisma = new PrismaClient();
  const email = 'e2e-loop-beta@visualex.test';
  let u = await prisma.user.findUnique({ where: { email } });
  if (!u) {
    const hashed = await bcrypt.hash('e2e-pass', 10);
    u = await prisma.user.create({
      data: { email, password: hashed, username: 'e2e-loopbeta', isAdmin: true },
    });
    console.log('created user', u.id);
  } else {
    if (!u.isAdmin) {
      u = await prisma.user.update({ where: { id: u.id }, data: { isAdmin: true } });
    }
    console.log('found user', u.id, 'isAdmin=', u.isAdmin);
  }
  const token = jwt.sign({ userId: u.id, email: u.email, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '4h' });
  console.log('JWT_TOKEN=' + token);
  console.log('USER_ID=' + u.id);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
