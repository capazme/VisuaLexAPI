import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/Button';
import { useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { FIELD_TEXT } from '../../../../constants/interactions';
import { corsiErrorDetail, corsiService, isNotFound } from '../../../../services/corsiService';
import { loadAssistantFeatures } from '../../../../store/assistantProposals';
import type { Chiave, DomandaEsame, DomandaModulo, ProvaEsame } from '../../../../types/corsi';
import { WireConfirm } from '../../../ui/wireConfirm/WireConfirm';
import { LessonBar } from '../GradeBar';
import { LessonLoading } from '../LessonFrame';
import { BLOCK_HEADING, FOCUS_RING, MUTED_TEXT, SUCCESS_TEXT, TILE } from '../progress/tokens';
import { CoursesGate } from './CoursesGate';
import { coursePath, fromDay, onDay } from './corsiLabels';
import { useCoursesSwitch } from './coursesSwitch';
import { RecallQuestion } from './RecallStep';

/** The exam's column, as the module's. */
const COLUMN = 'mx-auto w-full max-w-3xl';
const TITLE = 'break-words font-serif text-2xl font-medium tracking-tight text-slate-900 focus:outline-none md:text-3xl dark:text-slate-50';
const TEXT = 'max-w-measure text-base leading-relaxed text-slate-700 dark:text-slate-300';

/** An exam item as `RecallQuestion` draws it: graded once the attempt is handed in (the item's type is not read there). */
const asQuestion = (d: DomandaEsame): DomandaModulo => ({
  id: d.id,
  tipo: 'QUIZ',
  ordine: d.ordine,
  applicazione: d.applicazione,
  testo: d.testo,
  competenze: d.competenze,
  opzioni: d.opzioni ?? [],
  risposta: d.esito && d.corretta ? { scelta: d.esito.scelta, corretto: d.esito.corretto === true, corretta: d.corretta, segnalata: d.esito.segnalata } : null,
});

/** The server's words on a 4xx, else the fallback; a 404 may be the switch turned off: the gate reads it again. */
function failure(error: unknown, fallback: string): string {
  console.warn('[Percorsi] exam write failed', error);
  if (isNotFound(error)) void loadAssistantFeatures();
  const status = (error as { status?: number } | null)?.status ?? 0;
  return status >= 400 && status < 500 ? corsiErrorDetail(error, fallback) : fallback;
}

/**
 * The course's final exam (`/learn/percorsi/:id/esami/:esameId`, LC9; courses spec §4, §10.4), in `LessonFrame` as a
 * module's session: its rules and «Inizia la prova» (`POST …/inizia`, which answers the same attempt when it was started
 * before, its result once handed in), every question on one page, the hand-in (`POST …/consegna`, every choice at once;
 * the opinion written never leaves the browser), then the result with the graded answers and the opinion's rubric to
 * tick (`POST …/aperta`, never scored). Behind the switch `lingo_courses`, as every page of «Percorsi».
 */
export function ExamSession() {
  const { id = '', esameId = '' } = useParams();
  const on = useCoursesSwitch() === 'on';
  if (!on) {
    return (
      <LessonLoading>
        <CoursesGate>{null}</CoursesGate>
      </LessonLoading>
    );
  }
  return <Exam key={`${id}/${esameId}`} id={id} esameId={esameId} />;
}

function Exam({ id, esameId }: { id: string; esameId: string }) {
  const navigate = useNavigate();
  const [prova, setProva] = useState<ProvaEsame | null>(null);
  // The choices and the opinion live on screen only: a hand-in that fails keeps them, a reload does not.
  const [scelte, setScelte] = useState<Record<string, Chiave>>({});
  const [parere, setParere] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'consegna' | 'esci'; origin: HTMLElement | null } | null>(null);
  // Whether the attempt was started before, from the course page's exam state; null while that read travels,
  // 'unread' when it failed: the page cannot tell «Inizia» from a handed-in exam then (#458).
  const [started, setStarted] = useState<boolean | null | 'unread'>(null);
  const [reads, setReads] = useState(0);
  // The course page gives the focus back to the exam's command it was entered from (LC12).
  const back = () => navigate(coursePath(id), { state: { focus: 'esame' } });

  const phase = !prova ? 'inizio' : prova.tentativo.consegnatoIl ? 'esito' : 'domande';
  const graded = prova?.domande.filter((d) => d.tipo === 'ESAME') ?? [];
  const opinion = prova?.domande.find((d) => d.tipo === 'ESAME_APERTA');
  const answered = graded.filter((d) => scelte[d.id]).length;
  const dirty = phase === 'domande' && (answered > 0 || parere.trim() !== '');

  // Each phase opens with its heading focused, so a screen reader hears where it is.
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => heading.current?.focus({ preventScroll: true }), [phase, started]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const leave = (origin: HTMLElement | null) => (dirty ? setConfirm({ kind: 'esci', origin }) : back());
  const escape = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    escape.current = () => leave(null);
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"], [data-find-overlay]')) return;
      event.preventDefault();
      escape.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setProva(await corsiService.startExam(id, esameId));
    } catch (error) {
      setProblem(failure(error, 'Non riesco a iniziare la prova: riprova.'));
    } finally {
      setBusy(false);
    }
  };

  // The address follows the state: the rules with «Inizia» or «Riprendi la prova», or straight the result once handed in
  // (`inizia` answers it then, writing nothing). A failed read says so, with «Riprova» in place of the command.
  useEffect(() => {
    let live = true;
    corsiService.get(id).then(
      async ({ esame }) => {
        const mine = esame.esameId === esameId;
        if (mine && (esame.stato === 'superato' || esame.stato === 'non-superato')) await start();
        if (live) setStarted(mine && esame.stato === 'in-corso');
      },
      () => live && setStarted('unread'),
    );
    return () => {
      live = false;
    };
    // Read once per exam and per «Riprova»: `Exam` is keyed by course and exam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reads]);

  const handIn = async () => {
    setConfirm(null);
    setBusy(true);
    setProblem(null);
    try {
      const risposte = graded.filter((d) => scelte[d.id]).map((d) => ({ domandaId: d.id, scelta: scelte[d.id] }));
      setProva(await corsiService.handInExam(id, esameId, risposte));
    } catch (error) {
      setProblem(`Non consegnato: ${failure(error, 'riprova.')}`);
    } finally {
      setBusy(false);
    }
  };

  const missing = graded.length - answered;
  let middle: React.ReactNode;
  let bar: React.ReactNode;
  let line = 'Esame finale';

  if (phase === 'inizio' && started === null) {
    middle = null;
  } else if (phase === 'inizio' && started === 'unread') {
    middle = (
      <div className={cn(COLUMN, 'px-4 py-8')}>
        <h1 ref={heading} tabIndex={-1} role="alert" className="font-serif text-xl leading-snug text-red-700 focus:outline-none dark:text-red-400">
          Non riesco a leggere lo stato dell’esame.
        </h1>
      </div>
    );
    bar = (
      <Button
        type="button"
        size="lg"
        onClick={() => {
          setStarted(null);
          setReads((n) => n + 1);
        }}
        className="w-full gap-3"
      >
        Riprova
      </Button>
    );
  } else if (phase === 'inizio') {
    middle = (
      <div className={cn(COLUMN, 'grid grid-cols-1 gap-5 px-4 pb-10 pt-4 md:pt-8')}>
        <h1 ref={heading} tabIndex={-1} className={TITLE}>
          Esame finale
        </h1>
        <ul className={cn(TEXT, 'grid list-disc grid-cols-1 gap-2 pl-5')}>
          <li>Per superarlo serve il 70% in tutto e almeno il 60% su ogni competenza.</li>
          <li>Le risposte partono tutte insieme quando consegni; una domanda senza risposta conta come sbagliata.</li>
          <li>C’è un solo tentativo: una volta consegnato, l’esito resta. Non c’è un limite di tempo.</li>
          <li>Se esci prima di consegnare, la prova resta iniziata e la riprendi da qui, ma le scelte fatte vanno perse.</li>
        </ul>
      </div>
    );
    bar = (
      <Button type="button" size="lg" onClick={() => void start()} disabled={busy} aria-busy={busy || undefined} className="w-full gap-3">
        {busy ? 'Inizio la prova…' : started ? 'Riprendi la prova' : 'Inizia la prova'}
      </Button>
    );
  } else if (phase === 'domande') {
    line = `Esame finale · ${answered} di ${graded.length} risposte`;
    middle = (
      <div className={cn(COLUMN, 'grid grid-cols-1 gap-6 px-4 pb-10 pt-4 md:pt-8')}>
        <div className="grid grid-cols-1 gap-2">
          <h1 ref={heading} tabIndex={-1} className={TITLE}>
            Le domande
          </h1>
          <p className={TEXT}>Scegli una risposta per ogni domanda, poi consegna.</p>
        </div>
        <ol className="grid grid-cols-1 gap-6">
          {graded.map((d, i) => (
            <li key={d.id}>
              <RecallQuestion
                domanda={asQuestion(d)}
                numero={i + 1}
                totale={graded.length}
                chosen={scelte[d.id] ?? null}
                onChoose={(scelta) => setScelte((s) => ({ ...s, [d.id]: scelta }))}
              />
            </li>
          ))}
        </ol>
        {opinion && <OpinionField testo={opinion.testo} value={parere} onChange={setParere} />}
      </div>
    );
    bar = (
      <Button
        type="button"
        size="lg"
        disabled={busy}
        aria-busy={busy || undefined}
        // One attempt, no way back: the hand-in always asks first (LC12).
        onClick={(event) => setConfirm({ kind: 'consegna', origin: event.currentTarget })}
        className="w-full gap-3"
      >
        {busy ? 'Consegno…' : 'Consegna'}
      </Button>
    );
  } else if (prova) {
    middle = <ExamResult id={id} esameId={esameId} prova={prova} parere={parere} headingRef={heading} />;
    bar = (
      <Button type="button" size="lg" className="w-full gap-3" onClick={back}>
        Torna al percorso
      </Button>
    );
  }

  return (
    <section aria-label="Esame finale" className="flex h-full min-h-0 flex-1 flex-col">
      <header className="shrink-0 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className={cn(COLUMN, 'flex items-center gap-3')}>
          <Button type="button" variant="quiet" size="lg" onClick={(event) => leave(event.currentTarget)} aria-label="Chiudi la prova" icon={<X size={20} aria-hidden />} className="min-w-11 shrink-0 px-2 text-sm">
            <span aria-hidden className="hidden md:inline">
              Chiudi
            </span>
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{line}</p>
        </div>
      </header>
      <div key={phase} className="min-h-0 flex-1 overflow-y-auto">
        {middle}
      </div>
      <LessonBar
        status={
          problem && (
            <span role="alert" className="text-red-700 dark:text-red-400">
              {problem}
            </span>
          )
        }
      >
        {bar}
      </LessonBar>
      <WireConfirm
        open={confirm !== null}
        title={confirm?.kind === 'consegna' ? 'Consegni la prova?' : 'Esci dalla prova?'}
        message={
          confirm?.kind === 'consegna'
            ? `${missing === 0 ? '' : missing === 1 ? '1 domanda è senza risposta: conta come sbagliata. ' : `${missing} domande sono senza risposta: contano come sbagliate. `}Dopo la consegna non si torna indietro.`
            : 'La prova resta iniziata e la riprendi dal percorso, ma le scelte fatte e il parere scritto vanno persi.'
        }
        confirmLabel={confirm?.kind === 'consegna' ? (missing === 0 ? 'Consegna' : 'Consegna lo stesso') : 'Esci'}
        cancelLabel="Continua la prova"
        emphasis="cancel"
        origin={confirm?.origin ?? null}
        focusBack={() => heading.current}
        onConfirm={() => (confirm?.kind === 'consegna' ? void handIn() : back())}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}

function OpinionField({ testo, value, onChange }: { testo: string; value: string; onChange: (v: string) => void }) {
  const fieldId = useId();
  return (
    <section aria-labelledby={`${fieldId}-titolo`} className={cn(TILE, 'grid grid-cols-1 gap-2 p-4 md:p-5')}>
      <h2 id={`${fieldId}-titolo`} className={BLOCK_HEADING}>
        Il parere
      </h2>
      <label htmlFor={fieldId} className="break-words font-serif text-lg leading-snug text-slate-900 dark:text-slate-50">
        {testo}
      </label>
      <textarea
        id={fieldId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        className={cn(
          'min-h-[44px] w-full resize-y rounded-md border border-slate-300 bg-card p-3 leading-relaxed text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
          FIELD_TEXT,
          FOCUS_RING,
        )}
      />
      <p className={cn('text-sm', MUTED_TEXT)}>Non viene inviato e non dà punteggio: dopo la consegna lo confronti con la risposta modello.</p>
    </section>
  );
}

function ExamResult({ id, esameId, prova, parere, headingRef }: {
  id: string;
  esameId: string;
  prova: ProvaEsame;
  parere: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const { tentativo } = prova;
  const graded = prova.domande.filter((d) => d.tipo === 'ESAME');
  const opinion = prova.domande.find((d) => d.tipo === 'ESAME_APERTA');
  return (
    <div className={cn(COLUMN, 'grid grid-cols-1 gap-8 px-4 pb-10 pt-4 md:pt-8')}>
      <div className="grid grid-cols-1 gap-2">
        <p className={cn('text-sm font-medium', MUTED_TEXT)}>Esame finale{tentativo.giorno ? ` · consegnato ${onDay(tentativo.giorno)}` : ''}</p>
        <h1 ref={headingRef} tabIndex={-1} className={TITLE}>
          {tentativo.superato ? 'Esame superato' : 'Esame non superato'}
        </h1>
        {tentativo.percentuale !== null && (
          <p className={TEXT}>{tentativo.percentuale}% in tutto: servono il 70% in tutto e il 60% su ogni competenza.</p>
        )}
        {prova.perCompetenza && prova.perCompetenza.length > 0 && (
          <ul className="grid grid-cols-1 gap-1 text-sm">
            {prova.perCompetenza.map((c) => (
              <li key={c.codice} className={c.superata ? SUCCESS_TEXT : 'font-semibold text-amber-800 dark:text-amber-300'}>
                {c.codice} · {c.percentuale}%{c.superata ? '' : ', sotto il 60%'}
              </li>
            ))}
          </ul>
        )}
        {prova.nuovoEsameDal && <p className={TEXT}>Un nuovo esame si può chiedere al tuo assistente {fromDay(prova.nuovoEsameDal)}.</p>}
      </div>
      <section aria-labelledby="esame-risposte" className="grid grid-cols-1 gap-4">
        <h2 id="esame-risposte" className={BLOCK_HEADING}>
          Le risposte
        </h2>
        <ol className="grid grid-cols-1 gap-6">
          {graded.map((d, i) => (
            <li key={d.id}>
              <RecallQuestion domanda={asQuestion(d)} numero={i + 1} totale={graded.length} />
            </li>
          ))}
        </ol>
      </section>
      {opinion && <OpinionReview id={id} esameId={esameId} opinion={opinion} parere={parere} spuntate={prova.aperta?.spuntate ?? []} />}
    </div>
  );
}

/** The opinion after the hand-in: what was written (this page only), the model answer, the rubric to tick (never scored). */
function OpinionReview({ id, esameId, opinion, parere, spuntate }: { id: string; esameId: string; opinion: DomandaEsame; parere: string; spuntate: number[] }) {
  const [ticks, setTicks] = useState<number[]>(spuntate);
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'failed'>('idle');
  const rubric = opinion.rubrica ?? [];
  const toggle = (i: number) => {
    setState('idle');
    setTicks((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i].sort((a, b) => a - b)));
  };
  const save = async () => {
    setState('busy');
    try {
      const stored = await corsiService.tickExamOpinion(id, esameId, ticks);
      setTicks(stored.spuntate);
      setState('saved');
    } catch (error) {
      console.warn('[Percorsi] exam rubric failed', error);
      setState('failed');
    }
  };
  return (
    <section aria-labelledby="esame-parere" className="grid grid-cols-1 gap-4">
      <h2 id="esame-parere" className={BLOCK_HEADING}>
        Il parere
      </h2>
      <p className="break-words font-serif text-lg leading-snug text-slate-900 dark:text-slate-50">{opinion.testo}</p>
      <div className={cn(TILE, 'grid grid-cols-1 gap-2 p-4')}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Quello che hai scritto</h3>
        {parere.trim() === '' ? (
          <p className={cn('text-sm', MUTED_TEXT)}>Non hai scritto il parere in questa pagina.</p>
        ) : (
          <p className="whitespace-pre-wrap break-words font-serif text-base leading-relaxed text-slate-900 dark:text-slate-100">{parere}</p>
        )}
      </div>
      {opinion.rispostaModello && (
        <div className={cn(TILE, 'grid grid-cols-1 gap-2 p-4')}>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">La risposta modello</h3>
          <p className="whitespace-pre-wrap break-words font-serif text-base leading-relaxed text-slate-900 dark:text-slate-100">{opinion.rispostaModello}</p>
        </div>
      )}
      {rubric.length > 0 && (
        <fieldset className={cn(TILE, 'grid min-w-0 grid-cols-1 gap-2 p-4')}>
          <legend className="px-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Che cosa c’era nel tuo parere</legend>
          {rubric.map((criterio, i) => (
            <label key={i} className="grid min-h-[44px] cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-base text-slate-900 dark:text-slate-100">
              {/* bare-input: a checkbox, which has no common component; the row is its label. */}
              <input
                type="checkbox"
                checked={ticks.includes(i)}
                onChange={() => toggle(i)}
                className={cn('h-5 w-5 accent-primary-800 dark:accent-primary-300', FOCUS_RING)}
              />
              <span className="break-words">{criterio}</span>
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="button" size="lg" onClick={() => void save()} disabled={state === 'busy'} aria-busy={state === 'busy' || undefined}>
              Salva l’autovalutazione
            </Button>
            <p role="status" className={cn('text-sm font-medium', state === 'failed' ? 'text-red-700 dark:text-red-400' : SUCCESS_TEXT)}>
              {state === 'saved' ? 'Autovalutazione salvata.' : state === 'failed' ? 'Non registrata: riprova.' : ''}
            </p>
          </div>
          <p className={cn('text-sm', MUTED_TEXT)}>Serve solo a te: non cambia l’esito.</p>
        </fieldset>
      )}
    </section>
  );
}
