/**
 * Reads a DOCX in a Web Worker (spec #391 §6.1), so the page does not freeze on a long filing. The file never
 * leaves the browser: the Worker is a script of the page's own origin (the ingress's CSP allows `worker-src 'self'`).
 *
 * Where the browser has no Worker (the tests' jsdom), or the Worker cannot load (it fails before saying `ready`), the
 * same reader runs in the page. Once the Worker is ready, a failure is the file's (a crash, memory run out): it is
 * refused, never read again in the page, which is what the Worker is there to spare. A reading that does not end
 * within `DOCX_READ_TIMEOUT_MS` stops the Worker and is refused.
 */
import { DocxError, isDocxErrorCode, type DocxErrorCode } from './docxErrors';
import { readDocxBytes, type DocxReading } from './readDocxPackage';

export const DOCX_READ_TIMEOUT_MS = 60_000;

export type DocxWorkerAnswer =
  | { ready: true }
  | { ok: true; reading: DocxReading }
  | { ok: false; code: DocxErrorCode };

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
    let ready = false;
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
      const answer = event.data;
      if ('ready' in answer) {
        ready = true;
        return;
      }
      finish();
      if (answer.ok) resolve(answer.reading);
      else reject(new DocxError(isDocxErrorCode(answer.code) ? answer.code : 'malformed'));
    });
    // Before `ready` the script could not load: the reader runs in the page instead. After it, the file broke it.
    const failed = () => {
      if (settled) return;
      finish();
      if (ready) reject(new DocxError('malformed', 'worker failed'));
      else readHere(file).then(resolve, reject);
    };
    worker.addEventListener('error', failed);
    worker.addEventListener('messageerror', failed);
    worker.postMessage({ file });
  });
}
