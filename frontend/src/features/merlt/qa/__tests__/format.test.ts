import { describe, it, expect } from 'vitest';
import { confirmSourceEntityText, formatRetrievedUrn, urnKind } from '../format';

describe('confirmSourceEntityText (B3 — human name for "ricorda nel grafo")', () => {
  it('prefers the underlying source_url for a provisional live: node', () => {
    expect(
      confirmSourceEntityText({
        urn: 'live:abc',
        provenance: 'live_unconfirmed',
        node_id: 'live:abc',
        source_url: 'https://normattiva.it/...~art467',
      }),
    ).toBe('art. 467');
  });

  it('falls back to a human placeholder for a bare live: node with no source_url', () => {
    const name = confirmSourceEntityText({
      urn: 'live:abc',
      provenance: 'live_unconfirmed',
      node_id: 'live:abc',
    });
    expect(name).toBe('Fonte provvisoria');
    // The critical invariant: never the raw provisional id.
    expect(name.startsWith('live:')).toBe(false);
  });

  it('formats a canonical article URN directly', () => {
    expect(confirmSourceEntityText({ urn: 'urn:nir:..~art1453', provenance: 'seed' })).toBe('art. 1453');
  });

  it('never returns a string starting with the live: node id', () => {
    for (const source_url of [undefined, 'https://normattiva.it/...~art12-bis']) {
      const name = confirmSourceEntityText({
        urn: 'live:deadbeef',
        provenance: 'live_unconfirmed',
        node_id: 'live:deadbeef',
        source_url,
      });
      expect(name.startsWith('live:')).toBe(false);
    }
  });
});

describe('formatRetrievedUrn', () => {
  it('renders a provisional live: node as a placeholder', () => {
    expect(formatRetrievedUrn('live:abc')).toBe('Fonte provvisoria');
  });
});

describe('urnKind (feature 3 — "Apri" quick-open classification)', () => {
  it('classifies a Normattiva URL as norma', () => {
    expect(urnKind('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043')).toEqual({
      kind: 'norma',
    });
  });

  it('classifies a bare urn:nir: string as norma', () => {
    expect(urnKind('urn:nir:stato:legge:1990-08-07;241~art1')).toEqual({ kind: 'norma' });
  });

  it('classifies a ~artN marker (no normattiva.it host) as norma', () => {
    expect(urnKind('some-graph-node~art1453')).toEqual({ kind: 'norma' });
  });

  it('classifies a massima_cassazione_* node as sentenza', () => {
    expect(urnKind('massima_cassazione_civile_4022_2018')).toEqual({ kind: 'sentenza' });
  });

  it('classifies a bare massima_* node as sentenza', () => {
    expect(urnKind('massima_12345')).toEqual({ kind: 'sentenza' });
  });

  it('classifies a live: provisional node as unknown (never openable)', () => {
    expect(urnKind('live:abc')).toEqual({ kind: 'unknown' });
  });

  it('classifies a concept node (modalita:*) as unknown', () => {
    expect(urnKind('modalita:diritto_di_chiedere_il_risarcimento_del_danno')).toEqual({ kind: 'unknown' });
  });

  it('classifies an empty string as unknown', () => {
    expect(urnKind('')).toEqual({ kind: 'unknown' });
  });
});
