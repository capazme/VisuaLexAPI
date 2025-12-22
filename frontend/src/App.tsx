import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { SearchPage } from './pages/SearchPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DossierPage } from './components/features/dossier/DossierPage';
import { HistoryView } from './components/features/history/HistoryView';
import { EnvironmentPage } from './components/features/environments/EnvironmentPage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { AdminRoute } from './components/auth/AdminRoute';

// Lazy load admin page
import { lazy, Suspense } from 'react';
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));

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
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<SearchPage />} />
          <Route path="dossier" element={<DossierPage />} />
          <Route path="history" element={<HistoryView />} />
          <Route path="environments" element={<EnvironmentPage />} />
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
