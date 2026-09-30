import express from 'express';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request } from './helpers';
import { createScrapeGate, scrapeCost, type ScrapeGateOptions } from '../src/middleware/scrapeGate';

// A small app around the gate alone, with the limits a test needs. One persistent listening
// server, for the reason tests/helpers.ts gives for the real app.
function gateApp(options: ScrapeGateOptions): Server {
  const gate = express();
  gate.set('trust proxy', 1);
  gate.get('/verify', ...createScrapeGate(options));
  const server = gate.listen(0, '127.0.0.1');
  server.unref();
  return server;
}

const roomy: ScrapeGateOptions = { userPoints: 1000, windowSeconds: 60, ipPoints: 1000 };

describe('scrapeCost', () => {
  it('prices a route by its path, whatever the query string', () => {
    expect(scrapeCost('/export_pdf')).toBe(20);
    expect(scrapeCost('/export_pdf?x=1')).toBe(20);
    expect(scrapeCost('/stream_article_text')).toBe(3);
    expect(scrapeCost('/fetch_all_data')).toBe(5);
    expect(scrapeCost('/health/detailed')).toBe(5);
    expect(scrapeCost('/fetch_article_text')).toBe(1);
  });

  it('prices a route the way the scrapers read it: escapes decoded, path normalised', () => {
    expect(scrapeCost('/export%5Fpdf')).toBe(20);
    expect(scrapeCost('/%65xport_pdf')).toBe(20);
    expect(scrapeCost('//export_pdf')).toBe(20);
    expect(scrapeCost('/x/../export_pdf')).toBe(20);
    expect(scrapeCost('/./export_pdf')).toBe(20);
    expect(scrapeCost('/export%5Fpdf?x=1')).toBe(20);
    expect(scrapeCost('/stream%5Farticle_text')).toBe(3);
    expect(scrapeCost('/fetch_article_text')).toBe(1);
  });

  it('does not throw on a malformed escape, and prices it as it stands', () => {
    expect(() => scrapeCost('/export%ZZpdf')).not.toThrow();
    expect(scrapeCost('/export%ZZpdf')).toBe(1);
  });

  it('costs 1 when the ingress did not say what was asked', () => {
    expect(scrapeCost(undefined)).toBe(1);
    expect(scrapeCost('')).toBe(1);
  });
});

describe('the scrape gate', () => {
  it('answers 401 without a token, and with something that is not a token', async () => {
    const server = gateApp(roomy);

    expect((await request(server).get('/verify')).status).toBe(401);
    expect((await request(server).get('/verify').set('Authorization', 'Bearer nonsense')).status).toBe(401);
  });

  it('answers 401 for an account that is no longer active', async () => {
    const user = await createTestUser('gate-inactive');
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    expect((await request(gateApp(roomy)).get('/verify').set(authHeader(user))).status).toBe(401);
  });

  it('answers 204 with no body to a signed-in user', async () => {
    const user = await createTestUser('gate-ok');

    const response = await request(gateApp(roomy)).get('/verify').set(authHeader(user));

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
  });

  it('gives each user a quota of their own, and answers 429 with Retry-After beyond it', async () => {
    const server = gateApp({ ...roomy, userPoints: 3 });
    const a = await createTestUser('gate-a');
    const b = await createTestUser('gate-b');

    for (let i = 0; i < 3; i += 1) {
      expect((await request(server).get('/verify').set(authHeader(a))).status).toBe(204);
    }
    const over = await request(server).get('/verify').set(authHeader(a));

    expect(over.status).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect((await request(server).get('/verify').set(authHeader(b))).status).toBe(204);
  });

  it('charges a request by the route the ingress says it is for', async () => {
    const server = gateApp({ ...roomy, userPoints: 30 });
    const user = await createTestUser('gate-cost');
    const pdf = () =>
      request(server).get('/verify').set(authHeader(user)).set('X-Forwarded-Uri', '/export_pdf');

    expect((await pdf()).status).toBe(204); // 20 points of 30
    expect((await pdf()).status).toBe(429); // 20 more do not fit
  });

  it('caps one address, so a flood without a token stops at the door', async () => {
    const server = gateApp({ ...roomy, ipPoints: 3 });
    const statuses: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      statuses.push((await request(server).get('/verify')).status);
    }

    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });
});

describe('GET /api/auth/verify on the real app', () => {
  it('answers 401 without a token', async () => {
    expect((await request(app).get('/api/auth/verify')).status).toBe(401);
  });

  it('is counted by its own quota, not by the API’s general one', async () => {
    const user = await createTestUser('gate-real');

    for (let i = 0; i < 5; i += 1) {
      const verify = await request(app).get('/api/auth/verify').set(authHeader(user));
      expect(verify.status).toBe(204);
      expect(verify.headers['ratelimit-limit']).toBeUndefined(); // the general limiter never saw it
    }
    const me = await request(app).get('/api/auth/me').set(authHeader(user));

    expect(me.status).toBe(200);
    // 300 a minute for a signed-in user, and this is the first call the general limiter counts.
    expect(me.headers['ratelimit-remaining']).toBe('299');
  });
});
