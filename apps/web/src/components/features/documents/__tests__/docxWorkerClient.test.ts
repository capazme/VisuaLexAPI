import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocxError } from '../docx/docxErrors';
import { readDocxFile } from '../docx/docxWorkerClient';
import { fixtureDocx } from './docxZip';
import { testFile } from './fixtures';

type Listener = (event: { data?: unknown }) => void;

/** A Worker that records what it is sent and answers as the test says. */
class FakeWorker {
  static last: FakeWorker | null = null;
  static throwOnCreate = false;
  listeners = new Map<string, Listener[]>();
  posted: unknown[] = [];
  terminated = false;
  url: string;

  constructor(url: URL | string) {
    if (FakeWorker.throwOnCreate) throw new Error('blocked');
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
  FakeWorker.throwOnCreate = false;
});

const file = () => testFile([fixtureDocx('plain')], 'atto.docx');

describe('readDocxFile', () => {
  it('reads in the page where there is no Worker', async () => {
    expect((await readDocxFile(file())).text).toContain('Tribunale di Esempio');
  });

  it('hands the file to its Worker and takes its answer, then stops it', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const input = file();
    const pending = readDocxFile(input);
    const worker = FakeWorker.last!;
    expect(worker.url).toContain('docxReader.worker');
    expect(worker.posted).toEqual([{ file: input }]);
    worker.fire('message', { ok: true, reading: { text: 'dal worker', map: { origins: [], segments: [] }, notes: [], signed: false } });
    expect((await pending).text).toBe('dal worker');
    expect(worker.terminated).toBe(true);
  });

  it('passes on the Worker’s refusal as its code', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pending = readDocxFile(file());
    FakeWorker.last!.fire('message', { ok: false, code: 'encrypted' });
    await expect(pending).rejects.toMatchObject({ code: 'encrypted' });
  });

  it('reads in the page when the Worker cannot start or fails to load', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.throwOnCreate = true;
    expect((await readDocxFile(file())).text).toContain('Tribunale di Esempio');
    FakeWorker.throwOnCreate = false;
    const pending = readDocxFile(file());
    FakeWorker.last!.fire('error');
    expect((await pending).text).toContain('Tribunale di Esempio');
    expect(FakeWorker.last!.terminated).toBe(true);
  });

  it('stops a Worker that does not answer in time', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const pending = readDocxFile(file(), 1000);
    const caught = pending.catch(error => error);
    vi.advanceTimersByTime(1001);
    const error = await caught;
    expect(error).toBeInstanceOf(DocxError);
    expect(error.code).toBe('timeout');
    expect(FakeWorker.last!.terminated).toBe(true);
  });
});
