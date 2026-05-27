import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../../../src/middleware/merlt/requireAdmin';

function mockRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('requireAdmin middleware', () => {
  it('401s when there is no authenticated user', () => {
    const req = {} as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s with admin_required when the user is not an admin', () => {
    const req = { user: { id: 'u1', isAdmin: false } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ detail: 'admin_required' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for an admin user', () => {
    const req = { user: { id: 'u1', isAdmin: true } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
