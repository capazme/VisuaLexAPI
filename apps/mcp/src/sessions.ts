import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Caller } from './auth.js';

/** A session nobody used for this long is closed (spec §4.5). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Open sessions per grant: a new one beyond this closes the oldest. */
export const MAX_SESSIONS_PER_GRANT = 10;

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

  /** The session for this id if it belongs to this caller's user and grant; otherwise undefined (answer 404). */
  find(id: string, caller: Pick<Caller, 'userId' | 'grantId'>): Session | undefined {
    const session = this.sessions.get(id);
    if (!session || session.userId !== caller.userId || session.grantId !== caller.grantId) return undefined;
    session.lastSeen = Date.now();
    return session;
  }

  /** Adds a session; when its grant already has the maximum, the oldest of that grant is closed first. */
  async add(session: Session): Promise<void> {
    const sameGrant = [...this.sessions.values()].filter((s) => s.grantId === session.grantId);
    // A Map iterates in insertion order: the first ones are the oldest.
    for (const old of sameGrant.slice(0, Math.max(0, sameGrant.length - MAX_SESSIONS_PER_GRANT + 1))) {
      await this.close(old.id);
    }
    this.sessions.set(session.id, session);
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
