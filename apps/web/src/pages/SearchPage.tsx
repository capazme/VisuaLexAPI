import { useEffect } from 'react';
import { SearchPanel } from '../components/features/search/SearchPanel';
import { ReaderLayout } from '../components/layout/ReaderLayout';
import { useTour } from '../hooks/useTour';

export function SearchPage() {
  const { tryStartTour, hasSeenTour } = useTour();

  // The search tour on a later visit; on the very first one it follows the welcome (`Layout`).
  useEffect(() => {
    if (hasSeenTour('welcome')) tryStartTour('search');
  }, [tryStartTour, hasSeenTour]);

  return (
    <ReaderLayout maxWidth="normal">
      <SearchPanel />
    </ReaderLayout>
  );
}


