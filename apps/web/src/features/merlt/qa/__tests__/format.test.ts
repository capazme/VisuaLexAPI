import { describe, it, expect } from 'vitest';
import { confirmSourceEntityText, formatRetrievedUrn, sourceLabel, urnKind } from '../format';

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

  it('formats a codice civile article as "art. N c.c."', () => {
    expect(
      formatRetrievedUrn(
        'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453',
      ),
    ).toBe('art. 1453 c.c.');
  });

  it('formats a non-codice-civile article as plain "art. N"', () => {
    expect(formatRetrievedUrn('urn:nir:stato:legge:1990-08-07;241~art1')).toBe('art. 1');
  });

  it('formats a Cassazione civile massima as "Cass. civ. N/YYYY"', () => {
    expect(formatRetrievedUrn('massima_cassazione_civile_4022_2018')).toBe('Cass. civ. 4022/2018');
  });

  it('formats a generic massima_<branch>_<num>_<year> shape', () => {
    expect(formatRetrievedUrn('massima_penale_1234_2020')).toBe('Cass. pen. 1234/2020');
  });

  it('defaults the branch abbreviation to "civ" for a bare massima_<num>_<year>', () => {
    expect(formatRetrievedUrn('massima_9999_2021')).toBe('Cass. civ. 9999/2021');
  });

  it('humanizes a concetto: node id', () => {
    expect(formatRetrievedUrn('concetto:diritto_di_recesso')).toBe('Diritto di recesso');
  });

  it('humanizes a modalita: node id', () => {
    expect(formatRetrievedUrn('modalita:diritto_di_chiedere_il_risarcimento_del_danno')).toBe(
      'Diritto di chiedere il risarcimento del danno',
    );
  });
});

describe('sourceLabel (server title takes priority over urn humanization)', () => {
  it('prefers a non-empty title over the urn shape', () => {
    expect(
      sourceLabel({
        urn: 'https://www.normattiva.it/...~art1618',
        title: 'Art. 1618. (Inadempimenti dell’affittuario)',
      }),
    ).toBe('Art. 1618. (Inadempimenti dell’affittuario)');
  });

  it('trims a title with surrounding whitespace', () => {
    expect(sourceLabel({ urn: 'urn:nir:..~art1453', title: '  art. 1453 codice civile  ' })).toBe(
      'art. 1453 codice civile',
    );
  });

  it('falls back to urn humanization when title is null', () => {
    expect(sourceLabel({ urn: 'urn:nir:..~art1453', title: null })).toBe('art. 1453');
  });

  it('falls back to urn humanization when title is an empty string', () => {
    expect(sourceLabel({ urn: 'urn:nir:..~art1453', title: '' })).toBe('art. 1453');
  });

  it('falls back to urn humanization when title is absent', () => {
    expect(sourceLabel({ urn: 'massima_cassazione_civile_4022_2018' })).toBe('Cass. civ. 4022/2018');
  });

  it('prefers source_url over the opaque live: hash when no title is known', () => {
    expect(
      sourceLabel({
        urn: 'live:abc',
        node_id: 'live:abc',
        source_url: 'https://www.normattiva.it/...~art467',
      }),
    ).toBe('art. 467');
  });

  it('falls back to "Fonte provvisoria" for a live: node with no title and no source_url', () => {
    expect(sourceLabel({ urn: 'live:deadbeef', node_id: 'live:deadbeef' })).toBe('Fonte provvisoria');
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
