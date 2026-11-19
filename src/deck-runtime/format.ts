// Number formatting for the deck. Intl only; no engine imports. The locale is fixed so that a deck reads the
// same on every reader's machine (the figures are part of the document, not of the reader's settings).
const LOCALE = 'en-US';
const NONE = '—'; // what a number that is not a number prints as

/** Whole units; anything under half a unit either way is nothing, so "-$0" can never print. */
const whole = (n: number) => Math.round(Math.abs(n) < 0.5 ? 0 : n) || 0;

function moneyFormat(currency: string): Intl.NumberFormat | null {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  } catch {
    return null;
  }
}
const plain = (v: number) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, useGrouping: true }).format(v);

interface MoneyPart {
  text: string;
  symbol?: boolean;
}

/** A money amount in pieces, the currency symbol marked, so the deck can set the symbol in another typeface. */
export function moneyParts(n: number, currency: string): MoneyPart[] {
  if (typeof n !== 'number' || !Number.isFinite(n)) return [{ text: NONE }];
  const v = whole(n);
  const code = typeof currency === 'string' ? currency : '';
  const f = moneyFormat(code);
  if (!f) return [...(code ? [{ text: `${code} ` }] : []), { text: plain(v) }];
  const out: MoneyPart[] = [];
  for (const p of f.formatToParts(v)) {
    const symbol = p.type === 'currency';
    const last = out[out.length - 1];
    if (last && !!last.symbol === symbol) last.text += p.value;
    else out.push(symbol ? { text: p.value, symbol } : { text: p.value });
  }
  return out;
}

/** "$627,758": whole units of the deck's currency. A code Intl does not know falls back to "XYZ 627,758". */
export function money(n: number, currency: string): string {
  return moneyParts(n, currency)
    .map(p => p.text)
    .join('');
}

/** "8.0x": a multiple, one decimal. Never "-0.0x", never exponent notation: past 999 it reads "999x+". */
export function multiple(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return NONE;
  const r = Math.round(n * 10) / 10 || 0; // "|| 0" turns -0 into 0
  if (Math.abs(r) >= 1000) return `${r < 0 ? '-' : ''}999x+`;
  return `${r.toFixed(1)}x`;
}

/** "23%": a share given as a fraction of one. */
export function percent(fraction: number): string {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return NONE;
  return `${Math.round(fraction * 100) || 0}%`;
}

/** Whole percentages for a list of amounts that always total 100 (largest remainder), or all zero when nothing is positive. */
export function shares100(amounts: number[]): number[] {
  const a = amounts.map(x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0));
  const total = a.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return a.map(() => 0);
  const exact = a.map(x => (x / total) * 100);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((p, q) => q.r - p.r || p.i - q.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}
