import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * The registry reads import.meta.env at module load time. To toggle the
 * VITE_FEATURE_MERLT flag between tests we use vi.stubEnv() — vitest's
 * built-in mechanism for swapping env values without re-importing the
 * module. Each test stubs the desired value, then asserts against
 * getSlotComponents/PluginSlot.
 *
 * The ArticleMerltSlot dependency is mocked to a benign null-renderer so
 * we don't actually wire up IntersectionObserver / consent / fetch here.
 */

vi.mock('../../features/merlt/ArticleMerltSlot', () => ({
  ArticleMerltSlot: () => null,
}));

import { getSlotComponents, PluginSlot } from '../registry';

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  cleanup();
});

describe('getSlotComponents', () => {
  it('returns the merlt-article-tracker entry by default (flag unset)', () => {
    const components = getSlotComponents('article_content_after');
    expect(components).toHaveLength(1);
    expect(components[0].id).toBe('merlt-article-tracker');
    expect(components[0].pluginId).toBe('visualex-merlt');
    expect(components[0].requiredFlag).toBe('VITE_FEATURE_MERLT');
  });

  it('includes the entry when VITE_FEATURE_MERLT=true', () => {
    vi.stubEnv('VITE_FEATURE_MERLT', 'true');
    expect(getSlotComponents('article_content_after')).toHaveLength(1);
  });

  it('excludes the entry when VITE_FEATURE_MERLT=false', () => {
    vi.stubEnv('VITE_FEATURE_MERLT', 'false');
    expect(getSlotComponents('article_content_after')).toHaveLength(0);
  });

  it('excludes the entry when VITE_FEATURE_MERLT=0', () => {
    vi.stubEnv('VITE_FEATURE_MERLT', '0');
    expect(getSlotComponents('article_content_after')).toHaveLength(0);
  });

  it('excludes the entry when VITE_FEATURE_MERLT="" (empty string)', () => {
    vi.stubEnv('VITE_FEATURE_MERLT', '');
    expect(getSlotComponents('article_content_after')).toHaveLength(0);
  });

  it('returns an empty array for slots with no registrations', () => {
    expect(getSlotComponents('graph_view')).toEqual([]);
    expect(getSlotComponents('profile_tabs')).toEqual([]);
    expect(getSlotComponents('admin_dashboard')).toEqual([]);
  });
});

describe('PluginSlot', () => {
  it('renders nothing when no components match (slot unused)', () => {
    const { container } = render(
      <PluginSlot slot="graph_view" props={{}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when feature flag is off', () => {
    vi.stubEnv('VITE_FEATURE_MERLT', 'false');
    const { container } = render(
      <PluginSlot
        slot="article_content_after"
        props={{ articleUrn: 'urn:test', containerRef: { current: null } }}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the registered component when feature flag is on', () => {
    vi.stubEnv('VITE_FEATURE_MERLT', 'true');
    // ArticleMerltSlot is mocked to render null — the slot still resolves,
    // we just check it didn't throw and that getSlotComponents agrees.
    const components = getSlotComponents('article_content_after');
    expect(components).toHaveLength(1);
    const { container } = render(
      <PluginSlot
        slot="article_content_after"
        props={{ articleUrn: 'urn:test', containerRef: { current: null } }}
      />
    );
    // Mocked component renders null — innerHTML stays empty BUT no error.
    expect(container.innerHTML).toBe('');
  });
});
