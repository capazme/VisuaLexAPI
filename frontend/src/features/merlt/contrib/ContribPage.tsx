import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, UploadCloud } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useMerltFeatures } from '../useMerltFeatures';
import { UploadDropzone } from './UploadDropzone';
import { CandidateReviewList } from './CandidateReviewList';
import { useExtractionJob } from './useExtractionJob';
import { uploadContribDocument, extractContribDocument, fetchContribCandidates } from './contribApi';
import type { ExtractionCandidate } from './types';

/**
 * "Apprendi dai miei appunti" page (Slice 2c). Orchestrates
 * upload → async extraction (polled) → per-item review + promotion.
 * Gated by full (contribution) consent. All setState lives in event handlers
 * or promise callbacks (react-hooks/set-state-in-effect).
 */
export function ContribPage() {
  const { canContribute, merltEnabled } = useMerltFeatures();
  const [searchParams] = useSearchParams();

  // `?documentId=N` deeplink — the hub's "I miei contributi" list links here
  // for completed jobs so a refresh / fresh navigation doesn't lose context
  // (state used to live only in useState; closing the tab wiped everything).
  // Derived during render via a prev-input tracker (set-state-in-effect rule).
  const urlDocId = searchParams.get('documentId');
  const seedDocId = urlDocId ? Number.parseInt(urlDocId, 10) : null;
  const validSeed = seedDocId != null && !Number.isNaN(seedDocId) ? seedDocId : null;

  const [seedSync, setSeedSync] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ExtractionCandidate[] | null>(null);
  const [candidatesError, setCandidatesError] = useState(false);
  const [promotedIds, setPromotedIds] = useState<Set<number>>(new Set());
  if (validSeed !== seedSync) {
    setSeedSync(validSeed);
    setDocumentId(validSeed);
    setJobId(null);
    setCandidates(null);
    setCandidatesError(false);
    setPromotedIds(new Set());
  }

  const job = useExtractionJob(jobId);

  // Fetch candidates once the extraction completes OR we are seeding from URL
  // (no jobId, just a documentId — its job is already done elsewhere).
  useEffect(() => {
    const completed = job.status === 'completed';
    const urlSeed = jobId === null && documentId != null;
    if (!completed && !urlSeed) return;
    if (documentId == null) return;
    let cancelled = false;
    fetchContribCandidates(documentId)
      .then((r) => {
        if (!cancelled) setCandidates(r.candidates);
      })
      .catch(() => {
        if (!cancelled) setCandidatesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [job.status, documentId, jobId]);

  const handleFile = async (file: File): Promise<void> => {
    setUploading(true);
    setUploadError(null);
    setCandidates(null);
    setCandidatesError(false);
    try {
      const { documentId: docId } = await uploadContribDocument(file);
      setDocumentId(docId);
      const { jobId: newJobId } = await extractContribDocument(docId);
      setJobId(newJobId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Caricamento non riuscito');
    } finally {
      setUploading(false);
    }
  };

  const reset = (): void => {
    setDocumentId(null);
    setJobId(null);
    setCandidates(null);
    setCandidatesError(false);
    setUploadError(null);
    setPromotedIds(new Set());
  };

  if (!merltEnabled) {
    return <p className="text-slate-600 dark:text-slate-300">MERL-T non è disponibile.</p>;
  }
  if (!canContribute) {
    return (
      <div className="space-y-3">
        <p className="text-slate-600 dark:text-slate-300">
          Per contribuire con i tuoi appunti serve il consenso <strong>Completo</strong>.
        </p>
        <Link to="/merlt">
          <Button variant="secondary" size="sm">
            Vai alle impostazioni MERL-T
          </Button>
        </Link>
      </div>
    );
  }

  const extracting = jobId !== null && (job.status === null || job.status === 'pending' || job.status === 'running');
  const failed = job.status === 'failed' || job.status === 'timeout';

  return (
    <div className="space-y-6">
      <header>
        <Link to="/merlt" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> MERL-T
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
          <UploadCloud className="text-primary-500" />
          Apprendi dai miei appunti
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
          Carica i tuoi appunti: MERL-T propone nodi per il grafo giuridico, che tu rivedi e promuovi
          alla validazione della community. Il testo caricato resta privato finché non lo riformuli e
          promuovi tu.
        </p>
      </header>

      {!documentId && !uploading && <UploadDropzone onFile={(f) => void handleFile(f)} />}

      {uploading && (
        <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="animate-spin" size={16} /> Caricamento del documento…
        </p>
      )}
      {uploadError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>
          <Button variant="secondary" size="sm" onClick={reset}>Riprova</Button>
        </div>
      )}

      {extracting && (
        <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="animate-spin" size={16} /> Estrazione in corso… (può richiedere qualche minuto)
        </p>
      )}
      {failed && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            L’estrazione non è riuscita. {job.error ?? ''}
          </p>
          <Button variant="secondary" size="sm" onClick={reset}>Ricomincia</Button>
        </div>
      )}

      {(job.status === 'completed' || (jobId === null && documentId != null)) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 dark:text-white">Candidati estratti</h2>
            <Button variant="ghost" size="sm" onClick={reset}>Carica un altro</Button>
          </div>
          {candidatesError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Impossibile caricare i candidati.
            </p>
          )}
          {!candidatesError && candidates === null && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={16} /> Caricamento candidati…
            </p>
          )}
          {candidates !== null && (
            <CandidateReviewList
              candidates={candidates.filter((c) => !promotedIds.has(c.id))}
              articleUrn=""
              onPromoted={(id) => setPromotedIds((prev) => new Set(prev).add(id))}
            />
          )}
        </section>
      )}
    </div>
  );
}
