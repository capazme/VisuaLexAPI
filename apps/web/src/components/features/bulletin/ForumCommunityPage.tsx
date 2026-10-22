import { Link } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import { PageFrame } from '../../layout/PageFrame';

/**
 * The Forum's «Community» (`/forum/community`), beside «Dossier pubblici» (`/forum`): an honest placeholder.
 * Questions and discussions between colleagues come later and need the server; until then the page says
 * so, with no sample posts and no counts, and points to what the Forum already holds. In the sections' frame
 * (`PageFrame`, W2), its text at a reading measure.
 */
export function ForumCommunityPage() {
  return (
    <PageFrame title="Community" kicker="forum">
      {/* The title names the page (L-37): no second «Community» under it. */}
      <section className="max-w-prose">
        <p className="text-slate-700 dark:text-slate-300">Domande e discussioni tra colleghi, in arrivo.</p>
        <p className="mt-1 text-slate-600 dark:text-slate-400">Per ora il Forum raccoglie i dossier pubblicati dalla comunità.</p>
        <Link
          to="/forum"
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 -mx-3 font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <FolderOpen size={18} aria-hidden />
          Apri i dossier pubblici
        </Link>
      </section>
    </PageFrame>
  );
}
