import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));

import { fetchDecisionCached } from '../decisionFetchCache';
import { createEnvironmentShareLink, environmentForExport, exportEnvironmentToFile } from '../environmentUtils';
import { articleHighlight, articleNote, decisionHighlight, decisionNote, obscuredAnswer } from '../../components/features/environments/__tests__/travelFixtures';
import type { Environment } from '../../types';

const env = {
  id: 'e', name: 'Prova', createdAt: '', dossiers: [], quickNorms: [], customAliases: [],
  annotations: [decisionNote, articleNote], highlights: [decisionHighlight, articleHighlight],
} as unknown as Environment;

beforeEach(() => {
  vi.mocked(fetchDecisionCached).mockResolvedValue(obscuredAnswer as never);
});

describe('environment export and share link: words a court withdrew stay home', () => {
  it('environmentForExport drops them and says so', async () => {
    const out = await environmentForExport(env);
    expect(out.env.annotations.map((a) => a.id)).toEqual(['n-art']);
    expect(out.env.highlights.map((h) => h.id)).toEqual(['h-art']);
    expect(out.message).toMatch(/non incluse/);
  });

  it('the file holds only what stands', async () => {
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const message = await exportEnvironmentToFile(env);
    expect(message).toMatch(/non incluse/);
    const written = JSON.parse(await new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(blob!); }));
    expect(written.data.annotations.map((a: { id: string }) => a.id)).toEqual(['n-art']);
    expect(written.data.highlights.map((h: { id: string }) => h.id)).toEqual(['h-art']);
  });

  it('the share link carries only what stands', async () => {
    const { link, message } = await createEnvironmentShareLink({ ...env, annotations: [decisionNote], highlights: [] });
    expect(message).toMatch(/1 nota/);
    const encoded = decodeURIComponent(new URL(link ?? 'http://x/?import=').searchParams.get('import') ?? '');
    const decoded = encoded ? decodeURIComponent(escape(atob(encoded))) : '';
    expect(decoded).not.toContain('Mario Rossi');
  });
});
