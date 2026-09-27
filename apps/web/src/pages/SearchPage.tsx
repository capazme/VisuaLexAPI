import { useEffect } from 'react';
import { SearchPanel } from '../components/features/search/SearchPanel';
import { ReaderLayout } from '../components/layout/ReaderLayout';
import { useTour } from '../hooks/useTour';

export function SearchPage() {
  const { tryStartTour } = useTour();

  // Start search tour on first visit
  useEffect(() => {
    tryStartTour('search');
  }, [tryStartTour]);

  return (
    <ReaderLayout maxWidth="normal">
      <SearchPanel />
    </ReaderLayout>
  );
}


