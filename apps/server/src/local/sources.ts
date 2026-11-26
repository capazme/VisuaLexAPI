import { Router, type Request, type Response } from 'express';

/**
 * The sources' routes the web calls with a relative address (the Python API's, which the online ingress serves). In
 * the desktop app's first version none of them reaches the network: they answer that the text needs it, until M3
 * keeps a local copy of the texts read and forwards the rest (spec §6, «What answers where»).
 */
export const NETWORK_COPY = 'Per questo testo serve la rete.';

export const SOURCE_ROUTES = [
  '/fetch_norma_data', '/fetch_article_text', '/stream_article_text', '/fetch_brocardi_info', '/fetch_all_data',
  '/fetch_tree', '/fetch_rubriche', '/fetch_alias_catalog', '/fetch_decision', '/fetch_decision_pdf',
  '/search_decisions', '/search_eu_case_law', '/fetch_rassegne', '/search_rassegne', '/parse_query',
  '/parse_query_batch', '/fetch_norm_links', '/extract_citations', '/export_pdf', '/fetch_recitals', '/health',
];

export function localSources(version: string): Router {
  const router = Router();
  // The settings' technical panel reads `git.branch`: an answer without it throws there.
  router.get('/version', (_req: Request, res: Response) => void res.json({ version, git: { branch: 'local', commit: '' }, changelog: [] }));
  router.use(SOURCE_ROUTES, (_req: Request, res: Response) => void res.status(503).json({ detail: NETWORK_COPY, code: 'network_needed' }));
  return router;
}
