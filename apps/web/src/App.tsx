import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { SearchPage } from './pages/SearchPage';
import { AuthPage } from './pages/AuthPage';
import { ConsentProvider } from './features/merlt/consent/ConsentContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { ConnectPage } from './features/connections/ConnectPage';
import { AdminRoute } from './components/auth/AdminRoute';
import { DecisionAddress } from './components/features/decisions/DecisionAddress';
import { OldAttoRedirect } from './components/features/atti/OldAttoRedirect';
import { isStudiaEnabled } from './features/studia/featureFlag';
import { DevRoute } from './features/devMode/DevRoute';
import { buttonClassName } from './components/ui/buttonStyles';
import { cn } from './lib/utils';
import { PageBoundary } from './components/layout/RouteBoundary';
import { PAGE_CODE } from './pageCode';

// Lazy load admin page + MERL-T surfaces (route-level code splitting)
import { lazy, Suspense, type ReactNode } from 'react';

// The pages loaded with their route (P1, `pageCode.ts`); Ricerca, the sign-in page, a decision's address and «Pagina
// non trovata» stay in the first chunk. They wait in the layout's `RoutePage`, «Crediti» at the root (below): nothing
// in their place, a failure that keeps the app.
const DossierPage = lazy(() => PAGE_CODE.dossier().then(m => ({ default: m.DossierPage })));
const BulletinBoardPage = lazy(() => PAGE_CODE.forum().then(m => ({ default: m.BulletinBoardPage })));
const HistoryView = lazy(() => PAGE_CODE.history().then(m => ({ default: m.HistoryView })));
const ForumCommunityPage = lazy(() => PAGE_CODE.community().then(m => ({ default: m.ForumCommunityPage })));
const DocumentReviewPage = lazy(() => PAGE_CODE.documents().then(m => ({ default: m.DocumentReviewPage })));
const RassegneSearchPage = lazy(() => PAGE_CODE.rassegne().then(m => ({ default: m.RassegneSearchPage })));
const CreditsPage = lazy(() => PAGE_CODE.credits().then(m => ({ default: m.CreditsPage })));
const ConnectAiAppPage = lazy(() => PAGE_CODE.connectAiApp().then(m => ({ default: m.ConnectAiAppPage })));
const OpusPage = lazy(() => PAGE_CODE.opus().then(([m]) => ({ default: m.OpusPage })));
// Loaded with Opus's frame (`PAGE_CODE.opus`): by the time a view renders, its module is there.
const TodayView = lazy(() => PAGE_CODE.opus().then(([, m]) => ({ default: m.TodayView })));
const UpcomingView = lazy(() => PAGE_CODE.opus().then(([, m]) => ({ default: m.UpcomingView })));
const InboxView = lazy(() => PAGE_CODE.opus().then(([, m]) => ({ default: m.InboxView })));
const TaskTrashView = lazy(() => PAGE_CODE.opus().then(([, m]) => ({ default: m.TaskTrashView })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const MerltHubPage = lazy(() =>
  import('./pages/MerltHubPage').then(m => ({ default: m.MerltHubPage })),
);
const GraphExplorerPage = lazy(() =>
  import('./features/merlt/graph/page/GraphExplorerPage').then(m => ({ default: m.GraphExplorerPage })),
);
const ContribPage = lazy(() =>
  import('./features/merlt/contrib/ContribPage').then(m => ({ default: m.ContribPage })),
);
const ValidationPage = lazy(() =>
  import('./features/merlt/validate/ValidationPage').then(m => ({ default: m.ValidationPage })),
);

const StudiaPage = lazy(() =>
  import('./components/features/studia/StudiaPage').then(m => ({ default: m.StudiaPage })),
);
const MyCardsView = lazy(() =>
  import('./components/features/studia/MyCardsView').then(m => ({ default: m.MyCardsView })),
);
const ValidationQueueView = lazy(() =>
  import('./components/features/studia/ValidationQueueView').then(m => ({ default: m.ValidationQueueView })),
);
const ReviewHome = lazy(() =>
  import('./components/features/studia/ReviewHome').then(m => ({ default: m.ReviewHome })),
);
const CoursesView = lazy(() =>
  import('./components/features/studia/corsi/CoursesView').then(m => ({ default: m.CoursesView })),
);
const CoursePage = lazy(() =>
  import('./components/features/studia/corsi/CoursePage').then(m => ({ default: m.CoursePage })),
);
const ModuleSession = lazy(() =>
  import('./components/features/studia/corsi/ModuleSession').then(m => ({ default: m.ModuleSession })),
);
const ExamSession = lazy(() =>
  import('./components/features/studia/corsi/ExamSession').then(m => ({ default: m.ExamSession })),
);
const ProgressPage = lazy(() =>
  import('./components/features/studia/progress/ProgressPage').then(m => ({ default: m.ProgressPage })),
);
// Small and eager: what the lesson's frame shows while the session's code loads.
import { LessonLoading } from './components/features/studia/LessonFrame';
const ReviewSession = lazy(() =>
  import('./components/features/studia/ReviewSession').then(m => ({ default: m.ReviewSession })),
);

/** «Ambienti» went into the Forum (spec 2026-10-13-environments-into-forum, D11c, D13): an old address, and its share
 * link's `?import=`, land there. */
function EnvironmentsRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/forum', search }} replace />;
}

/** The addresses took their sections' names (D-235): an old one — a bookmark, a shared link, a link the server still
 * writes — lands on the new one, keeping the rest of the path, the query (`?import=`) and the anchor. */
function MovedTo({ from, to }: { from: string; to: string }) {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={{ pathname: to + pathname.slice(from.length), search, hash }} replace />;
}

/** A Work entry «in arrivo» (D-315): a few lines under the frame's title (`OpusPage`, from `pageNames.ts`), no feature. */
function ComingSoon({ children }: { children: ReactNode }) {
  return <div className="flex max-w-measure flex-col gap-2 text-sm text-slate-600 dark:text-slate-400">{children}</div>;
}

// Global 404 rendered inside the authenticated layout so the sidebar stays visible.
function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3 p-6 text-center">
      {/* The page's title: the phone's bar names no section over it (M1: it said the one the user came from). */}
      <h1 className="font-serif text-[28px] font-medium leading-tight tracking-tight text-slate-900 md:text-3xl dark:text-slate-50">Pagina non trovata</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        L'indirizzo che hai aperto non esiste o non è più disponibile.
      </p>
      {/* The page's one way on, so a button's look and 44 px at every width (Q1); a link still, since it leads elsewhere. */}
      <Link to="/" className={cn(buttonClassName('primary', 'lg'), 'mt-2')}>
        Torna alla ricerca
      </Link>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      {/* No Suspense around the routes: a page outside the layout loaded with its route («Crediti») suspends the root,
          so opened by its address the splash in `index.html` stays until it is there, and moved to from the app (the
          user menu, the sign-in page) the router's transition keeps the screen it leaves. */}
      <Routes>
        {/* Public routes */}
        {/* Signing in and signing up, one page with two tabs: one parent route, so changing tab
            (which replaces the address) keeps the page mounted and animates. */}
        <Route element={<AuthPage />}>
          <Route path="/login" element={null} />
          <Route path="/register" element={null} />
        </Route>
        {/* The sources and their licences: public, so an attribution reads without an account. */}
        <Route path="/crediti" element={<PageBoundary><CreditsPage /></PageBoundary>} />
        {/* The OAuth consent page (MCP spike): signed in, outside the app layout. */}
        <Route
          path="/connect"
          element={
            <ProtectedRoute>
              <ConnectPage />
            </ProtectedRoute>
          }
        />

        {/* Protected app routes with layout */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ConsentProvider>
                <Layout />
              </ConsentProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<SearchPage />} />
          <Route path="pratiche" element={<DossierPage />} />
          {/* Work's planner (Opus, wave 1): «Scadenziario» is the section's home; «Pratiche» is at /pratiche (LC60). */}
          <Route path="work" element={<OpusPage />}>
            <Route index element={<Navigate to="scadenziario" replace />} />
            <Route path="scadenziario" element={<TodayView />} />
            <Route path="prossimi" element={<UpcomingView />} />
            <Route path="ingresso" element={<InboxView />} />
            <Route path="cestino" element={<TaskTrashView />} />
            {/* D-324: the desktop app's; announced in Work (LC47). */}
            <Route path="pseudonimizzatore" element={<ComingSoon>
              <p className="text-xs font-medium">in arrivo</p>
              <p>Arriverà con l'app da scrivania di LexCraft.</p>
              <p>Prima che un atto entri in una pratica, toglierà i nomi di persone e società e li sostituirà con etichette: all'IA arriveranno meno dati personali e meno informazioni riservate.</p>
              <p>Funzionerà tutto sul tuo computer: il documento originale non uscirà mai.</p>
              <p>I dati con le etichette restano dati personali per il GDPR: lo Pseudonimizzatore riduce il rischio, non sostituisce le altre cautele.</p>
            </ComingSoon>} />
            {/* The knowledge graph of the user's practices, the desktop app's too; announced in Work (LC48). */}
            <Route path="grafo-pratiche" element={<ComingSoon>
              <p className="text-xs font-medium">in arrivo</p>
              <p>Arriverà con l'app da scrivania di LexCraft.</p>
              <p>Mostrerà come le tue pratiche si collegano attraverso le norme, le sentenze e le massime che usi: per esempio, in quali pratiche hai già citato un articolo e con quali argomenti.</p>
              <p>Lo vedrai solo tu, e collegherà le pratiche attraverso le fonti, non attraverso i nomi dei clienti.</p>
            </ComingSoon>} />
          </Route>
          {/* LC53: the act editor is gone; its addresses lead to the act's dossier («Atti» tab), else to the dossiers. */}
          <Route path="work/atti" element={<Navigate to="/pratiche" replace />} />
          <Route path="work/atti/:id" element={<OldAttoRedirect />} />
          <Route path="history" element={<HistoryView />} />
          <Route path="environments" element={<EnvironmentsRedirect />} />
          {/* The Forum's two areas: «Dossier pubblici» at its old address, «Community» with one discussion at its own. */}
          <Route path="forum" element={<BulletinBoardPage />} />
          <Route path="forum/community" element={<ForumCommunityPage />} />
          <Route path="forum/community/:threadId" element={<ForumCommunityPage />} />
          <Route path="documents" element={<DocumentReviewPage />} />
          <Route path="rassegne" element={<RassegneSearchPage />} />
          {/* How to connect an AI application through MCP, and the connected ones (user menu). */}
          <Route path="collega-app" element={<ConnectAiAppPage />} />
          {/* The old addresses (D-235): no guard of their own, the new address keeps it. The more specific first:
              /merlt/qa and /merlt/chiedi go to the graph. */}
          <Route path="opus/*" element={<MovedTo from="/opus" to="/work" />} />
          {/* LC48: Work's «Oggi» is «Scadenziario», the «Anonimizzatore» the «Pseudonimizzatore». */}
          <Route path="work/oggi/*" element={<MovedTo from="/work/oggi" to="/work/scadenziario" />} />
          <Route path="work/anonimizzatore/*" element={<MovedTo from="/work/anonimizzatore" to="/work/pseudonimizzatore" />} />
          <Route path="studia/*" element={<MovedTo from="/studia" to="/learn" />} />
          <Route path="merlt/qa" element={<MovedTo from="/merlt/qa" to="/labs/grafo" />} />
          <Route path="merlt/chiedi" element={<MovedTo from="/merlt/chiedi" to="/labs/grafo" />} />
          <Route path="merlt/*" element={<MovedTo from="/merlt" to="/labs" />} />
          <Route path="grafo/*" element={<MovedTo from="/grafo" to="/labs/grafo" />} />
          {/* LC60: «Dossier» is «Pratiche»; a dossier's link keeps its query (`?dossier=`, `vista`) and its anchor. */}
          <Route path="dossier/*" element={<MovedTo from="/dossier" to="/pratiche" />} />
          {/* The MERL-T pages are development addresses (spec D6): without the development mode they
              lead to «/». The server's guards (consent, validators, admins) stay the real barrier. */}
          <Route
            path="labs"
            element={
              <DevRoute>
                <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                  <MerltHubPage />
                </Suspense>
              </DevRoute>
            }
          />
          <Route
            path="labs/contribuisci"
            element={
              <DevRoute>
                <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                  <ContribPage />
                </Suspense>
              </DevRoute>
            }
          />
          <Route
            path="labs/valida"
            element={
              <DevRoute>
                <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                  <ValidationPage />
                </Suspense>
              </DevRoute>
            }
          />
          {/* Slice 4 absorb (Decision A): the Q&A page is gone — the graph is the SOLE deliberation surface; the old
              ask addresses (/merlt/qa, /merlt/chiedi) lead here, above. */}
          <Route
            path="labs/grafo"
            element={
              <DevRoute>
                <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                  <GraphExplorerPage />
                </Suspense>
              </DevRoute>
            }
          />
          {/* Learn (VisuaLex Studia): behind VITE_FEATURE_STUDIA; /learn opens the review; percorsi the courses; progressi the data; valida is the validators' queue. */}
          {isStudiaEnabled() && (
            <Route
              path="learn"
              element={
                <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                  <StudiaPage />
                </Suspense>
              }
            >
              <Route index element={<Navigate to="ripasso" replace />} />
              <Route path="ripasso" element={<Suspense fallback={null}><ReviewHome /></Suspense>} />
              <Route path="ripasso/sessione" element={<Suspense fallback={<LessonLoading />}><ReviewSession /></Suspense>} />
              {/* «Percorsi» (courses spec §6): drawn only while the switch `lingo_courses` is on, else back to Oggi. */}
              <Route path="percorsi" element={<Suspense fallback={null}><CoursesView /></Suspense>} />
              <Route path="percorsi/:id" element={<Suspense fallback={null}><CoursePage /></Suspense>} />
              {/* A module's session (courses spec §6.5), the lesson's frame as the review's. */}
              <Route path="percorsi/:id/moduli/:moduloId" element={<Suspense fallback={<LessonLoading />}><ModuleSession /></Suspense>} />
              {/* The course's final exam (LC9), in the same frame. */}
              <Route path="percorsi/:id/esami/:esameId" element={<Suspense fallback={<LessonLoading />}><ExamSession /></Suspense>} />
              <Route path="progressi" element={<Suspense fallback={null}><ProgressPage /></Suspense>} />
              <Route path="schede" element={<Suspense fallback={null}><MyCardsView /></Suspense>} />
              <Route path="schede/:id" element={<Suspense fallback={null}><MyCardsView /></Suspense>} />
              <Route path="valida" element={<Suspense fallback={null}><ValidationQueueView /></Suspense>} />
            </Route>
          )}
          <Route path="sentenze" element={<DecisionAddress />} />
          <Route path="sentenze/:corte/:numero/:anno" element={<DecisionAddress />} />
          {/* Global 404 catch-all (inside the layout: sidebar stays visible) */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* Admin routes */}
        <Route
          path="/admin/*"
          element={
            <AdminRoute>
              <Suspense fallback={<div className="flex items-center justify-center min-h-svh">Caricamento...</div>}>
                <AdminPage />
              </Suspense>
            </AdminRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
