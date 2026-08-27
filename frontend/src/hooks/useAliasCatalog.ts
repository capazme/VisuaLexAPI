import { useEffect, useState } from 'react';

/**
 * What the server already recognises when naming an act.
 *
 * Two different things, deliberately kept apart:
 *
 * - `presets` are the aliases we ship — shortcuts that only work because a
 *   table maps them ("gdpr" → regolamento UE 679/2016). A user overrides one
 *   by creating a CustomAlias with the same trigger, which wins because the
 *   client resolves its own aliases before asking the server.
 * - `knownActs` are names the resolver understands on its own ("statuto dei
 *   lavoratori", "legge fornero", "TUSL"). These need no shortcut at all, and
 *   an alias for one is a duplicate that can only drift.
 *
 * Fetched once per manager opening, not stored: it is a few hundred short
 * strings and it changes only when the server does.
 */
export interface PresetAlias {
  act_type: string;
  act_number?: string;
  date?: string;
}

export interface AliasCatalog {
  presets: Record<string, PresetAlias>;
  knownActs: string[];
}

const EMPTY: AliasCatalog = { presets: {}, knownActs: [] };

export function useAliasCatalog(enabled: boolean): { catalog: AliasCatalog; loading: boolean } {
  const [catalog, setCatalog] = useState<AliasCatalog>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;

    const controller = new AbortController();
    fetch('/fetch_alias_catalog', { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(payload => {
        setCatalog({
          presets: payload?.presets ?? {},
          knownActs: payload?.known_acts ?? [],
        });
        setLoaded(true);
      })
      .catch(err => {
        if ((err as Error).name === 'AbortError') return;
        // Never swallowed (CLAUDE.md gotcha 18). The manager degrades to
        // showing only the user's own aliases, which is what it did before
        // this existed — but a backend that stopped answering stays visible.
        console.error('Error loading the alias catalog:', err);
        setLoaded(true);
      });

    return () => controller.abort();
  }, [enabled, loaded]);

  return { catalog, loading: enabled && !loaded };
}

/** Case- and accent-insensitive fold, matching the index filter's rule. */
export function foldAlias(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
