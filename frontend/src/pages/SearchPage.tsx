import { SearchPanel } from '../components/features/search/SearchPanel';
import { ReaderLayout } from '../components/layout/ReaderLayout';

export function SearchPage() {
  return (
    <ReaderLayout maxWidth="normal">
      <SearchPanel />
    </ReaderLayout>
  );
}


