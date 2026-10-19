import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpsClient } from '../../../src/services/merlt/opsClient';
import {
  MerltServerError,
  MerltBadRequestError,
} from '../../../src/services/merlt/merltClient';

const cfg = { baseUrl: 'http://merlt.local:8000', timeoutMs: 500 };

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpsClient.startTraining', () => {
  it('POSTs the config to /api/v1/rlcf/training/start and returns the ack', async () => {
    mockFetchOnce(200, { success: true, training_id: 'train_x', message: 'ok' });

    const res = await new OpsClient(cfg).startTraining({ epochs: 10 });

    expect(res.success).toBe(true);
    expect(res.training_id).toBe('train_x');

    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('http://merlt.local:8000/api/v1/rlcf/training/start');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ epochs: 10 });
  });

  it('defaults the body to {} when no config is given', async () => {
    mockFetchOnce(200, { success: true });
    await new OpsClient(cfg).startTraining();
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body)).toEqual({});
  });

  it('maps a 5xx to MerltServerError', async () => {
    mockFetchOnce(500, {});
    await expect(new OpsClient(cfg).startTraining()).rejects.toBeInstanceOf(MerltServerError);
  });

  it('maps a 4xx to MerltBadRequestError', async () => {
    mockFetchOnce(400, { detail: 'bad' });
    await expect(new OpsClient(cfg).startTraining()).rejects.toBeInstanceOf(MerltBadRequestError);
  });
});
