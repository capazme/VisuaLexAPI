import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useMerltFeaturesMock = vi.fn();
const useExtractionJobMock = vi.fn();
const upload = vi.fn();
const extract = vi.fn();
const fetchCandidates = vi.fn();

vi.mock('../../useMerltFeatures', () => ({ useMerltFeatures: () => useMerltFeaturesMock() }));
vi.mock('../useExtractionJob', () => ({ useExtractionJob: () => useExtractionJobMock() }));
vi.mock('../contribApi', () => ({
  uploadContribDocument: (...a: unknown[]) => upload(...a),
  extractContribDocument: (...a: unknown[]) => extract(...a),
  fetchContribCandidates: (...a: unknown[]) => fetchCandidates(...a),
}));
vi.mock('../UploadDropzone', () => ({
  UploadDropzone: ({ onFile }: { onFile: (f: File) => void }) => (
    <button onClick={() => onFile(new File(['x'], 'note.txt', { type: 'text/plain' }))}>
      pick-file
    </button>
  ),
}));
vi.mock('../CandidateReviewList', () => ({
  CandidateReviewList: ({
    candidates,
    onPromoted,
    promotedEntities,
  }: {
    candidates: unknown[];
    onPromoted: (id: number, pendingId: string) => void;
    promotedEntities?: Array<{ pendingId: string; label: string }>;
  }) => (
    <div>
      <div data-testid="review-list">{candidates.length} candidati</div>
      <div data-testid="promoted-entities">
        {(promotedEntities ?? []).map((p) => `${p.pendingId}=${p.label}`).join(',')}
      </div>
      <button onClick={() => onPromoted(1, 'concetto:aaaa1111')}>promote-entity-1</button>
    </div>
  ),
}));

import { ContribPage } from '../ContribPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <ContribPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useMerltFeaturesMock.mockReturnValue({ canContribute: true, merltEnabled: true });
  useExtractionJobMock.mockReturnValue({ status: null, error: null, candidatesCreated: null });
  upload.mockReset().mockResolvedValue({ documentId: 99 });
  extract.mockReset().mockResolvedValue({ jobId: 'job-1', status: 'pending' });
  fetchCandidates.mockReset().mockResolvedValue({
    candidates: [
      { id: 1, candidate_type: 'entity', entity_text: 'A' },
      { id: 2, candidate_type: 'entity', entity_text: 'B' },
    ],
  });
});

describe('ContribPage', () => {
  it('blocks contribution without full consent', () => {
    useMerltFeaturesMock.mockReturnValue({ canContribute: false, merltEnabled: true });
    renderPage();
    expect(screen.getByText(/consenso/i)).toBeInTheDocument();
    expect(screen.queryByText('pick-file')).not.toBeInTheDocument();
  });

  it('shows the dropzone when contribution is allowed', () => {
    renderPage();
    expect(screen.getByText('pick-file')).toBeInTheDocument();
  });

  it('uploads + enqueues extraction on file pick', async () => {
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByText('pick-file'));
    });
    expect(upload).toHaveBeenCalled();
    await waitFor(() => expect(extract).toHaveBeenCalledWith(99));
  });

  it('renders the review list when extraction completes', async () => {
    // Job already completed; picking a file sets documentId → effect fetches candidates.
    useExtractionJobMock.mockReturnValue({ status: 'completed', error: null, candidatesCreated: 2 });
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByText('pick-file'));
    });
    await waitFor(() => expect(screen.getByTestId('review-list')).toHaveTextContent('2 candidati'));
  });

  // B1: an entity promoted from this document becomes a possible relation end
  // for the other candidates ("usa la proposta appena promossa").
  it('hands the entities promoted in this session to the review list, and drops them from it', async () => {
    useExtractionJobMock.mockReturnValue({ status: 'completed', error: null, candidatesCreated: 2 });
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByText('pick-file'));
    });
    await waitFor(() => expect(screen.getByTestId('review-list')).toHaveTextContent('2 candidati'));
    expect(screen.getByTestId('promoted-entities')).toHaveTextContent('');

    await act(async () => {
      fireEvent.click(screen.getByText('promote-entity-1'));
    });
    expect(screen.getByTestId('review-list')).toHaveTextContent('1 candidati');
    expect(screen.getByTestId('promoted-entities')).toHaveTextContent('concetto:aaaa1111=A');
  });
});
