import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { SearchPage } from './pages/SearchPage';
import { AuthPage } from './pages/AuthPage';
// In the first chunk (P1, measured): opened directly, Dossier and the Forum's «Dossier pubblici» drew their largest
// text later when their code came after it, even with that code preloaded beside it.
import { DossierPage } from './components/features/dossier/DossierPage';
import { BulletinBoardPage } from './components/features/bulletin/BulletinBoardPage';
import { ConsentProvider } from './features/merlt/consent/ConsentContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { ConnectPage } from './features/connections/ConnectPage';
import { AdminRoute } from './components/auth/AdminRoute';
import { DecisionAddress } from './components/features/decisions/DecisionAddress';
import { isStudiaEnabled } from './features/studia/featureFlag';
import { DevRoute } from './features/devMode/DevRoute';
import { buttonClassName } from './components/ui/buttonStyles';
import { cn } from './lib/utils';
import { PageBoundary } from './components/layout/RouteBoundary';
import { PAGE_CODE } from './pageCode';

// Lazy load admin page + MERL-T surfaces (route-level code splitting)
import { lazy, Suspense } from 'react';

// The pages loaded with their route (P1, `pageCode.ts`); Ricerca, the sign-in page, Dossier, the Forum's «Dossier
// pubblici», a decision's address and «Pagina non trovata» stay in the first chunk. They wait in the layout's
// `RoutePage`, «Crediti» in the `Suspense` around the routes: nothing in their place, a failure that keeps the app.
const HistoryView = lazy(() => PAGE_CODE.history().then(m => ({ default: m.HistoryView })));
const ForumCommunityPage = lazy(() => PAGE_CODE.community().then(m => ({ default: m.ForumCommunityPage })));
const DocumentReviewPage = lazy(() => PAGE_CODE.documents().then(m => ({ default: m.DocumentReviewPage })));
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

// Global 404 rendered inside the authenticated layout so the sidebar stays visible.
function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3 p-6 text-center">
      <p className="text-2xl font-semibold text-slate-900 dark:text-white">Pagina non trovata</p>
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
      {/* A page outside the layout loaded with its route («Crediti») waits here: a boundary on screen from the first
          draw, so moving to it (the user menu, the sign-in page) keeps the screen it leaves until it is there. */}
      <Suspense fallback={null}>
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
            <Route path="dossier" element={<DossierPage />} />
            {/* Opus's planner (wave 1): «Oggi» is the section's home; «Dossier» stays at /dossier. */}
            <Route path="opus" element={<OpusPage />}>
              <Route index element={<Navigate to="oggi" replace />} />
              <Route path="oggi" element={<TodayView />} />
              <Route path="prossimi" element={<UpcomingView />} />
              <Route path="ingresso" element={<InboxView />} />
              <Route path="cestino" element={<TaskTrashView />} />
            </Route>
            <Route path="history" element={<HistoryView />} />
            <Route path="environments" element={<EnvironmentsRedirect />} />
            {/* The Forum's two areas: «Dossier pubblici» at its old address, «Community» a placeholder. */}
            <Route path="forum" element={<BulletinBoardPage />} />
            <Route path="forum/community" element={<ForumCommunityPage />} />
            <Route path="documents" element={<DocumentReviewPage />} />
            {/* How to connect an AI application through MCP, and the connected ones (user menu). */}
            <Route path="collega-app" element={<ConnectAiAppPage />} />
            {/* The MERL-T pages are development addresses (spec D6): without the development mode they
                lead to «/». The server's guards (consent, validators, admins) stay the real barrier. */}
            <Route
              path="merlt"
              element={
                <DevRoute>
                  <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                    <MerltHubPage />
                  </Suspense>
                </DevRoute>
              }
            />
            <Route
              path="merlt/contribuisci"
              element={
                <DevRoute>
                  <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                    <ContribPage />
                  </Suspense>
                </DevRoute>
              }
            />
            <Route
              path="merlt/valida"
              element={
                <DevRoute>
                  <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                    <ValidationPage />
                  </Suspense>
                </DevRoute>
              }
            />
            {/* Slice 4 absorb (Decision A): the Q&A page is gone — the graph is the
                SOLE deliberation surface. Both the old ask route and the legacy
                docs path redirect to /grafo, where the debate now lives. */}
            <Route path="merlt/qa" element={<DevRoute><Navigate to="/grafo" replace /></DevRoute>} />
            <Route path="merlt/chiedi" element={<DevRoute><Navigate to="/grafo" replace /></DevRoute>} />
            <Route
              path="grafo"
              element={
                <DevRoute>
                  <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                    <GraphExplorerPage />
                  </Suspense>
                </DevRoute>
              }
            />
            {/* VisuaLex Studia: behind VITE_FEATURE_STUDIA; /studia opens the review; progressi the data; valida is the validators' queue. */}
            {isStudiaEnabled() && (
              <Route
                path="studia"
                element={
                  <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                    <StudiaPage />
                  </Suspense>
                }
              >
                <Route index element={<Navigate to="ripasso" replace />} />
                <Route path="ripasso" element={<Suspense fallback={null}><ReviewHome /></Suspense>} />
                <Route path="ripasso/sessione" element={<Suspense fallback={<LessonLoading />}><ReviewSession /></Suspense>} />
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
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
