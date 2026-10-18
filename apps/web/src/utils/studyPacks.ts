import type { Dossier, DossierItem, Environment, EnvironmentCategory, QuickNorm } from '../types';
import { exampleEnvironments } from '../data/exampleEnvironments';

/**
 * The ready-made study dossiers (spec 2026-10-13-environments-into-forum, D12; the owner's answer 188): each of the
 * 20 example packs of `data/exampleEnvironments.ts` gives its 2–4 dossiers as dossiers di studio, plus one more,
 * «‹pack›: articoli chiave», with the pack's quick-norm articles that none of them holds. No quick norm is created.
 * The packs' data stays where it is; this module reads it as packs.
 */
export interface StudyPack {
  /** Stable across loads (the data's ids are random): the pack's name. */
  key: string;
  name: string;
  description: string;
  category: EnvironmentCategory;
  dossiers: Dossier[];
}

type ArticleRef = { tipo_atto: string; numero_atto: string; data: string; numero_articolo: string };

const refKey = (r: ArticleRef) =>
  [r.tipo_atto.toLowerCase(), r.numero_atto, r.data, r.numero_articolo.toLowerCase().replace(/\s+/g, ' ')].join('|');

function quickNormRef(q: QuickNorm): ArticleRef {
  return {
    tipo_atto: q.searchParams.act_type,
    numero_atto: q.searchParams.act_number ?? '',
    data: q.searchParams.date ?? '',
    numero_articolo: q.searchParams.article,
  };
}

function keyArticles(env: Environment): Dossier | null {
  const held = new Set(env.dossiers.flatMap((d) => d.items.flatMap((i) => (i.type === 'norma' ? [refKey(i.data as ArticleRef)] : []))));
  const items: DossierItem[] = [];
  for (const q of env.quickNorms) {
    const ref = quickNormRef(q);
    const key = refKey(ref);
    if (held.has(key)) continue;
    held.add(key);
    items.push({ id: `${q.id}-k`, type: 'norma', data: ref, addedAt: q.createdAt } as DossierItem);
  }
  if (items.length === 0) return null;
  return {
    id: `${env.id}-key`,
    title: `${env.name}: articoli chiave`,
    description: `Gli altri articoli di riferimento di «${env.name}».`,
    createdAt: env.createdAt,
    items,
    tags: env.tags ?? [],
  };
}

export function packFromEnvironment(env: Environment): StudyPack {
  const extra = keyArticles(env);
  return {
    key: env.name,
    name: env.name,
    description: env.description ?? '',
    category: env.category ?? 'other',
    dossiers: extra ? [...env.dossiers, extra] : env.dossiers,
  };
}

export const STUDY_PACKS: StudyPack[] = exampleEnvironments.map(packFromEnvironment);

/** What `POST /dossiers/import-study` takes for a pack: its dossiers, nothing else. */
export function packContent(pack: StudyPack) {
  return { dossiers: pack.dossiers, quickNorms: [], annotations: [], highlights: [] };
}

/** A pack is already among the user's dossiers when a dossier di studio holds the name of each of its dossiers. */
export function packAlreadyAdded(pack: StudyPack, dossiers: Array<Pick<Dossier, 'title' | 'kind'>>): boolean {
  const names = new Set(dossiers.filter((d) => d.kind === 'studio').map((d) => d.title));
  return pack.dossiers.every((d) => names.has(d.title));
}
