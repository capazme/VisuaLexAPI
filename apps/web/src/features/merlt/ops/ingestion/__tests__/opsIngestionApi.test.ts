import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMerltMock = vi.fn();
const postMerltMock = vi.fn();
vi.mock('../../../../../services/merltService', () => ({
  getMerlt: (...args: unknown[]) => getMerltMock(...args),
  postMerlt: (...args: unknown[]) => postMerltMock(...args),
}));

import {
  runIngestion,
  listBatches,
  getBatch,
  promoteBatch,
  rejectBatch,
  extractUrnConflictsError,
} from '../opsIngestionApi';

beforeEach(() => {
  getMerltMock.mockReset();
  postMerltMock.mockReset();
});

describe('opsIngestionApi', () => {
  it('runIngestion POSTs to /merlt/ops/ingestion/run with the raw body', async () => {
    postMerltMock.mockResolvedValue({ batch_id: 'b1', job_id: 'j1' });
    const res = await runIngestion({
      source: 'visualex_tree',
      source_ref: '{"act_type":"codice civile"}',
      scope_label: 'Libro IV',
    });
    expect(postMerltMock).toHaveBeenCalledWith('/merlt/ops/ingestion/run', {
      source: 'visualex_tree',
      source_ref: '{"act_type":"codice civile"}',
      scope_label: 'Libro IV',
    });
    expect(res).toEqual({ batch_id: 'b1', job_id: 'j1' });
  });

  it('listBatches GETs /merlt/ops/ingestion/batches with only the provided query params', async () => {
    getMerltMock.mockResolvedValue({ batches: [] });
    await listBatches({ status: 'pending_review', limit: 20, offset: 10 });
    expect(getMerltMock).toHaveBeenCalledWith('/merlt/ops/ingestion/batches', {
      status: 'pending_review',
      limit: 20,
      offset: 10,
    });
  });

  it('listBatches omits undefined query params', async () => {
    getMerltMock.mockResolvedValue({ batches: [] });
    await listBatches();
    expect(getMerltMock).toHaveBeenCalledWith('/merlt/ops/ingestion/batches', {});
  });

  it('getBatch GETs the batch detail with node_limit/edge_limit mapped from camelCase', async () => {
    getMerltMock.mockResolvedValue({ id: 'b1' });
    await getBatch('b1', { nodeLimit: 20, edgeLimit: 40 });
    expect(getMerltMock).toHaveBeenCalledWith('/merlt/ops/ingestion/batches/b1', {
      node_limit: 20,
      edge_limit: 40,
    });
  });

  it('getBatch URL-encodes the batchId', async () => {
    getMerltMock.mockResolvedValue({ id: 'a/b' });
    await getBatch('a/b');
    expect(getMerltMock).toHaveBeenCalledWith('/merlt/ops/ingestion/batches/a%2Fb', {});
  });

  it('promoteBatch POSTs force/reason to the promote route', async () => {
    postMerltMock.mockResolvedValue({ batch_id: 'b1', job_id: 'j2', status: 'promoting' });
    await promoteBatch('b1', { force: true, reason: 'ok' });
    expect(postMerltMock).toHaveBeenCalledWith('/merlt/ops/ingestion/batches/b1/promote', {
      force: true,
      reason: 'ok',
    });
  });

  it('promoteBatch defaults to an empty body when no input is given', async () => {
    postMerltMock.mockResolvedValue({ batch_id: 'b1', job_id: 'j2', status: 'promoting' });
    await promoteBatch('b1');
    expect(postMerltMock).toHaveBeenCalledWith('/merlt/ops/ingestion/batches/b1/promote', {});
  });

  it('rejectBatch POSTs the mandatory reason to the reject route', async () => {
    postMerltMock.mockResolvedValue({ batch_id: 'b1', status: 'rejected' });
    await rejectBatch('b1', { reason: 'duplicate scope' });
    expect(postMerltMock).toHaveBeenCalledWith('/merlt/ops/ingestion/batches/b1/reject', {
      reason: 'duplicate scope',
    });
  });
});

describe('extractUrnConflictsError', () => {
  it('extracts urn_conflicts from the structured 409 body (apiClient interceptor shape)', () => {
    const err = {
      status: 409,
      data: {
        detail: {
          error: 'urn_conflicts_block_promotion',
          urn_conflicts: [{ urn: 'urn:x', batch: {}, graph: {} }],
        },
      },
    };
    expect(extractUrnConflictsError(err)).toEqual([{ urn: 'urn:x', batch: {}, graph: {} }]);
  });

  it('returns null for an unrelated error body', () => {
    expect(extractUrnConflictsError({ status: 503, data: { detail: 'merlt_unavailable' } })).toBeNull();
  });

  it('returns null for a network error / non-object err', () => {
    expect(extractUrnConflictsError(new Error('network'))).toBeNull();
    expect(extractUrnConflictsError(undefined)).toBeNull();
    expect(extractUrnConflictsError('boom')).toBeNull();
  });

  it('returns null when detail.error has the wrong value', () => {
    expect(
      extractUrnConflictsError({ status: 409, data: { detail: { error: 'something_else' } } })
    ).toBeNull();
  });
});
