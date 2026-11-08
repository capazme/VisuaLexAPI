import { describe, expect, it, vi } from 'vitest';

// The first load fails (offline, say), the next ones find jsPDF.
const { loads } = vi.hoisted(() => ({ loads: { count: 0 } }));
vi.mock('jspdf', () => {
  loads.count += 1;
  if (loads.count === 1) throw new Error('offline');
  return { jsPDF: class FakePdf {} };
});

import { loadJsPdf } from './loadJsPdf';

describe('loadJsPdf', () => {
  it('tries again after a failed load, then keeps what it loaded', async () => {
    await expect(loadJsPdf()).rejects.toThrow();
    const JsPdf = await loadJsPdf();
    expect(JsPdf.name).toBe('FakePdf');
    expect(await loadJsPdf()).toBe(JsPdf);
    expect(loads.count).toBe(2);
  });
});
