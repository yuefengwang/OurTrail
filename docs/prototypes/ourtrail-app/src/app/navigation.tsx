import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { UNSAFE_NavigationContext, useLocation, useNavigate, useNavigationType } from 'react-router';

function appPath(input: string): string {
  if (!input.startsWith('/') || input.startsWith('//') || /[\\\s#]/u.test(input)) return '/';
  const [pathname] = input.split('?');
  // Route identifiers are opaque single segments, never encoded separators or dot paths.
  const id = '[A-Za-z0-9_-]+';
  const allowed = new RegExp(`^/(?:|me|notices|activities/(?:new|${id}(?:/(?:signup|weather|notices|edit|workspace|staff|vehicles/${id}))?))$`);
  return allowed.test(pathname) ? input : '/';
}

type Entry = { key: string; path: string; x: number; y: number };
type AppStack = { entries: Entry[]; index: number };
// A router-owned in-memory stack survives screen unmounts, but never assumes an
// external browser entry is safe merely because history.length or idx is large.
const stacks = new WeakMap<object, AppStack>();
export function useAppNavigation(): { go: (path: string, replace?: boolean) => void; back: () => void } {
  const { navigator } = useContext(UNSAFE_NavigationContext)!;
  const location = useLocation(); const type = useNavigationType(); const navigate = useNavigate();
  let stack = stacks.get(navigator);
  if (!stack) { stack = { entries: [], index: -1 }; stacks.set(navigator, stack); }
  const owned = stack;
  const scroller = () => document.querySelector<HTMLElement>('.app-main');
  const capture = useCallback(() => {
    const entry = owned.entries[owned.index];
    if (!entry) return;
    const el = scroller();
    entry.x = el ? el.scrollLeft : window.scrollX;
    entry.y = el ? el.scrollTop : window.scrollY;
  }, [owned]);
  useLayoutEffect(() => {
    const path = `${location.pathname}${location.search}`;
    const current = owned.entries[owned.index];
    if (current?.key !== location.key || current?.path !== path) {
      const known = owned.entries.findIndex(entry => entry.key === location.key && entry.path === path);
      if (type === 'POP' && known !== -1) owned.index = known;
      else {
        const next = { key: location.key, path, x: 0, y: 0 };
        if (type === 'REPLACE' && owned.index >= 0) owned.entries[owned.index] = next;
        else if (type === 'PUSH' && owned.index >= 0) { owned.entries = owned.entries.slice(0, owned.index + 1); owned.entries.push(next); owned.index += 1; }
        else { owned.entries = [next]; owned.index = 0; }
      }
      const target = owned.entries[owned.index];
      const el = scroller();
      if (el) { el.scrollTop = target.y; el.scrollLeft = target.x; }
      else window.scrollTo(target.x, target.y);
    }
    const onScroll = () => {
      if (owned.entries[owned.index]?.key === location.key) capture();
    };
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => { document.removeEventListener('scroll', onScroll, { capture: true }); };
  }, [capture, location.key, location.pathname, location.search, owned, type]);
  const go = useCallback((path: string, replace = false) => {
    capture();
    afterOverlaysClose(() => { void navigate(appPath(path), { replace }); });
  }, [capture, navigate]);
  const back = useCallback(() => {
    if (closeTopOverlay()) return;
    capture();
    if (owned.index > 0) void navigate(-1);
    else void navigate('/', { replace: true });
  }, [capture, navigate, owned]);
  return { go, back };
}

const OVERLAY_KEY = '__ourtrailOverlay';
type OverlayEntry = { token: string; active: boolean; pushed: boolean; close: () => void };
let overlays: OverlayEntry[] = [];
let pendingBack: OverlayEntry | null = null;
let listening = false;
let sequence = 0;
const afterClose: Array<() => void> = [];
function marker(state: unknown): string | undefined {
  return state !== null && typeof state === 'object' ? (state as Record<string, string>)[OVERLAY_KEY] : undefined;
}
function pushOverlay(entry: OverlayEntry) {
  const state = window.history.state;
  // Copy, rather than replace, React Router's idx/key/usr fields. The modal is
  // not a new router location and keeps the exact URL and router location key.
  window.history.pushState({ ...(state && typeof state === 'object' ? state : {}), [OVERLAY_KEY]: entry.token }, '', window.location.href);
  entry.pushed = true;
}
function drainOverlays() {
  if (pendingBack) return;
  overlays = overlays.filter(entry => entry.active || entry.pushed);
  const top = overlays.filter(entry => entry.pushed).at(-1);
  if (top && !top.active) {
    if (marker(window.history.state) === top.token) {
      pendingBack = top; window.history.back(); return;
    }
    // A foreign navigation has already left this entry. Never back over it.
    overlays = overlays.filter(entry => entry !== top);
    drainOverlays(); return;
  }
  for (const entry of overlays) if (entry.active && !entry.pushed) pushOverlay(entry);
  if (!overlays.length) {
    if (listening) { window.removeEventListener('popstate', onOverlayPop); listening = false; }
    afterClose.splice(0).forEach(action => action());
  }
}
function onOverlayPop(event: PopStateEvent) {
  const current = marker(event.state);
  const pushed = overlays.filter(entry => entry.pushed);
  const keep = pushed.findIndex(entry => entry.token === current);
  const removed = pushed.slice(keep + 1);
  overlays = overlays.filter(entry => !removed.includes(entry));
  pendingBack = null;
  for (const entry of removed) {
    if (entry.active) { entry.active = false; entry.close(); }
  }
  drainOverlays();
}
function acquireOverlay(previous: OverlayEntry | null, close: () => void): OverlayEntry {
  const entry = previous && overlays.includes(previous) && previous !== pendingBack ? previous
    : { token: `ourtrail-modal-${++sequence}`, active: true, pushed: false, close };
  entry.active = true; entry.close = close;
  if (!overlays.includes(entry)) overlays.push(entry);
  if (!listening) { window.addEventListener('popstate', onOverlayPop); listening = true; }
  // Reacquiring one StrictMode lease must not consume a sibling whose setup
  // has not replayed yet. Only cleanup's microtask may initiate traversal.
  if (!entry.pushed && !pendingBack && !overlays.some(item => item.pushed && !item.active)) pushOverlay(entry);
  else queueMicrotask(drainOverlays);
  return entry;
}
function releaseOverlay(entry: OverlayEntry) {
  entry.active = false;
  // StrictMode setup/cleanup/setup reactivates the same entry before this task.
  // Delaying only cleanup also serializes a reopen with an outstanding back().
  queueMicrotask(() => { if (!entry.active) drainOverlays(); });
}
function closeTopOverlay(): boolean {
  const top = overlays.filter(entry => entry.active).at(-1);
  if (!top) return pendingBack !== null;
  top.active = false; top.close(); drainOverlays(); return true;
}
function afterOverlaysClose(action: () => void) {
  if (!overlays.length && !pendingBack) { action(); return; }
  afterClose.push(action);
  for (const entry of overlays) {
    if (entry.active) { entry.active = false; entry.close(); }
  }
  drainOverlays();
}

/** Works independently of Router, including primitive Overlay tests. */
export function useOverlayHistory(open: boolean, onClose: () => void): void {
  const close = useRef(onClose); close.current = onClose;
  const entry = useRef<OverlayEntry | null>(null);
  useEffect(() => {
    if (!open) return;
    const acquired = acquireOverlay(entry.current, () => close.current());
    entry.current = acquired;
    return () => releaseOverlay(acquired);
  }, [open]);
}
