import { beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

/**
 * A password the administrator sets (a new account, or a reset) follows the rule a person meets at
 * sign-up: at least 8 characters, one lowercase, one uppercase, one digit (scan B).
 */
describe('a password set by the administrator', () => {
  let admin: TestUser;
  let carol: TestUser;
  beforeEach(async () => {
    admin = await createTestUser('pwrule-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    carol = await createTestUser('pwrule-carol');
  });

  const create = (password: string, username = 'pwrule-new') =>
    request(app)
      .post('/api/admin/users')
      .set(authHeader(admin))
      .send({ email: `${username}@test.local`, username, password });

  const reset = (newPassword: string) =>
    request(app).post(`/api/admin/users/${carol.id}/reset-password`).set(authHeader(admin)).send({ newPassword });

  const storedHash = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).password;

  it.each([
    ['too short', 'Ab1'],
    ['seven characters', 'Abcdef1'],
    ['no uppercase', 'abcdefg1'],
    ['no lowercase', 'ABCDEFG1'],
    ['no digit', 'Abcdefgh'],
  ])('refuses a new account whose password is %s, and creates nothing', async (_why, password) => {
    const response = await create(password);
    expect(response.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { username: 'pwrule-new' } })).toBeNull();
  });

  it('creates the account when the password meets the rule', async () => {
    const response = await create('Abcdefg1');
    expect(response.status).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { username: 'pwrule-new' } });
    expect(await bcrypt.compare('Abcdefg1', row.password)).toBe(true);
  });

  it.each([
    ['too short', 'Ab1'],
    ['seven characters', 'Abcdef1'],
    ['no uppercase', 'abcdefg1'],
    ['no lowercase', 'ABCDEFG1'],
    ['no digit', 'Abcdefgh'],
  ])('refuses a reset to a password that is %s, and leaves the old one', async (_why, password) => {
    const before = await storedHash(carol.id);
    const response = await reset(password);
    expect(response.status).toBe(400);
    expect(await storedHash(carol.id)).toBe(before);
  });

  it('resets the password when the new one meets the rule', async () => {
    const response = await reset('Abcdefg1');
    expect(response.status).toBe(200);
    expect(await bcrypt.compare('Abcdefg1', await storedHash(carol.id))).toBe(true);
  });

  it('says what the rule is, in the words the web already translates for the sign-up form', async () => {
    // Exactly the string `SERVER_WORDS` in apps/web/src/services/api.ts turns into Italian.
    const response = await create('abc');
    expect(response.body.detail).toBe(
      'Invalid request: password (Too small: expected string to have >=8 characters; ' +
        'Password must be at least 8 characters with 1 uppercase, 1 lowercase, and 1 number)',
    );
  });
});
