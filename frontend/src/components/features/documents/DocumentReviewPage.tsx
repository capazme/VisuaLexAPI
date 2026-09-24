import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, FileText, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { extractCitations, formatCitationLabel, type CitationMatch } from '../../../utils/citationMatcher';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';

function readableText(fileName: string, content: string): string {
  if (/\.html?$/i.test(fileName)) {
    const document = new DOMParser().parseFromString(content, 'text/html');
    return document.body.textContent ?? '';
  }
  return content;
}

function decodeXml(value: string): string {
  const parser = new DOMParser();
  return parser.parseFromString(`<span>${value}</span>`, 'text/html').body.textContent ?? value;
}

/** Extracts the main XML part from a DOCX without sending the file anywhere. */
async function readDocx(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const eocd = 0x06054b50;
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === eocd) { end = offset; break; }
  }
  if (end < 0) throw new Error('Archivio DOCX non valido');

  const entries = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  let cursor = centralOffset;
  let documentXml: Uint8Array | null = null;
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Indice DOCX non valido');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === 'word/document.xml') {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(start, start + compressedSize);
      if (method === 0) documentXml = compressed;
      else if (method === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        documentXml = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error('Compressione DOCX non supportata');
      break;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!documentXml) throw new Error('Testo principale DOCX non trovato');

  const xml = decoder.decode(documentXml);
  return decodeXml(xml
    .replace(/<w:tab\s*\/?\s*>/gi, '\t')
    .replace(/<w:br\s*\/?\s*>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi, '$1')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function DocumentReviewPage() {
  const triggerSearch = useAppStore(s => s.triggerSearch);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CitationMatch | null>(null);

  const citations = useMemo(() => extractCitations(text), [text]);

  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > 15 * 1024 * 1024) {
      setError('Il documento supera il limite locale di 15 MB.');
      return;
    }
    if (/\.pdf$/i.test(file.name)) {
      setError('I PDF scansionati o non testuali richiedono OCR. Per ora importa un PDF testuale o copia il testo in formato TXT/HTML. Il file non è stato inviato al server.');
      return;
    }
    if (!/\.(txt|md|markdown|html?|docx)$/i.test(file.name)) {
      setError('Formato non supportato. Usa TXT, Markdown, HTML o DOCX.');
      return;
    }
    try {
      const content = /\.docx$/i.test(file.name) ? await readDocx(file) : readableText(file.name, await file.text());
      if (!content.trim()) {
        setError('Il documento non contiene testo leggibile.');
        return;
      }
      setText(content);
      setFileName(file.name);
      setSelected(null);
    } catch {
      setError('Impossibile leggere il documento localmente.');
    }
  };

  const openCitation = (citation: CitationMatch) => {
    setSelected(citation);
    // The search runs on the reader page: without navigating first the
    // trigger sits in the store until the user opens `/` by hand (the
    // pattern is HistoryView's handleItemClick).
    navigate('/');
    triggerSearch({
      act_type: citation.parsed.act_type,
      act_number: citation.parsed.act_number ?? '',
      date: citation.parsed.date ?? '',
      article: citation.parsed.article,
      version: 'vigente',
      version_date: '',
      show_brocardi_info: true,
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><FileText className="text-primary-500" size={24} /><h1 className="text-2xl font-bold text-slate-900 dark:text-white">Analizza documento</h1></div>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Individua le citazioni normative direttamente nel browser. Il file non viene caricato né salvato sul server.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><ShieldCheck size={15} /> Locale-first</div>
      </header>

      <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.html,.htm,.docx,.pdf" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ''; }} />
      {!fileName ? <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-48 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center hover:border-primary-400 dark:border-slate-700 dark:bg-slate-900"><Upload size={32} className="mb-3 text-primary-500" /><span className="font-semibold text-slate-700 dark:text-slate-200">Scegli un documento</span><span className="mt-1 text-xs text-slate-400">TXT, Markdown, HTML o DOCX · massimo 15 MB · elaborazione locale</span></button> : <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"><div className="flex min-w-0 items-center gap-3"><FileText size={18} className="text-primary-500" /><span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{fileName}</span><span className="text-xs text-slate-400">{citations.length} citazioni</span></div><button type="button" onClick={() => { setFileName(null); setText(''); setSelected(null); }} className="inline-flex items-center gap-1 text-xs text-red-500 hover:underline"><Trash2 size={14} /> Cancella</button></div>}

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"><AlertCircle size={17} className="mt-0.5 shrink-0" /> {error}</div>}

      {fileName && <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h2 className="mb-3 font-semibold text-slate-900 dark:text-white">Testo del documento</h2><pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-300">{text}</pre></section>
        <aside className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-900 dark:text-white">Citazioni trovate</h2><span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">{citations.length}</span></div>{citations.length === 0 ? <p className="text-sm text-slate-500">Nessun riferimento riconosciuto.</p> : <div className="space-y-2">{citations.map((citation, index) => <button key={`${citation.startIndex}-${index}`} type="button" onClick={() => openCitation(citation)} className={cn('w-full rounded-lg border p-3 text-left transition-colors', selected === citation ? 'border-primary-400 bg-primary-50 dark:border-primary-700 dark:bg-primary-950/30' : 'border-slate-200 hover:border-primary-300 dark:border-slate-700')}><span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200"><Search size={14} className="text-primary-500" />{formatCitationLabel(citation.parsed)}</span><span className="mt-1 block truncate text-xs text-slate-400">“{citation.text}”</span><span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">Confidenza {Math.round(citation.parsed.confidence * 100)}% · Apri nella ricerca</span></button>)}</div>}</aside>
      </div>}
    </div>
  );
}
