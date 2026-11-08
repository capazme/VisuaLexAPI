/**
 * The DOCX writer's Worker (spec #391 §6.2, §7.1, L4): the copy with the links is written off the page's thread. It
 * says `ready` as soon as it is loaded, receives the `File` itself and the citations, and answers once, handing the
 * copy's bytes over (transferred, not cloned).
 */
import { DocxError } from './docxErrors';
import { writeDocxLinks } from './writeDocxPackage';
import type { DocxWriterAnswer, DocxWriterRequest } from './docxWriterClient';

self.addEventListener('message', (event: MessageEvent<DocxWriterRequest>) => {
  void (async () => {
    let answer: DocxWriterAnswer;
    try {
      const bytes = new Uint8Array(await event.data.file.arrayBuffer());
      answer = { ok: true, copy: await writeDocxLinks(bytes, event.data.requests, { expectedText: event.data.expectedText }) };
    } catch (error) {
      answer = { ok: false, code: error instanceof DocxError ? error.code : 'malformed' };
    }
    if (answer.ok) self.postMessage(answer, { transfer: [answer.copy.bytes.buffer as ArrayBuffer] });
    else self.postMessage(answer);
  })();
});

// Loaded: from now on a failure is the file's, not the script's.
self.postMessage({ ready: true } satisfies DocxWriterAnswer);
