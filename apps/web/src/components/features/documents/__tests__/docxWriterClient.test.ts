import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocxError } from '../docx/docxErrors';
import { writeDocxLinksFile } from '../docx/docxWriterClient';
import { readDocxBytes } from '../docx/readDocxPackage';
import { buildZip, fixtureParts } from './docxZip';
import { testFile } from './fixtures';

type Listener = (event: { data?: unknown }) => void;

/** A Worker that records what it is sent and answers as the test says. */
class FakeWorker {
  static last: FakeWorker | null = null;
  listeners = new Map<string, Listener[]>();
  posted: unknown[] = [];
  terminated = false;
  url: string;

  constructor(url: URL | string) {
    this.url = String(url);
    FakeWorker.last = this;
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  fire(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWorker.last = null;
});

const bytes = () => buildZip(Object.entries(fixtureParts('links')).map(([name, data]) => ({ name, data })));
const HREF = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043!vig=';

async function request() {
  const input = bytes();
  const { text } = await readDocxBytes(input);
  const start = text.indexOf('art. 2043 c.c.');
  return { file: testFile([input], 'atto.docx'), requests: [{ start, end: start + 14, href: HREF }], expectedText: text };
}

describe('writeDocxLinksFile', () => {
  it('writes in the page where there is no Worker', async () => {
    const copy = await writeDocxLinksFile(await request());
    expect(copy.linked).toBe(1);
    expect((await readDocxBytes(copy.bytes)).text).toContain('art. 2043 c.c.');
  });

  it('hands the file and the citations to its Worker and takes its answer, then stops it', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const asked = await request();
    const pending = writeDocxLinksFile(asked);
    const worker = FakeWorker.last!;
    expect(worker.url).toContain('docxWriter.worker');
    expect(worker.posted).toEqual([asked]);
    const copy = { bytes: new Uint8Array([1]), outcomes: [], linked: 0 };
    worker.fire('message', { ready: true });
    worker.fire('message', { ok: true, copy });
    await expect(pending).resolves.toBe(copy);
    expect(worker.terminated).toBe(true);
  });

  it('a Worker that cannot load leaves the writing to the page; one that fails once ready refuses the file', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const early = writeDocxLinksFile(await request());
    FakeWorker.last!.fire('error');
    expect((await early).linked).toBe(1);

    const late = writeDocxLinksFile(await request());
    FakeWorker.last!.fire('message', { ready: true });
    FakeWorker.last!.fire('error');
    await expect(late).rejects.toMatchObject({ code: 'malformed' });
  });

  it('passes the Worker’s refusal on with its code, and stops a writing that takes too long', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const refused = writeDocxLinksFile(await request());
    FakeWorker.last!.fire('message', { ok: false, code: 'signed' });
    await expect(refused).rejects.toMatchObject({ code: 'signed' });

    vi.useFakeTimers();
    const slow = writeDocxLinksFile(await request(), 1000);
    const worker = FakeWorker.last!;
    vi.advanceTimersByTime(1001);
    await expect(slow).rejects.toBeInstanceOf(DocxError);
    await expect(slow).rejects.toMatchObject({ code: 'timeout' });
    expect(worker.terminated).toBe(true);
  });
});
