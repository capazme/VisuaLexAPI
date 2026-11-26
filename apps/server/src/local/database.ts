/**
 * The desktop app's local database (G-612, G-613; spec §3 of
 * docs/superpowers/specs/2026-11-26-desktop-local-mode-design.md): one SQLite file, encrypted with
 * SQLite3MultipleCiphers (ChaCha20-Poly1305) under a raw 256-bit key from the OS credential store, reached by
 * Prisma 7 through @prisma/adapter-better-sqlite3 on a single connection, with one lock on it.
 *
 * Loaded only in local mode (src/lib/prisma.ts), never by the online server, which does not install its driver.
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';

type SqlDriverAdapter = Awaited<ReturnType<PrismaBetterSqlite3['connect']>>;
type Transaction = Awaited<ReturnType<SqlDriverAdapter['startTransaction']>>;
type SqlQuery = Parameters<SqlDriverAdapter['queryRaw']>[0];
/** The better-sqlite3 database under the adapter (SQLite3MultipleCiphers' build): the methods used here. */
type Driver = Pick<Database.Database, 'pragma' | 'prepare'>;

const KEY = /^[0-9a-f]{64}$/;
let handedKey: string | null = null;

/** The entry point hands the key over once, at start-up; it lives in this module only, never in process.env. */
export function setLocalKey(keyHex: string): void {
  if (!KEY.test(keyHex)) throw new Error('[local] the database key must be 64 lower-case hex characters');
  handedKey = keyHex;
}

/** The key, taken once: the module forgets it as soon as the client has it. */
export function takeLocalKey(): string {
  const keyHex = handedKey;
  handedKey = null;
  if (!keyHex) throw new Error('[local] no database key was handed over');
  return keyHex;
}

/**
 * Cipher, then key: the order SQLite3MultipleCiphers requires, before anything else touches the file. A raw key
 * (`x'…'`) skips the key derivation, since the key is already 256 random bits.
 */
export function applyKey(db: Driver, keyHex: string): void {
  if (!KEY.test(keyHex)) throw new Error('[local] the database key must be 64 lower-case hex characters');
  db.pragma(`cipher='chacha20'`);
  db.pragma(`key="x'${keyHex}'"`);
}

/**
 * Every setting of an open connection, in the spec's order: the key; the exclusive lock (one process on the file);
 * a read that fails with «file is not a database» on a wrong key; WAL; a commit that reaches the disk
 * (`synchronous=FULL`, and on macOS `fullfsync`, since there fsync() leaves the drive's cache); foreign keys on (the
 * driver's default varies by build: set, never assumed); temporary files in memory (SQLite3MC does not encrypt them).
 */
export function configure(db: Driver, keyHex: string): void {
  applyKey(db, keyHex);
  db.pragma('locking_mode=EXCLUSIVE');
  db.prepare('SELECT count(*) FROM sqlite_master').get();
  db.pragma('journal_mode=WAL');
  db.pragma('synchronous=FULL');
  if (process.platform === 'darwin') {
    db.pragma('fullfsync=ON');
    db.pragma('checkpoint_fullfsync=ON');
  }
  db.pragma('foreign_keys=ON');
  db.pragma('temp_store=MEMORY');
  db.pragma('busy_timeout=5000');
}

const instanceLocks = new Map<string, Database.Database>();

/**
 * One process per data folder (spec §4). A small SQLite file beside the database, `<file>.lock`, in rollback-journal
 * mode with the exclusive locking mode, written once: SQLite then keeps the file's exclusive lock until this process
 * closes it or ends, and the operating system releases it if the process crashes, so no stale lock is ever left.
 * Another process finds it locked at once and is refused. (The database's own exclusive lock in WAL mode kept a
 * second process out on macOS and Windows but not on Linux, measured; this works the same everywhere.)
 * Taken by migrateLocal and by the client's connect; idempotent within the process. The file holds only a pid and a
 * time, never data.
 */
export function holdInstanceLock(file: string): void {
  const lockFile = `${file}.lock`;
  if (instanceLocks.has(lockFile)) return;
  const guard = new Database(lockFile);
  try {
    guard.pragma('busy_timeout=0');
    guard.pragma('locking_mode=EXCLUSIVE');
    guard.pragma('journal_mode=DELETE');
    guard.exec('CREATE TABLE IF NOT EXISTS "holder" ("id" INTEGER PRIMARY KEY, "pid" INTEGER NOT NULL, "since" TEXT NOT NULL)');
    guard.prepare('INSERT OR REPLACE INTO "holder" ("id", "pid", "since") VALUES (1, ?, ?)').run(process.pid, new Date().toISOString());
  } catch (error) {
    guard.close();
    if (/database is locked|busy/i.test((error as Error).message)) {
      throw new Error('[local] another LexCraft process has this data folder open');
    }
    throw error;
  }
  instanceLocks.set(lockFile, guard);
}

/** Lets the data folder go: at shutdown (the client's dispose) and in tests. */
export function releaseInstanceLock(file: string): void {
  const lockFile = `${file}.lock`;
  instanceLocks.get(lockFile)?.close();
  instanceLocks.delete(lockFile);
}

/** A FIFO lock: whoever holds it has the connection. */
class Lock {
  #tail: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => (release = resolve));
    const ready = this.#tail.then(() => release);
    this.#tail = this.#tail.then(() => next);
    return ready;
  }
}

const statement = (sql: string): SqlQuery => ({ sql, args: [], argTypes: [] });

/**
 * One connection, one lock (spec §3). The adapter queues interactive transactions behind its own mutex, but a plain
 * query does not wait for it: on the single connection it would run inside another request's open transaction, read
 * its uncommitted rows and vanish with its rollback (measured). And if BEGIN fails, the adapter never releases that
 * mutex. So the adapter's own `startTransaction` is never called:
 * - a plain query, a raw statement or a script holds the lock for its own duration;
 * - a transaction holds it from its BEGIN, run here, until Prisma calls `commit()` or `rollback()` (Prisma sends the
 *   COMMIT or ROLLBACK statement itself first, through the transaction, since `usePhantomQuery` is false);
 * - queries inside the transaction go through the transaction object, unlocked, so they never wait on themselves;
 * - a BEGIN that throws releases the lock.
 */
export function serialize(adapter: SqlDriverAdapter): SqlDriverAdapter {
  const lock = new Lock();
  // The driver under the adapter, to see whether a transaction is still open (better-sqlite3's `inTransaction`).
  const driver = (adapter as unknown as { client?: { inTransaction?: boolean } }).client;
  const queryRaw = adapter.queryRaw.bind(adapter);
  const executeRaw = adapter.executeRaw.bind(adapter);
  const executeScript = adapter.executeScript.bind(adapter);
  const locked = <A extends unknown[], R>(run: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    const release = await lock.acquire();
    try {
      return await run(...args);
    } finally {
      release();
    }
  };
  const startTransaction = async (isolationLevel?: Parameters<SqlDriverAdapter['startTransaction']>[0]): Promise<Transaction> => {
    if (isolationLevel && isolationLevel !== 'SERIALIZABLE') throw new Error(`[local] isolation level ${isolationLevel} is not supported on SQLite`);
    const release = await lock.acquire();
    let open = true;
    const end = async () => {
      if (open) {
        open = false;
        release();
      }
    };
    // When COMMIT itself fails (a full disk, an I/O error), Prisma calls rollback() without sending ROLLBACK, and
    // SQLite may keep the transaction open: roll it back here before the lock goes, or the next request would run
    // inside it.
    const rollback = async () => {
      if (open && driver?.inTransaction) await executeRaw(statement('ROLLBACK')).catch(() => undefined);
      await end();
    };
    try {
      await executeRaw(statement('BEGIN'));
    } catch (error) {
      await end();
      throw error;
    }
    return {
      provider: adapter.provider,
      adapterName: adapter.adapterName,
      options: { usePhantomQuery: false },
      queryRaw,
      executeRaw,
      commit: end,
      rollback,
      createSavepoint: async (name: string) => { await executeRaw(statement(`SAVEPOINT ${name}`)); },
      rollbackToSavepoint: async (name: string) => { await executeRaw(statement(`ROLLBACK TO ${name}`)); },
      releaseSavepoint: async (name: string) => { await executeRaw(statement(`RELEASE SAVEPOINT ${name}`)); },
    };
  };
  return {
    provider: adapter.provider,
    adapterName: adapter.adapterName,
    queryRaw: locked(queryRaw),
    executeRaw: locked(executeRaw),
    executeScript: locked(executeScript),
    startTransaction,
    ...(adapter.getConnectionInfo ? { getConnectionInfo: adapter.getConnectionInfo.bind(adapter) } : {}),
    dispose: () => adapter.dispose(),
  };
}

/**
 * The adapter for the local file: the data folder's instance lock taken first, then the connection configured,
 * its opening time written, and the connection serialized. Its dispose lets the folder go.
 */
export function localAdapter({ file, keyHex }: { file: string; keyHex: string }): PrismaBetterSqlite3 {
  if (!KEY.test(keyHex)) throw new Error('[local] the database key must be 64 lower-case hex characters');
  class EncryptedSqlite extends PrismaBetterSqlite3 {
    async connect(): Promise<SqlDriverAdapter> {
      holdInstanceLock(file);
      const adapter = await super.connect();
      const db = (adapter as unknown as { client: Driver }).client;
      configure(db, keyHex);
      db.prepare(`INSERT OR REPLACE INTO "_lexcraft_meta" ("key", "value") VALUES ('opened_at', ?)`).run(new Date().toISOString());
      const serialized = serialize(adapter);
      return {
        ...serialized,
        dispose: async () => {
          await serialized.dispose();
          releaseInstanceLock(file);
        },
      };
    }
  }
  return new EncryptedSqlite({ url: `file:${file}` });
}
