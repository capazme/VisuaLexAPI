import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { SearchPage } from './pages/SearchPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DossierPage } from './components/features/dossier/DossierPage';
import { HistoryView } from './components/features/history/HistoryView';
import { EnvironmentPage } from './components/features/environments/EnvironmentPage';
import { BulletinBoardPage } from './components/features/bulletin/BulletinBoardPage';
import { ConsentProvider } from './features/merlt/consent/ConsentContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { AdminRoute } from './components/auth/AdminRoute';

// Lazy load admin page + MERL-T surfaces (route-level code splitting)
import { lazy, Suspense } from 'react';
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

// Global 404 rendered inside the authenticated layout so the sidebar stays visible.
function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3 p-6 text-center">
      <p className="text-2xl font-semibold text-slate-900 dark:text-white">Pagina non trovata</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        L'indirizzo che hai aperto non esiste o non è più disponibile.
      </p>
      <Link
        to="/"
        className="mt-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 rounded"
      >
        Torna alla ricerca
      </Link>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

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
          <Route path="history" element={<HistoryView />} />
          <Route path="environments" element={<EnvironmentPage />} />
          <Route path="forum" element={<BulletinBoardPage />} />
          <Route
            path="merlt"
            element={
              <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                <MerltHubPage />
              </Suspense>
            }
          />
          <Route
            path="merlt/contribuisci"
            element={
              <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                <ContribPage />
              </Suspense>
            }
          />
          <Route
            path="merlt/valida"
            element={
              <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                <ValidationPage />
              </Suspense>
            }
          />
          {/* Slice 4 absorb (Decision A): the Q&A page is gone — the graph is the
              SOLE deliberation surface. Both the old ask route and the legacy
              docs path redirect to /grafo, where the debate now lives. */}
          <Route path="merlt/qa" element={<Navigate to="/grafo" replace />} />
          <Route path="merlt/chiedi" element={<Navigate to="/grafo" replace />} />
          <Route
            path="grafo"
            element={
              <Suspense fallback={<div className="p-6 text-sm text-slate-500">Caricamento…</div>}>
                <GraphExplorerPage />
              </Suspense>
            }
          />
          {/* Global 404 catch-all (inside the layout: sidebar stays visible) */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* Admin routes */}
        <Route
          path="/admin/*"
          element={
            <AdminRoute>
              <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Caricamento...</div>}>
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
