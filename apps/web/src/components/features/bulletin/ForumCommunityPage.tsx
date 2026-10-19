import { Link } from 'react-router-dom';
import { FolderOpen, MessagesSquare } from 'lucide-react';
import { SECTION_TITLES } from '../../../features/sections/sections';

/**
 * The Forum's «Community» (`/forum/community`), beside «Dossier pubblici» (`/forum`): an honest placeholder.
 * Questions and discussions between colleagues come later and need the server; until then the page says
 * so, with no sample posts and no counts, and points to what the Forum already holds.
 */
export function ForumCommunityPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="border-b border-slate-200 pb-3 dark:border-slate-800">
        <h1 className="font-serif text-3xl font-medium tracking-tight text-slate-900 dark:text-slate-50">{SECTION_TITLES.forum}</h1>
      </header>
      <section aria-labelledby="forum-community-heading" className="max-w-prose">
        <h2 id="forum-community-heading" className="flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
          <MessagesSquare size={22} aria-hidden className="shrink-0 text-primary-600 dark:text-primary-400" />
          Community
        </h2>
        <p className="mt-2 text-slate-700 dark:text-slate-300">Domande e discussioni tra colleghi, in arrivo.</p>
        <p className="mt-1 text-slate-600 dark:text-slate-400">Per ora il Forum raccoglie i dossier pubblicati dalla comunità.</p>
        <Link
          to="/forum"
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 -mx-3 font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <FolderOpen size={18} aria-hidden />
          Apri i dossier pubblici
        </Link>
      </section>
    </div>
  );
}
