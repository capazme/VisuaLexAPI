import { describeUnexpectedError } from '../middleware/errorHandler';

/**
 * What the process does with an error nobody caught (item 14 of the security inventory). Without these, Node 24 ends
 * the whole server on the first promise rejected with no handler, from any route or timer, for every user, until the
 * container restarts.
 *
 * - A rejection nobody handled is logged and the server keeps running: the request that caused it has already
 *   failed on its own, and nothing else is half-done.
 * - An exception nobody caught leaves the process in a state nothing vouches for: it is logged, then `onFatal`
 *   (the graceful shutdown) ends it, and the container starts a fresh one.
 *
 * Either is logged by its kind and stack frames only (`describeUnexpectedError`), never its message: a database
 * error may quote what it was writing.
 */
export function installProcessGuards(onFatal: () => void, target: NodeJS.EventEmitter = process): void {
  target.on('unhandledRejection', (reason: unknown) => {
    console.error(`[process] unhandled rejection, the server keeps running: ${describeUnexpectedError(reason)}`);
  });
  target.on('uncaughtException', (err: unknown) => {
    console.error(`[process] uncaught exception, shutting down: ${describeUnexpectedError(err)}`);
    onFatal();
  });
}
