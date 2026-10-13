/**
 * The signed-in user changed under the components that read it: every mounted `useAuth()` keeps
 * its own copy, so a change made by one (the development mode's switch in Impostazioni) has to
 * reach the others — the sidebar, the article, a route guard — without a reload.
 *
 * Its own module, not part of `authService`: tests mock `authService` with only the calls they
 * need, and the hook subscribes on every mount.
 */
import type { UserResponse } from '../types/api';

type Listener = (user: UserResponse) => void;

const listeners = new Set<Listener>();

export function subscribeToUser(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishUser(user: UserResponse): void {
  for (const listener of [...listeners]) listener(user);
}
