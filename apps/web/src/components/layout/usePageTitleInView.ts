import { useEffect, useState } from 'react';

/**
 * Whether the page's title (the first `h1` in the content scroller) is in sight under the phone's bar (G8): while it
 * is, the bar shows no name; scrolled out from under the bar, the bar names the page — the large titles of iOS.
 * An `IntersectionObserver` on the title with the scroller as its root and the bar's height taken off its top; a
 * `MutationObserver` finds the title again when the page draws it later (a route loaded on demand) or replaces it. A
 * page with no `h1` reads as out of sight, so the bar names the page; so does a browser with no `IntersectionObserver`,
 * where the bar would otherwise stay empty.
 */
export function usePageTitleInView(scroller: HTMLElement | null, { enabled, resetKey, bar }: { enabled: boolean; resetKey: string; bar: HTMLElement | null }): boolean {
  const [answer, setAnswer] = useState<{ key: string; inView: boolean } | null>(null);
  useEffect(() => {
    if (!enabled || !scroller || typeof IntersectionObserver === 'undefined') return;
    let observer: IntersectionObserver | null = null;
    let watched: Element | null | undefined;
    let last: boolean | undefined;
    // Only a change is set: the mutations come many to a frame, and an equal answer must not draw the layout again.
    const say = (inView: boolean) => {
      if (inView === last) return;
      last = inView;
      setAnswer({ key: resetKey, inView });
    };
    const watch = () => {
      const title = scroller.querySelector('h1');
      if (title === watched) return;
      watched = title;
      observer?.disconnect();
      observer = null;
      if (!title) {
        say(false);
        return;
      }
      observer = new IntersectionObserver(([entry]) => say(entry.isIntersecting), {
        root: scroller,
        rootMargin: `-${bar?.offsetHeight ?? 0}px 0px 0px 0px`,
      });
      observer.observe(title);
    };
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(scroller, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer?.disconnect();
    };
  }, [scroller, enabled, resetKey, bar]);
  if (typeof IntersectionObserver === 'undefined') return false;
  // A new page starts with its title in sight, until its own answer comes.
  return answer?.key === resetKey ? answer.inView : true;
}
