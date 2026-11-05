import { useEffect } from 'react';
import { SearchPanel } from '../components/features/search/SearchPanel';
import { useTour } from '../hooks/useTour';

export function SearchPage() {
  const { tryStartTour, hasSeenTour } = useTour();

  // The search tour on a later visit; on the very first one it follows the welcome (`Layout`).
  useEffect(() => {
    if (hasSeenTour('welcome')) tryStartTour('search');
  }, [tryStartTour, hasSeenTour]);

  // A `full` page (U1, `components/layout/frame.ts`): the frame at its full-screen width in the normal view too, and no
  // cap of its own inside it (the old `ReaderLayout`'s `max-w-5xl` is gone); an open text keeps the reading measure.
  return (
    <div data-page-width="full">
      <SearchPanel />
    </div>
  );
}


