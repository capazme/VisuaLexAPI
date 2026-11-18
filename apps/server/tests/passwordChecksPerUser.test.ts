import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';

/**
 * The account's routes that check its password also count a wrong one per account, from any address: 10 an hour
 * across the three of them. The per-address count (5 in 15 minutes) stops guesses from one place; this one stops
 * a stolen session from guessing through many. A right password gives its point back. The count is not the
 * sign-in's, so the owner can always sign in. Each attempt here speaks from an address of its own, so the
 * per-address count never trips.
 */
const from = (address: string) => ({ 'X-Forwarded-For': address });

const wrongChange = (user: TestUser, address: string) =>
  request(app).put('/api/auth/change-password').set(authHeader(user)).set(from(address))
    .send({ current_password: 'Wrong-guess1', new_password: 'Abcdefg1' });
const wrongRemove = (user: TestUser, address: string) =>
  request(app).post('/api/auth/contributions/remove').set(authHeader(user)).set(from(address))
    .send({ password: 'Wrong-guess1' });
const wrongDelete = (user: TestUser, address: string) =>
  request(app).delete('/api/auth/account').set(authHeader(user)).set(from(address))
    .send({ password: 'Wrong-guess1', confirmation: 'ELIMINA ACCOUNT' });

describe('wrong passwords per account, from many addresses', () => {
  it('refuses the eleventh, each from a different address', async () => {
    const user = await createTestUser('pw-user-spread');
    for (let i = 0; i < 10; i += 1) expect((await wrongChange(user, `203.0.125.${i + 1}`)).status).toBe(400);
    const refused = await wrongChange(user, '203.0.125.11');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts the three routes together, and the account stays', async () => {
    const user = await createTestUser('pw-user-three');
    for (let i = 0; i < 4; i += 1) expect((await wrongChange(user, `203.0.125.${i + 21}`)).status).toBe(400);
    for (let i = 0; i < 3; i += 1) expect((await wrongRemove(user, `203.0.125.${i + 25}`)).status).toBe(400);
    for (let i = 0; i < 3; i += 1) expect((await wrongDelete(user, `203.0.125.${i + 28}`)).status).toBe(400);
    expect((await wrongDelete(user, '203.0.125.31')).status).toBe(429);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });

  it('gives a right password back', async () => {
    const user = await createTestUser('pw-user-right');
    for (let i = 0; i < 9; i += 1) expect((await wrongChange(user, `203.0.125.${i + 41}`)).status).toBe(400);
    const right = await request(app).put('/api/auth/change-password').set(authHeader(user)).set(from('203.0.125.50'))
      .send({ current_password: 'test-password', new_password: 'Abcdefg1' });
    expect(right.status).toBe(200);
    // The right one gave its point back: the next wrong one is the tenth, not the eleventh.
    expect((await wrongChange(user, '203.0.125.51')).status).toBe(400);
    expect((await wrongChange(user, '203.0.125.52')).status).toBe(429);
  });

  it('leaves the sign-in alone: the owner can still sign in, and end every session', async () => {
    const user = await createTestUser('pw-user-signin');
    for (let i = 0; i < 11; i += 1) await wrongChange(user, `203.0.125.${i + 61}`);
    expect((await wrongChange(user, '203.0.125.72')).status).toBe(429);
    const signIn = await request(app).post('/api/auth/login').set(from('203.0.125.73'))
      .send({ email: user.email, password: 'test-password' });
    expect(signIn.status).toBe(200);
    // Ending every web session needs no password, so a thief holding one can always be thrown out.
    expect((await request(app).post('/api/auth/logout-all').set(authHeader(user)).set(from('203.0.125.74'))).status)
      .toBeLessThan(300);
  });

  it('does not count a refusal for the account against its address', async () => {
    const user = await createTestUser('pw-user-blocked');
    const colleague = await createTestUser('pw-user-colleague');
    for (let i = 0; i < 9; i += 1) await wrongChange(user, `203.0.125.${i + 81}`);
    // The tenth from 203.0.125.100 counts there; the next three are refused for the account and given back.
    expect((await wrongChange(user, '203.0.125.100')).status).toBe(400);
    for (let i = 0; i < 3; i += 1) expect((await wrongChange(user, '203.0.125.100')).status).toBe(429);
    // So the address has spent one of its five, and a colleague behind it still has four.
    for (let i = 0; i < 4; i += 1) expect((await wrongChange(colleague, '203.0.125.100')).status).toBe(400);
    expect((await wrongChange(colleague, '203.0.125.100')).status).toBe(429);
  });

  it('leaves the other accounts alone', async () => {
    const user = await createTestUser('pw-user-victim');
    const other = await createTestUser('pw-user-other');
    for (let i = 0; i < 11; i += 1) await wrongChange(user, `203.0.125.${i + 111}`);
    expect((await wrongChange(user, '203.0.125.122')).status).toBe(429);
    expect((await wrongChange(other, '203.0.125.130')).status).toBe(400);
  });
});
