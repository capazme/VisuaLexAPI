import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '../../src/lib/db';
import { errorHandler } from '../../src/middleware/errorHandler';

/**
 * An unexpected error's log line (item 6 of the security inventory): whoever reads the server's logs (anyone with
 * the host's docker group) must not read what a user was writing. A Prisma validation error quotes the query's
 * arguments in its message, and other errors may quote their input: the line keeps the kind, the code, the fields
 * and where it was thrown, never the message.
 */
const CLIENT_TEXT = 'Ricorso per il sig. Mario Rossi, codice fiscale RSSMRA80A01H501U';

function handle(err: unknown) {
  const logged: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map((arg) => (typeof arg === 'string' ? arg : arg instanceof Error ? `${arg.stack}` : JSON.stringify(arg))).join(' '));
  });
  const res = { statusCode: 0, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  const req = { method: 'POST', path: '/api/atti/123', originalUrl: '/api/atti/123?q=Rossi' } as unknown as Request;
  errorHandler(err as Error, req, res as unknown as Response, (() => {}) as NextFunction);
  return { logged: logged.join('\n'), res };
}

describe('the log of an unexpected error', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never carries the arguments a Prisma validation error quotes', () => {
    const err = new Prisma.PrismaClientValidationError(
      `Invalid \`prisma.atto.create()\` invocation:\n\n{\n  data: {\n    testo: "${CLIENT_TEXT}"\n  }\n}\n\nUnknown argument`,
      { clientVersion: '5.22.0' },
    );
    const { logged, res } = handle(err);
    expect(logged).not.toContain('Mario Rossi');
    expect(logged).not.toContain('RSSMRA80A01H501U');
    expect(logged).toContain('PrismaClientValidationError');
    expect(logged).toMatch(/\bat /);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ detail: 'Internal server error' });
  });

  it('keeps the code and the fields of a known Prisma error, not its message', () => {
    const err = new Prisma.PrismaClientKnownRequestError(`Foreign key failed on ${CLIENT_TEXT}`, {
      code: 'P2003',
      clientVersion: '5.22.0',
      meta: { field_name: 'atti_user_id_fkey (index)', modelName: 'Atto' },
    });
    const { logged } = handle(err);
    expect(logged).not.toContain('Mario Rossi');
    expect(logged).toContain('P2003');
    expect(logged).toContain('Atto');
  });

  it('never carries the message of any other error, nor the query string', () => {
    const { logged } = handle(new TypeError(`Cannot read properties of undefined (reading '${CLIENT_TEXT}')`));
    expect(logged).not.toContain('Mario Rossi');
    expect(logged).not.toContain('q=Rossi');
    expect(logged).toContain('TypeError');
    expect(logged).toContain('POST /api/atti/123');
  });

  it('cuts a message that spans lines, even one that looks like a stack frame', () => {
    const { logged } = handle(new Error(`Salvataggio fallito\n    at Mario Rossi (studio legale)\n${CLIENT_TEXT}`));
    expect(logged).not.toContain('Mario Rossi');
    expect(logged).toMatch(/\bat /);
  });

  it('writes no stack it cannot tell apart from the message (a stack read before the message changed)', () => {
    const err = new Error('x');
    void err.stack;
    err.message = `contesto\n    at Mario Rossi (studio legale)`;
    const { logged } = handle(err);
    expect(logged).not.toContain('Mario Rossi');
    expect(logged).toContain('stack omitted');
  });

  it('says what was thrown when it is not an Error', () => {
    const { logged, res } = handle(CLIENT_TEXT);
    expect(logged).not.toContain('Mario Rossi');
    expect(logged).toContain('string');
    expect(res.statusCode).toBe(500);
  });
});
