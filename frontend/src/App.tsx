import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { SearchPage } from './pages/SearchPage';
import { DossierPage } from './components/features/dossier/DossierPage';
import { HistoryView } from './components/features/history/HistoryView';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* App routes with layout */}
        <Route path="/" element={<Layout />}>
          <Route index element={<SearchPage />} />
          <Route path="dossier" element={<DossierPage />} />
          <Route path="history" element={<HistoryView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
