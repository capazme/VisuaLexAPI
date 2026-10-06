import express from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { TRUST_PROXY } from '../src/lib/trustProxy';
import app from '../src/app';

// A bare app with the server's setting: what req.ip becomes for a given header.
// It listens on 127.0.0.1 (see helpers.ts), which stands for the ingress here.
const probe = express();
probe.set('trust proxy', TRUST_PROXY);
probe.get('/ip', (req, res) => res.json({ ip: req.ip }));
const server: Server = probe.listen(0, '127.0.0.1');
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const ipFor = async (xff?: string) => {
  const call = request(server).get('/ip');
  if (xff) call.set('X-Forwarded-For', xff);
  return (await call).body.ip as string;
};

describe('trust proxy: the real client address', () => {
  it('is the server setting', () => {
    expect(app.get('trust proxy')).toBe(TRUST_PROXY);
  });

  it('takes an overlay address forwarded through the host gateway', async () => {
    expect(await ipFor('100.64.1.2, 172.29.241.1')).toBe('100.64.1.2');
  });

  it('never takes what the client wrote before the first untrusted hop', async () => {
    expect(await ipFor('203.0.113.9, 100.64.1.2, 172.29.241.1')).toBe('100.64.1.2');
  });

  it('walks past private hops between the client and the ingress', async () => {
    expect(await ipFor('100.64.1.2, 10.0.0.9, 172.29.241.1')).toBe('100.64.1.2');
  });

  it('takes a public address', async () => {
    expect(await ipFor('198.51.100.7')).toBe('198.51.100.7');
  });

  it('takes a home-network address written by the ingress', async () => {
    expect(await ipFor('192.168.1.20')).toBe('192.168.1.20');
  });

  it('falls back to the socket address with no header', async () => {
    expect(await ipFor()).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });
});
