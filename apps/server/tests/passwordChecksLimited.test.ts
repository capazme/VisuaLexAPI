import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request } from './helpers';

/**
 * The account's own routes that check its password count a wrong one as a failed attempt from the address, as a
 * sign-in does (5 in 15 minutes): a stolen session cannot be used to guess the password. A right one is given back.
 */
const from = (address: string) => ({ 'X-Forwarded-For': address });

describe('changing the password', () => {
  it('refuses the sixth wrong current password from one address', async () => {
    const user = await createTestUser('pw-change-guess');
    const attempt = () => request(app).put('/api/auth/change-password').set(authHeader(user)).set(from('203.0.124.1'))
      .send({ current_password: 'Wrong-guess1', new_password: 'Abcdefg1' });
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(400);
    expect((await attempt()).status).toBe(429);
  });

  it('gives a right password back: a person who mistypes once is not held up', async () => {
    const user = await createTestUser('pw-change-ok');
    const at = from('203.0.124.2');
    for (let i = 0; i < 4; i += 1) {
      expect((await request(app).put('/api/auth/change-password').set(authHeader(user)).set(at)
        .send({ current_password: 'Wrong-guess1', new_password: 'Abcdefg1' })).status).toBe(400);
    }
    const right = await request(app).put('/api/auth/change-password').set(authHeader(user)).set(at)
      .send({ current_password: 'test-password', new_password: 'Abcdefg1' });
    expect(right.status).toBe(200);
    // The right one gave its point back: one more wrong guess is the fifth, not the sixth.
    expect((await request(app).put('/api/auth/change-password').set(authHeader(user)).set(at)
      .send({ current_password: 'Wrong-guess1', new_password: 'Abcdefg2' })).status).toBe(400);
  });
});

describe('deleting the account', () => {
  it('refuses the sixth wrong password from one address, and the account stays', async () => {
    const user = await createTestUser('pw-delete-guess');
    const attempt = () => request(app).delete('/api/auth/account').set(authHeader(user)).set(from('203.0.124.3'))
      .send({ password: 'Wrong-guess1', confirmation: 'ELIMINA ACCOUNT' });
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(400);
    expect((await attempt()).status).toBe(429);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });
});
