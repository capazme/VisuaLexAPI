import { Link } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import { SECTION_TITLES } from '../../../features/sections/sections';
import { PageFrame } from '../../layout/PageFrame';
import { CommunityMark } from './CommunityMark';

/**
 * The Forum's «Community» (`/forum/community`), beside «Dossier pubblici» (`/forum`): an honest placeholder, drawn as
 * an empty state composed for the page (S7a), centred in the column — line art in the manner of the section's mark, «Le
 * discussioni arrivano presto», two lines on what it will be, and one way on, «Esplora i dossier pubblici». Questions and
 * discussions between colleagues come later and need the server; until then the page shows no sample posts and no
 * counts. In the sections' frame (`PageFrame`, W2).
 */
export function ForumCommunityPage() {
  return (
    <PageFrame title={SECTION_TITLES.forum}>
      <section aria-labelledby="forum-community-heading" className="mx-auto flex w-full max-w-md flex-col items-center px-2 py-10 text-center md:py-16">
        <CommunityMark />
        <h2 id="forum-community-heading" className="mt-6 font-serif text-2xl font-medium tracking-tight text-slate-900 dark:text-slate-50">
          Le discussioni arrivano presto
        </h2>
        <p className="mt-3 text-slate-700 dark:text-slate-300">
          Qui farai domande ai colleghi e discuterai le glosse sui passi di norme e sentenze, aperte a tutta la comunità.
        </p>
        <p className="mt-2 text-slate-600 dark:text-slate-400">Per ora il Forum raccoglie i dossier pubblicati dalla comunità.</p>
        <Link
          to="/forum"
          className="mt-8 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
        >
          <FolderOpen size={18} aria-hidden />
          Esplora i dossier pubblici
        </Link>
      </section>
    </PageFrame>
  );
}
