import { useRef, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { LexCraftLogo } from '../../components/ui/LexCraftLogo';
import { Illustration, type IllustrationName } from '../../components/ui/Illustration';
import { focusSearchFieldOrPalette, PALETTE_SHORTCUT } from '../../utils/searchFieldControl';
import { closeWelcomeGuide, useWelcomeGuideOpen } from './welcomeGuideStore';

const SECTIONS: { name: string; line: string; plate: IllustrationName }[] = [
  { name: 'Work', line: 'Cerchi le norme, le tieni nelle pratiche, scrivi gli atti.', plate: 'dossier-vuoti' },
  { name: 'Learn', line: 'Ripassi ogni giorno le schede, materia per materia.', plate: 'learn-ripasso' },
  { name: 'Forum', line: 'Discuti norme e sentenze, pubblichi le fonti delle tue pratiche.', plate: 'forum-vuoto' },
];

const EXAMPLES = ['Art. 2043 c.c.', 'Art. 5 GDPR', 'Art. 1 Costituzione'];

const TITLE_ID = 'welcome-guide-title';

/**
 * The first visit's guide: two pages in place of the eleven popover tours. The first says what LexCraft is and its three
 * sections, each with its engraving; the second asks for the first real action, a norm to open. Closing it any way marks
 * it seen; Settings → «Rivedi la guida iniziale» opens it again.
 */
export function WelcomeGuide() {
  const open = useWelcomeGuideOpen();
  const [page, setPage] = useState<0 | 1>(0);
  const title = useRef<HTMLHeadingElement>(null);

  // Closed any way, it opens again on the first page; a page turned by a button puts the reader on its title.
  const close = () => {
    setPage(0);
    closeWelcomeGuide();
  };
  const turn = (next: 0 | 1) => {
    setPage(next);
    requestAnimationFrame(() => title.current?.focus({ preventScroll: true }));
  };

  const search = (text?: string) => {
    close();
    // After the dialog has given the focus back, or it would take it from the field.
    setTimeout(() => focusSearchFieldOrPalette(text), 0);
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      labelledBy={TITLE_ID}
      showCloseButton={false}
      phoneFullScreen
      initialFocusRef={title}
      contentClassName="p-0"
    >
      <div className="flex min-h-full flex-col px-6 pb-6 pt-8 sm:min-h-[480px] sm:px-8">
        {page === 0 ? (
          <>
            <LexCraftLogo className="h-auto w-[180px]" />
            <p className="mt-1.5 font-serif text-[17px] italic text-slate-600 dark:text-slate-300">La legge è ancora uguale per tutti</p>
            <h2 id={TITLE_ID} ref={title} tabIndex={-1} className="mt-8 font-serif text-[26px] leading-tight text-slate-900 focus:outline-none dark:text-slate-50">
              Le norme, le sentenze e il tuo lavoro sopra.
            </h2>
            <ul className="mt-6 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {SECTIONS.map(({ name, line, plate }) => (
                <li key={name} className="flex items-center gap-4 py-3">
                  <Illustration name={plate} className="h-11 w-11" />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-50">{name}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{line}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2 id={TITLE_ID} ref={title} tabIndex={-1} className="font-serif text-[26px] leading-tight text-slate-900 focus:outline-none dark:text-slate-50">
              Comincia da una norma.
            </h2>
            <p className="mt-3 text-slate-700 dark:text-slate-300">
              Scrivila come la citeresti in un atto: LexCraft la trova alla fonte e te la apre.
            </p>
            <div role="group" aria-label="Esempi" className="mt-5 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => search(example)}
                  className="min-h-[44px] rounded-full bg-ink-200/70 px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-ink-300/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-ink-800 dark:text-slate-100 dark:hover:bg-ink-700"
                >
                  {example}
                </button>
              ))}
            </div>
            <p className="mt-6 text-sm text-slate-600 dark:text-slate-400 [@media(pointer:coarse)]:hidden">
              Da qualunque pagina,{' '}
              <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs dark:border-slate-700">{PALETTE_SHORTCUT}</kbd>{' '}
              apre la ricerca.
            </p>
          </>
        )}

        <div className="mt-auto flex items-center gap-3 pt-8">
          <span className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">{page + 1} di 2</span>
          <div className="ml-auto flex gap-2">
            {page === 0 ? (
              <>
                <Button variant="quiet" onClick={close}>Salta</Button>
                <Button onClick={() => turn(1)}>Avanti</Button>
              </>
            ) : (
              <>
                <Button variant="quiet" onClick={() => turn(0)}>Indietro</Button>
                <Button onClick={() => search()}>Scrivi una norma</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
