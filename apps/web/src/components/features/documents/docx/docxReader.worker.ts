/**
 * The DOCX reader's Worker (spec #391 §6.1, §7.1): a 300-page filing is inflated and walked off the page's thread.
 * It says `ready` as soon as it is loaded, receives the `File` itself (cloned by reference, the bytes read here) and
 * answers once.
 */
import { DocxError } from './docxErrors';
import { readDocxBytes } from './readDocxPackage';
import type { DocxWorkerAnswer } from './docxWorkerClient';

self.addEventListener('message', (event: MessageEvent<{ file: Blob }>) => {
  void (async () => {
    let answer: DocxWorkerAnswer;
    try {
      const bytes = new Uint8Array(await event.data.file.arrayBuffer());
      answer = { ok: true, reading: await readDocxBytes(bytes) };
    } catch (error) {
      answer = { ok: false, code: error instanceof DocxError ? error.code : 'malformed' };
    }
    self.postMessage(answer);
  })();
});

// Loaded: from now on a failure is the file's, not the script's (the client then refuses rather than reading the
// same file again in the page).
self.postMessage({ ready: true } satisfies DocxWorkerAnswer);
