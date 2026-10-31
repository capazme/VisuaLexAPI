/**
 * Writes the copy of a DOCX with the links in a Web Worker (spec #391 §6.2, §7.1, L4), as `docxWorkerClient.ts`
 * reads it: the file never leaves the browser, a long filing does not freeze the page.
 *
 * Where the browser has no Worker (the tests' jsdom), or the Worker cannot load (it fails before saying `ready`), the
 * same writer runs in the page. Once the Worker is ready, a failure is the file's: it is refused, never written again
 * in the page. A writing that does not end within `DOCX_WRITE_TIMEOUT_MS` stops the Worker and is refused.
 */
import { DocxError, isDocxErrorCode, type DocxErrorCode } from './docxErrors';
import { writeDocxLinks, type DocxLinkedCopy, type DocxLinkRequest } from './writeDocxPackage';

export const DOCX_WRITE_TIMEOUT_MS = 60_000;

export interface DocxWriterRequest {
  file: Blob;
  requests: DocxLinkRequest[];
  /** The text the requests count in, as the reader gave it (see `DocxWriteOptions.expectedText`). */
  expectedText?: string;
}

export type DocxWriterAnswer =
  | { ready: true }
  | { ok: true; copy: DocxLinkedCopy }
  | { ok: false; code: DocxErrorCode };

async function writeHere(request: DocxWriterRequest): Promise<DocxLinkedCopy> {
  const bytes = new Uint8Array(await request.file.arrayBuffer());
  return writeDocxLinks(bytes, request.requests, { expectedText: request.expectedText });
}

/** The copy of `request.file` with the links, and what was done with each citation. The file is not changed. */
export function writeDocxLinksFile(request: DocxWriterRequest, timeoutMs = DOCX_WRITE_TIMEOUT_MS): Promise<DocxLinkedCopy> {
  if (typeof Worker === 'undefined') return writeHere(request);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./docxWriter.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return writeHere(request);
  }
  return new Promise<DocxLinkedCopy>((resolve, reject) => {
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
    worker.addEventListener('message', (event: MessageEvent<DocxWriterAnswer>) => {
      if (settled) return;
      const answer = event.data;
      if ('ready' in answer) {
        ready = true;
        return;
      }
      finish();
      if (answer.ok) resolve(answer.copy);
      else reject(new DocxError(isDocxErrorCode(answer.code) ? answer.code : 'malformed'));
    });
    const failed = () => {
      if (settled) return;
      finish();
      if (ready) reject(new DocxError('malformed', 'worker failed'));
      else writeHere(request).then(resolve, reject);
    };
    worker.addEventListener('error', failed);
    worker.addEventListener('messageerror', failed);
    worker.postMessage(request);
  });
}
