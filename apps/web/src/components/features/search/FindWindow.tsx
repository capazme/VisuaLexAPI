import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react';
import { FOCUS_RING } from '../../../constants/interactions';
import { Z_INDEX } from '../../../constants/zIndex';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { useFindWindow, type FindScope } from '../../../hooks/useFindWindow';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { frontTabId as computeFrontTabId } from '../../../utils/findScope';
import {
  reportFindWindowScope,
  subscribeFindWindow,
  type FindWindowRequest,
} from '../../../utils/findWindowControl';
import { dragLimits, workspaceOrigin } from '../../../utils/workspaceOrigin';
import { counterText, ICON_BUTTON } from './findBarParts';

const PLACE_KEY = 'visualex:find-window-place';
const SCOPE_KEY = 'visualex:find-window-scope';
/** About 420 px wide on a desktop (spec §13.1). */
const WIDTH = 420;
const MARGIN = 16;
/** Pixels of the window that stay inside the viewport on every side it can be dragged past. */
const MIN_VISIBLE = 96;
const KEY_STEP = 16;

interface Place {
  x: number;
  y: number;
}

/** Viewport coordinates (the window is `position: fixed`), clamped so a handle is always reachable. */
function clampPlace(place: Place): Place {
  const limits = dragLimits({ left: 0, top: 0 }, { width: window.innerWidth, height: window.innerHeight }, WIDTH, MIN_VISIBLE);
  return {
    x: Math.min(Math.max(place.x, limits.left), limits.right),
    y: Math.min(Math.max(place.y, limits.top), limits.bottom),
  };
}

function readPlace(): Place | null {
  try {
    const raw = sessionStorage.getItem(PLACE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const { x, y } = parsed as Record<string, unknown>;
      if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
  } catch {
    // Storage blocked or unreadable: the default place.
  }
  return null;
}

function savePlace(place: Place): void {
  try {
    sessionStorage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    // Not remembered; the window still works.
  }
}

/** Top right of the results area, 16 px in. */
function defaultPlace(): Place {
  const origin = workspaceOrigin();
  return { x: origin.left + origin.width - WIDTH - MARGIN, y: origin.top + MARGIN };
}

function readScope(): FindScope {
  try {
    return sessionStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'tab';
  } catch {
    return 'tab';
  }
}

function saveScope(scope: FindScope): void {
  try {
    sessionStorage.setItem(SCOPE_KEY, scope);
  } catch {
    // Not remembered; the window still works.
  }
}

interface Session {
  request: FindWindowRequest;
  /** Bumps on every `openFindWindow`, so a second Cmd/Ctrl+F reaches an open window. */
  nonce: number;
  /** The request named a tab: the window is scoped to it. A bare shortcut press leaves the scope alone. */
  scoped: boolean;
}

/**
 * The floating find window (spec §13.1): one for the whole app, mounted in the layout. Closed it
 * renders nothing; `openFindWindow` (Cmd/Ctrl+F, a reading toolbar's magnifier) opens it.
 */
export function FindWindow() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(
    () =>
      subscribeFindWindow((command) => {
        if (command.type === 'close') {
          setSession(null);
          return;
        }
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const { type: _type, ...request } = command;
        void _type;
        setSession((previous) => {
          const scoped = request.tabId !== undefined;
          const returnFocus = request.returnFocus ?? previous?.request.returnFocus ?? (previous ? null : active);
          return {
            request: scoped || !previous ? { ...request, returnFocus } : { ...previous.request, returnFocus },
            nonce: (previous?.nonce ?? 0) + 1,
            scoped,
          };
        });
      }),
    [],
  );

  const close = useCallback(() => setSession(null), []);
  if (!session) return null;
  return createPortal(<FindWindowBody session={session} onClose={close} />, document.body);
}

const SCOPE_BUTTON =
  'rounded-md px-2 py-1 text-xs transition-colors min-h-[44px] md:min-h-0 ' + FOCUS_RING;

function FindWindowBody({ session, onClose }: { session: Session; onClose: () => void }) {
  const isDesktop = useIsDesktop();
  const [query, setQuery] = useState('');
  const [scope, setScopeState] = useState<FindScope>(readScope);
  const [prefer, setPrefer] = useState<{ tabId: string; targetKey?: string } | null>(null);
  const [restartTick, setRestartTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const revealTab = useAppStore((s) => s.revealTab);
  const front = useAppStore((s) => computeFrontTabId(s, isDesktop));

  const find = useFindWindow({ query, scope, open: true, prefer });
  const restartRef = useRef(find.restart);
  useEffect(() => {
    restartRef.current = find.restart;
  });

  const setScope = (next: FindScope) => {
    setScopeState(next);
    saveScope(next);
  };

  // Every open request: scope to the named tab (raising it, so «Questa scheda» is that tab) and
  // take its first match; always focus the field and select what it holds, as a browser does.
  const { nonce, scoped, request } = session;
  useEffect(() => {
    if (scoped && request.tabId !== undefined) {
      setScope('tab');
      setPrefer({ tabId: request.tabId, targetKey: request.targetKey });
      revealTab(request.tabId);
      setRestartTick((n) => n + 1);
    }
    inputRef.current?.focus();
    inputRef.current?.select();
    // Only a new request re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  // Declared after the effect above: the hook has the new scope and workspace by the time it restarts.
  useEffect(() => {
    if (restartTick > 0) restartRef.current();
  }, [restartTick]);

  // What the magnifiers read for `aria-pressed`.
  useEffect(() => {
    reportFindWindowScope(scope === 'tab' ? front : null);
  }, [scope, front]);
  useEffect(() => () => reportFindWindowScope(null), []);

  const close = () => {
    onClose();
    const target = request.returnFocus;
    if (target?.isConnected) target.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    // An open discussion panel or citation preview closes on Esc at the document: this Esc is the window's.
    e.stopPropagation();
    close();
  };

  const onFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.shiftKey) find.previous();
    else find.next();
  };

  // The place: stored for the session, clamped on open and on resize.
  const [place, setPlace] = useState<Place>(() => clampPlace(readPlace() ?? defaultPlace()));
  const placeRef = useRef(place);
  const moveTo = useCallback((next: Place) => {
    placeRef.current = next;
    setPlace(next);
  }, []);
  useEffect(() => {
    const onResize = () => moveTo(clampPlace(placeRef.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [moveTo]);

  const dragOffset = useRef<Place | null>(null);
  const onHandleDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragOffset.current = { x: e.clientX - placeRef.current.x, y: e.clientY - placeRef.current.y };
  };
  const onHandleMove = (e: PointerEvent<HTMLButtonElement>) => {
    const offset = dragOffset.current;
    if (offset) moveTo(clampPlace({ x: e.clientX - offset.x, y: e.clientY - offset.y }));
  };
  const onHandleUp = () => {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    savePlace(placeRef.current);
  };
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const delta: Record<string, Place> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const move = delta[e.key];
    if (!move) return;
    e.preventDefault();
    const next = clampPlace({ x: placeRef.current.x + move.x, y: placeRef.current.y + move.y });
    moveTo(next);
    savePlace(next);
  };

  const tabLabel = useAppStore((s) => s.workspaceTabs.find((t) => t.id === find.current?.tabId)?.label);
  const where = scope === 'all' && find.current
    ? [tabLabel && tabLabel !== find.current.label ? tabLabel : null, find.current.label].filter(Boolean).join(' · ')
    : '';

  const button = isDesktop ? ICON_BUTTON : cn(ICON_BUTTON, 'min-h-[44px] min-w-[44px]');

  return (
    <div
      role="search"
      aria-label="Cerca nel testo"
      data-testid="find-window"
      onKeyDown={onKeyDown}
      style={isDesktop ? { left: place.x, top: place.y, width: WIDTH } : undefined}
      className={cn(
        'fixed border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900',
        Z_INDEX.findWindow,
        isDesktop ? 'rounded-xl' : 'inset-x-0 top-0 w-full border-x-0 border-t-0',
      )}
    >
      <div className="flex flex-wrap items-center gap-1 px-1.5 pt-1.5">
        {isDesktop && (
          <button
            type="button"
            aria-label="Sposta la finestra di ricerca"
            title="Sposta la finestra di ricerca"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            onKeyDown={onHandleKey}
            className={cn('cursor-grab touch-none rounded-md p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing dark:hover:bg-slate-800', FOCUS_RING)}
          >
            <GripVertical size={16} aria-hidden />
          </button>
        )}
        <input
          ref={inputRef}
          type="text"
          role="searchbox"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFieldKeyDown}
          aria-label="Cerca nel testo"
          placeholder="Cerca nel testo"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'min-w-0 rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:text-slate-100',
            isDesktop ? 'flex-1' : 'min-h-[44px] w-full basis-full',
            FOCUS_RING,
          )}
        />
        <span role="status" aria-live="polite" className={cn('whitespace-nowrap px-1 text-xs text-slate-500 dark:text-slate-400', !isDesktop && 'flex-1')}>
          {counterText(find)}
        </span>
        <button type="button" onClick={find.previous} aria-label="Risultato precedente" title="Risultato precedente" className={button}>
          <ChevronUp size={16} aria-hidden />
        </button>
        <button type="button" onClick={find.next} aria-label="Risultato successivo" title="Risultato successivo" className={button}>
          <ChevronDown size={16} aria-hidden />
        </button>
        <button type="button" onClick={close} aria-label="Chiudi la ricerca" title="Chiudi la ricerca" className={button}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 pb-1.5 pt-1">
        <div role="group" aria-label="Dove cercare" className="inline-flex rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
          {([['tab', 'Questa scheda'], ['all', 'Tutte le schede']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={cn(
                SCOPE_BUTTON,
                scope === value
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-slate-900 dark:text-primary-400'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {where && (
          <span data-testid="find-where" className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400" title={where}>
            {where}
          </span>
        )}
      </div>
    </div>
  );
}
