import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../../../lib/utils';
import { connectionsService, type ConnectedApp } from '../../../../features/connections/connectionsService';
import { CopyableCode } from '../../../../features/connections/CopyableCode';
import { BLOCK_HEADING, FOCUS_RING, MUTED_TEXT, SECONDARY_BUTTON, TILE } from '../progress/tokens';
import { COURSES_WRITE_SCOPE, CREATE_SENTENCE } from './corsiLabels';

type Connections = { status: 'loading' } | { status: 'error' } | { status: 'ready'; apps: ConnectedApp[] };

/**
 * «Percorsi» with no course (courses spec §6.3): what a course is and how the assistant creates one from the user's
 * material, with a sentence to copy and the way to «Collega un'app AI». No file is uploaded to VisuaLex, and the page
 * says so. A connection without `lingo:courses:write` is told where permissions are chosen and that one made before the
 * courses existed lacks it, with no promise of what a new connection brings (the MCP asks for the scope from M1; the
 * switch stays off until then).
 */
export function CoursesEmpty() {
  const [connections, setConnections] = useState<Connections>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    connectionsService.listConnectedApps().then(
      (apps) => live && setConnections({ status: 'ready', apps }),
      (error: unknown) => {
        console.warn('[Percorsi] connected apps read failed', error);
        if (live) setConnections({ status: 'error' });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-labelledby="corsi-vuoto" className={cn(TILE, 'grid grid-cols-1 gap-4 p-5 md:p-6')}>
      <h2 id="corsi-vuoto" className={BLOCK_HEADING}>
        Non hai ancora percorsi
      </h2>
      <div className="grid max-w-[65ch] grid-cols-1 gap-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        <p>
          Un percorso è un corso costruito dal tuo materiale: appunti, dispense, ricerche. Lezioni in ordine, un modulo al
          giorno, domande di verifica, schede da ripassare e un esame finale, con le competenze che promette e il momento in
          cui le hai acquisite.
        </p>
        <p>
          Lo crea il tuo assistente AI collegato a VisuaLex: dai a lui i file e digli l’obiettivo. Ti propone un programma, tu
          lo correggi e lo confermi, e lui scrive qui il percorso e il suo dossier di studio.
        </p>
        <p>
          In VisuaLex non si carica nessun file: i materiali li legge il fornitore del tuo assistente, alle sue condizioni.
          VisuaLex conserva solo ciò che l’assistente scrive nel percorso, visibile solo a te.
        </p>
      </div>
      <div className="grid max-w-2xl grid-cols-1 gap-1.5">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Da scrivere al tuo assistente, con i file:</p>
        <CopyableCode code={CREATE_SENTENCE} label="la frase per il tuo assistente" />
      </div>
      <ConnectionLine connections={connections} />
    </section>
  );
}

function ConnectionLine({ connections }: { connections: Connections }) {
  const link = (
    <Link to="/collega-app" className={cn(SECONDARY_BUTTON, 'inline-flex items-center justify-self-start')}>
      Collega un’app AI
    </Link>
  );
  if (connections.status === 'loading') return link;
  if (connections.status === 'error') {
    return (
      <div className="grid grid-cols-1 gap-2">
        <p className={cn('text-sm', MUTED_TEXT)}>Ti serve un’app AI collegata a VisuaLex con il permesso di creare percorsi.</p>
        {link}
      </div>
    );
  }
  const { apps } = connections;
  if (apps.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-2">
        <p className={cn('text-sm', MUTED_TEXT)}>Non hai ancora collegato un’app AI a VisuaLex.</p>
        {link}
      </div>
    );
  }
  const able = apps.filter((app) => app.scopes.includes(COURSES_WRITE_SCOPE)).length;
  if (able > 0) {
    return (
      <p className={cn('text-sm', MUTED_TEXT)}>
        {able === apps.length
          ? apps.length === 1 ? 'La tua app collegata può creare percorsi.' : 'Le tue app collegate possono creare percorsi.'
          : able === 1 ? 'Una delle tue app collegate può creare percorsi.' : `${able} delle tue app collegate possono creare percorsi.`}{' '}
        <Link to="/collega-app" className={cn('-my-3 inline-block py-3 font-medium underline underline-offset-2', FOCUS_RING)}>
          Gestisci le app collegate
        </Link>
      </p>
    );
  }
  return (
    <div role="note" className="grid grid-cols-1 gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <p>
        {apps.length === 1 ? 'La tua app collegata non ha' : 'Le tue app collegate non hanno'} il permesso di creare percorsi
        di studio. I permessi si scelgono quando colleghi un’app, da «Collega un’app AI»: un collegamento fatto prima che
        esistessero i percorsi non lo comprende.
      </p>
      {link}
    </div>
  );
}
