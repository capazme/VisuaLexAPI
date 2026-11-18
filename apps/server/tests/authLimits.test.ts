import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, request } from './helpers';

/**
 * The limits on signing in, on the token's refresh and on the session check (scan B, G-484). The app trusts
 * the loopback proxy, so each test speaks from its own address with X-Forwarded-For and does not share a
 * counter with the others.
 */
const from = (address: string) => ({ 'X-Forwarded-For': address });

const login = (address: string, email: string, password: string) =>
  request(app).post('/api/auth/login').set(from(address)).send({ email, password });

describe('signing in, per address', () => {
  it('refuses the sixth failed attempt in a row from one address, with Retry-After', async () => {
    const user = await createTestUser('limit-address');
    for (let i = 0; i < 5; i += 1) {
      expect((await login('198.51.100.1', user.email, 'wrong-password')).status).toBe(401);
    }
    const blocked = await login('198.51.100.1', user.email, 'test-password');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(15 * 60);
  });

  it('does not count a successful sign-in', async () => {
    const user = await createTestUser('limit-success');
    for (let i = 0; i < 4; i += 1) await login('198.51.100.2', user.email, 'wrong-password');
    for (let i = 0; i < 3; i += 1) {
      expect((await login('198.51.100.2', user.email, 'test-password')).status).toBe(200);
    }
    expect((await login('198.51.100.2', user.email, 'wrong-password')).status).toBe(401);
    expect((await login('198.51.100.2', user.email, 'test-password')).status).toBe(429);
  });

  it('counts registration attempts with the sign-in ones, as before', async () => {
    for (let i = 0; i < 5; i += 1) {
      const response = await request(app).post('/api/auth/register').set(from('198.51.100.3')).send({ email: 'not-an-email' });
      expect(response.status).toBe(400);
    }
    expect((await login('198.51.100.3', 'nobody@test.local', 'whatever')).status).toBe(429);
  });

  it('refuses a burst sent all at once, not only attempts one after another', async () => {
    const user = await createTestUser('limit-burst');
    const answers = await Promise.all(
      Array.from({ length: 12 }, () => login('198.51.100.4', user.email, 'wrong-password')),
    );
    const statuses = answers.map((answer) => answer.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(7);
  });
});

describe('signing in, per account', () => {
  it('blocks the account after 10 failed attempts spread over many addresses, even with the right password', async () => {
    const user = await createTestUser('limit-account');
    for (let i = 0; i < 10; i += 1) {
      expect((await login(`203.0.113.${i + 1}`, user.email, 'wrong-password')).status).toBe(401);
    }
    const blocked = await login('203.0.113.50', user.email, 'test-password');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(15 * 60);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60 * 60);
  });

  it('counts the email as typed, whatever its case and spaces', async () => {
    const user = await createTestUser('limit-case');
    const shouting = user.email.toUpperCase();
    for (let i = 0; i < 10; i += 1) {
      await login(`203.0.114.${i + 1}`, i % 2 ? shouting : ` ${user.email} `, 'wrong-password');
    }
    expect((await login('203.0.114.50', user.email, 'test-password')).status).toBe(429);
  });

  it('counts an email that has no account the same way, so the answer says nothing about it', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await login(`203.0.115.${i + 1}`, 'ghost@test.local', 'wrong-password')).status).toBe(401);
    }
    expect((await login('203.0.115.50', 'ghost@test.local', 'wrong-password')).status).toBe(429);
  });

  it('does not count a refusal for a blocked account against its address', async () => {
    const victim = await createTestUser('limit-blocked');
    const colleague = await createTestUser('limit-colleague');
    for (let i = 0; i < 10; i += 1) await login(`203.0.117.${i + 1}`, victim.email, 'wrong-password');
    for (let i = 0; i < 6; i += 1) {
      expect((await login('203.0.117.100', victim.email, 'test-password')).status).toBe(429);
    }
    expect((await login('203.0.117.100', colleague.email, 'test-password')).status).toBe(200);
  });

  it('leaves the other accounts alone', async () => {
    const victim = await createTestUser('limit-victim');
    const other = await createTestUser('limit-other');
    for (let i = 0; i < 10; i += 1) await login(`203.0.116.${i + 1}`, victim.email, 'wrong-password');
    expect((await login('203.0.116.50', other.email, 'test-password')).status).toBe(200);
  });
});

describe('refreshing the token', () => {
  it('refuses the 31st refresh in a minute from one address, with Retry-After', async () => {
    for (let i = 0; i < 30; i += 1) {
      const response = await request(app).post('/api/auth/refresh').set(from('192.0.2.10')).send({ refresh_token: 'not-a-token' });
      expect(response.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/refresh').set(from('192.0.2.10')).send({ refresh_token: 'not-a-token' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
  });
});

describe('the session check, GET /api/auth/me (G-484)', () => {
  it('has a counter of its own, wider than the general one', async () => {
    const user = await createTestUser('limit-me');
    const response = await request(app).get('/api/auth/me').set(authHeader(user));
    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-limit']).toBe('600');
  });

  it('does not spend the general counter, and the general calls do not spend its own', async () => {
    const user = await createTestUser('limit-me-apart');
    const general = async () =>
      Number((await request(app).get('/api/folders').set(authHeader(user))).headers['ratelimit-remaining']);
    const check = async () =>
      Number((await request(app).get('/api/auth/me').set(authHeader(user))).headers['ratelimit-remaining']);

    const generalBefore = await general();
    const checkBefore = await check();
    for (let i = 0; i < 5; i += 1) await check();
    expect(await general()).toBe(generalBefore - 1);
    expect(await check()).toBe(checkBefore - 6);
  });

  it('still refuses a missing or bad token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set({ Authorization: 'Bearer nope' })).status).toBe(401);
  });
});
