/**
 * Reads a DOCX in a Web Worker (spec #391 §6.1), so the page does not freeze on a long filing. The file never
 * leaves the browser: the Worker is a script of the page's own origin (the ingress's CSP allows `worker-src 'self'`).
 *
 * Where the browser has no Worker (the tests' jsdom), or the Worker cannot start, the same reader runs in the page.
 * A reading that does not end within `DOCX_READ_TIMEOUT_MS` stops the Worker and is refused.
 */
import { DocxError, isDocxErrorCode, type DocxErrorCode } from './docxErrors';
import { readDocxBytes, type DocxReading } from './readDocxPackage';

export const DOCX_READ_TIMEOUT_MS = 60_000;

export type DocxWorkerAnswer = { ok: true; reading: DocxReading } | { ok: false; code: DocxErrorCode };

async function readHere(file: Blob): Promise<DocxReading> {
  return readDocxBytes(new Uint8Array(await file.arrayBuffer()));
}

export function readDocxFile(file: Blob, timeoutMs = DOCX_READ_TIMEOUT_MS): Promise<DocxReading> {
  if (typeof Worker === 'undefined') return readHere(file);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./docxReader.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return readHere(file);
  }
  return new Promise<DocxReading>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new DocxError('timeout'));
    }, timeoutMs);
    worker.addEventListener('message', (event: MessageEvent<DocxWorkerAnswer>) => {
      if (settled) return;
      finish();
      const answer = event.data;
      if (answer.ok) resolve(answer.reading);
      else reject(new DocxError(isDocxErrorCode(answer.code) ? answer.code : 'malformed'));
    });
    // The Worker could not load or crashed: the reader runs in the page instead.
    const fallBack = () => {
      if (settled) return;
      finish();
      readHere(file).then(resolve, reject);
    };
    worker.addEventListener('error', fallBack);
    worker.addEventListener('messageerror', fallBack);
    worker.postMessage({ file });
  });
}
