import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Caller } from './auth.js';

/** A session nobody used for this long is closed (spec §4.5). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Open sessions per grant: a new one beyond this closes the grant's oldest. */
export const MAX_SESSIONS_PER_GRANT = 10;
/** Open sessions per user, across all their connected applications: a new one beyond this closes the user's oldest. */
export const MAX_SESSIONS_PER_USER = 20;
/** Open sessions in the process: when full, a new one is refused rather than another user's closed. */
export const MAX_SESSIONS = 1000;

export interface Session {
  id: string;
  userId: string;
  grantId: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
}

/**
 * The open MCP sessions, in memory (one process; a restart drops them and
 * clients start new ones). A session belongs to the user and the grant whose
 * token opened it: a later request may carry another token of the same grant
 * (the client refreshed it), never one of another user or grant. Every request
 * is still introspected before it gets here, so the session never stands in
 * for authentication.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly maxSessions: number;
  /** Sessions being opened: counted against the cap before they exist, so concurrent opens cannot pass it together. */
  private pending = 0;

  constructor(options: { maxSessions?: number } = {}) {
    this.maxSessions = options.maxSessions ?? MAX_SESSIONS;
  }

  /** Whether a new session may open: the process cap is never met by closing someone else's. */
  hasRoom(): boolean {
    return this.sessions.size + this.pending < this.maxSessions;
  }

  /** Takes a place for a session about to open; false when the process is full. Pair with release(). */
  reserve(): boolean {
    if (!this.hasRoom()) return false;
    this.pending += 1;
    return true;
  }

  /** Gives the place back once the open has finished, whether the session now exists or not. */
  release(): void {
    this.pending = Math.max(0, this.pending - 1);
  }

  /** The session for this id if it belongs to this caller's user and grant; otherwise undefined (answer 404). */
  find(id: string, caller: Pick<Caller, 'userId' | 'grantId'>): Session | undefined {
    const session = this.sessions.get(id);
    if (!session || session.userId !== caller.userId || session.grantId !== caller.grantId) return undefined;
    session.lastSeen = Date.now();
    return session;
  }

  /**
   * Adds a session. When its grant, or its user across all grants, already has
   * the maximum, their own oldest sessions are closed first; nobody else's.
   */
  async add(session: Session): Promise<void> {
    await this.trim((s) => s.grantId === session.grantId, MAX_SESSIONS_PER_GRANT);
    await this.trim((s) => s.userId === session.userId, MAX_SESSIONS_PER_USER);
    this.sessions.set(session.id, session);
  }

  /** Closes the oldest sessions matching `which` until one more fits under `max`. */
  private async trim(which: (s: Session) => boolean, max: number): Promise<void> {
    // A Map iterates in insertion order: the first ones are the oldest.
    const matching = [...this.sessions.values()].filter(which);
    for (const old of matching.slice(0, Math.max(0, matching.length - max + 1))) await this.close(old.id);
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    // Removed first: closing the transport calls back into close() through its onclose.
    this.sessions.delete(id);
    await session.transport.close();
    await session.server.close();
  }

  /** Closes the sessions idle for longer than SESSION_IDLE_MS; returns how many. */
  async sweep(now: number = Date.now()): Promise<number> {
    const idle = [...this.sessions.values()].filter((s) => now - s.lastSeen > SESSION_IDLE_MS);
    for (const session of idle) await this.close(session.id);
    return idle.length;
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.close(id);
  }

  size(): number {
    return this.sessions.size;
  }
}
