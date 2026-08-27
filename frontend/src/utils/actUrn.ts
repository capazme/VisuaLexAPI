import type { Norma } from '../types';

/**
 * Resolve an act from its identifying parameters, without fetching any article
 * text.
 *
 * `/fetch_norma_data` builds `NormaVisitata` objects purely from parameters —
 * no scraping happens. It also expands aliases: ask for "codice civile" and
 * the response comes back as regio decreto 262 of 1942-03-16. Keeping that
 * resolved identity matters, because a block built from the *request* instead
 * would never match the same act arriving later from a search, and the
 * workspace would grow a duplicate tab for it.
 *
 * The endpoint still requires an `article` value — more strictly than it used
 * to. The handler now rejects a missing one outright (400, "Campo obbligatorio
 * mancante: article"); before, it silently built a NormaVisitata with
 * `numero_articolo: 'error'`. So `'1'` stays. It is NOT a request for article 1
 * — do not "fix" it into one.
 *
 * What changed underneath: the article is now VALIDATED against the act, so the
 * probe is no longer safe merely because nothing checked it. It is safe because
 * article 1 exists in every act reachable from here — verified against the live
 * handler for the four codici, the Costituzione, a law cited by number, and an
 * alias-resolved act. The check fails open when the article tree cannot be
 * fetched, so a Normattiva outage does not turn a resolve into a failure. An
 * act whose numbering does not start at 1 would now 404 here; none is reachable
 * from the command palette today.
 */

export interface ActUrnParams {
  act_type: string;
  act_number?: string;
  /** ISO `YYYY-MM-DD`, or whatever the backend's date parser accepts. */
  date?: string;
}

export interface ResolvedAct {
  /** Identifier accepted by `/fetch_tree`. */
  urn: string;
  /** The act as the backend resolved it, ready to seed a workspace block. */
  norma: Norma;
}

export async function resolveAct(params: ActUrnParams): Promise<ResolvedAct> {
  const response = await fetch('/fetch_norma_data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      act_type: params.act_type,
      act_number: params.act_number || undefined,
      date: params.date || undefined,
      article: '1', // URN probe — see the note above.
    }),
  });

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error);
  }

  // Response shape: `{ norma_data: [{ urn, url, tipo_atto, data, ... }] }`.
  // `urn` identifies the article, `url` the act. The tree endpoint accepts
  // either; prefer `urn`, matching the behaviour this probe has had since it
  // was first written for the dossier tree navigator.
  const record = payload?.norma_data?.[0];
  const urn: string | undefined = record?.urn || record?.url;

  if (!urn) {
    throw new Error('Impossibile generare URN per questa norma');
  }

  return {
    urn,
    norma: {
      tipo_atto: record.tipo_atto ?? params.act_type,
      data: record.data ?? params.date ?? '',
      numero_atto: record.numero_atto ?? params.act_number,
      tipo_atto_reale: record.tipo_atto_reale,
      // Act-level identifier, matching what `processResult` stores on blocks
      // built from a search — the two must agree or they will not merge.
      urn: record.url ?? urn,
    },
  };
}
