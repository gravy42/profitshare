// Getting around the Pitch tab: the panels have ids, and a link anywhere on the tab can scroll to one and put the
// keyboard there.
export const PANEL = {
  write: 'pitch-write', comps: 'pitch-comps', revenue: 'pitch-revenue', lookbook: 'pitch-lookbook', design: 'pitch-design', team: 'pitch-team',
  deck: 'pitch-deck', people: 'pitch-people', send: 'pitch-send', report: 'pitch-report', ai: 'pitch-ai',
} as const;
export type PanelKey = keyof typeof PANEL;

const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Scrolls to an element by id and focuses it, or the first thing inside it that matches `focus`. */
export function goToId(id: string, focus?: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const target = (focus ? el.querySelector<HTMLElement>(focus) : null) ?? el;
  if (target === el && !el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
}
export const goToPanel = (key: PanelKey, focus?: string): void => goToId(PANEL[key], focus);

/** Focuses the first element that matches, once the page has drawn what was just asked for. */
export function focusSoon(selector: string, scroll = true): void {
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.focus({ preventScroll: !scroll });
    if (scroll) el.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' });
  }, 80);
}

/** The Undo shortcut as this machine's keyboard has it. */
export const UNDO_KEY: string = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘Z' : 'Ctrl+Z';
