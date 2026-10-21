/** The look: Night (the film's own, midnight and periwinkle), Day (paper and ink), or follow the system.
 *  Stored in the browser; applied as data-theme on <html> so the CSS tokens switch. "system" removes the
 *  attribute and lets prefers-color-scheme decide. index.html applies the saved choice before React mounts
 *  so the page never flashes the wrong look. */
export type ThemeChoice = 'light' | 'dark' | 'system';
export const THEME_KEY = 'profitshare.theme';
export const THEME_LABELS: Record<ThemeChoice, string> = { dark: 'Night', light: 'Day', system: 'System' };

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch { return 'system'; }
}

export function applyTheme(t: ThemeChoice): void {
  const el = document.documentElement;
  if (t === 'system') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', t);
}

export function saveTheme(t: ThemeChoice): void {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private window: the choice lasts for the session */ }
  applyTheme(t);
}

/** What the viewer actually sees right now, after the system preference is resolved. */
export function resolvedTheme(t: ThemeChoice): 'light' | 'dark' {
  if (t !== 'system') return t;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
