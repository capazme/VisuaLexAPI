import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { rejectOversizedUpload, MAX_UPLOAD_BYTES } from '../../../src/routes/merlt/contrib';

/**
 * Scan A.4: the upload was buffered in memory before its size was known. A request that declares
 * a body above the ceiling is refused on its header, before multer reads a byte of it.
 */
function call(contentLength: string | undefined) {
  const req = { headers: contentLength === undefined ? {} : { 'content-length': contentLength } } as unknown as Request;
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })), set: vi.fn() } as unknown as Response;
  const next = vi.fn();
  rejectOversizedUpload(req, res, next);
  return { res, json, next };
}

describe('rejectOversizedUpload', () => {
  it('is 10 MB, the size of a set of notes', () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  it('refuses a declared body far above the ceiling with 413, without reading it', () => {
    const { res, json, next } = call(String(200 * 1024 * 1024));
    expect(res.status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({ detail: 'file_too_large' });
    expect(res.set).toHaveBeenCalledWith('Connection', 'close');
    expect(next).not.toHaveBeenCalled();
  });

  it('lets through a body within the ceiling plus the multipart framing', () => {
    expect(call(String(MAX_UPLOAD_BYTES)).next).toHaveBeenCalled();
  });

  it('leaves a chunked body (no length) to multer, whose own limit still holds', () => {
    expect(call(undefined).next).toHaveBeenCalled();
  });
});
