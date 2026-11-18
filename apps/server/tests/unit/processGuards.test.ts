import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installProcessGuards } from '../../src/utils/processGuards';

/**
 * Errors nobody caught (item 14 of the security inventory): a rejection leaves the server running, an exception
 * shuts it down cleanly, and neither writes its message to the log.
 */
const SECRET = 'testo riservato del cliente';

describe('the guards, on their own', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('log a rejection by its kind, without its message, and do not shut down', () => {
    const target = new EventEmitter();
    const onFatal = vi.fn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installProcessGuards(onFatal, target);
    target.emit('unhandledRejection', new TypeError(SECRET));
    expect(onFatal).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain('unhandled rejection, the server keeps running: TypeError');
    expect(JSON.stringify(errors.mock.calls)).not.toContain(SECRET);
  });

  it('log an uncaught exception the same way, then shut down', () => {
    const target = new EventEmitter();
    const onFatal = vi.fn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installProcessGuards(onFatal, target);
    target.emit('uncaughtException', new RangeError(SECRET));
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(SECRET);
  });
});

describe('a real Node process', () => {
  const server = resolve(__dirname, '../..');
  const guards = resolve(server, 'src/utils/processGuards.ts');

  /** Runs a script that rejects a promise nobody handles, then reports after 200 ms whether it is still up. */
  function runRejecting(withGuards: boolean) {
    const dir = mkdtempSync(join(tmpdir(), 'guards-'));
    const script = join(dir, 'reject.ts');
    writeFileSync(script, [
      withGuards ? `import { installProcessGuards } from ${JSON.stringify(guards)};` : '',
      withGuards ? 'installProcessGuards(() => process.exit(3));' : '',
      `void Promise.reject(new Error(${JSON.stringify(SECRET)}));`,
      "setTimeout(() => { console.log('still up'); process.exit(0); }, 200);",
    ].join('\n'));
    try {
      // `--import tsx` resolves from the server's folder, where tsx is installed.
      return spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: server, encoding: 'utf8', timeout: 30_000 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('stays up after an unhandled rejection, and logs it without its message', () => {
    const run = runRejecting(true);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('still up');
    expect(run.stderr).toContain('unhandled rejection, the server keeps running');
    expect(run.stderr).not.toContain(SECRET);
  }, 40_000);

  it('without the guards, the same rejection ends the process (the control)', () => {
    const run = runRejecting(false);
    // 1 is Node's own exit for an unhandled rejection: the script did load and run, and the rejection ended it.
    expect(run.status).toBe(1);
    expect(run.stdout).not.toContain('still up');
  }, 40_000);
});
