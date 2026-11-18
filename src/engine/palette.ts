// A deck palette from pictures. The UI samples pictures into plain [r, g, b] pixels (on a canvas, in src/ui); everything
// here is arithmetic on those numbers: the same pixels, in any order, always give the same swatches and the same
// proposals. No DOM, no clock, no dice.
import { DARK_INK, cardInkFor } from './deckData';

export type RGB = [number, number, number];
export interface Swatch { rgb: RGB; hex: string; count: number; share: number }   // share: 0 to 1 of the pixels read
export interface ThemeColors { bg: string; ink: string; accent: string; accent2: string; muted: string; card: string }
export interface Proposal { id: 'night' | 'paper' | 'dusk'; label: string; colors: ThemeColors; suggestedAccent?: true }

// ---------- colour arithmetic ----------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const hexOf = (c: RGB): string => `#${c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
/** Red, green, blue of a #rgb or #rrggbb colour; null for anything else. */
export function rgbOf(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminanceOf(c: RGB): number {
  const [r, g, b] = c.map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** The WCAG contrast ratio of two hex colours, 1 to 21; 0 when either is not a hex colour. */
export function contrast(a: string, b: string): number {
  const x = rgbOf(a), y = rgbOf(b);
  if (!x || !y) return 0;
  const la = luminanceOf(x), lb = luminanceOf(y);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Hue 0 to 360, saturation and lightness 0 to 1. */
export function toHsl(c: RGB): [number, number, number] {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, clamp(s, 0, 1), l];
}
export function fromHsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t) as RGB;
const chroma = (c: RGB) => (Math.max(...c) - Math.min(...c)) / 255;
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** `a` with `t` (0 to 1) of `b` mixed in, the way the deck's runtime mixes colours (channel by channel, rounded). */
export const mixHex = (a: string, b: string, t: number): string => { const x = rgbOf(a), y = rgbOf(b); return x && y ? hexOf(mix(x, y, clamp(t, 0, 1))) : a; };

/** `color`, moved only as far as it takes to reach `min` contrast on `on` (one surface, or several: the worst of them
 *  counts). Always a six-digit lower-case hex: a colour that already passes comes back as that, otherwise unchanged
 *  in hue and saturation with its lightness stepped, a hundredth at a time, toward whichever end (white or black)
 *  reads better on the surfaces, and if that end cannot get there, toward the other. When nothing reaches `min`
 *  (a mid grey asked for 7:1) the answer is the end that reads best. Anything that is not a hex colour comes back as given. */
export function reach(color: string, on: string | string[], min: number): string {
  const c = rgbOf(color); const surfaces = (Array.isArray(on) ? on : [on]).filter(s => !!rgbOf(s));
  if (!c || !surfaces.length) return color;
  const worst = (hex: string) => Math.min(...surfaces.map(s => contrast(hex, s)));
  const start = hexOf(c);
  if (worst(start) >= min) return start;
  const [h, s, l] = toHsl(c);
  const walk = (up: boolean): string | null => {
    for (let i = 1; i <= 100; i++) {
      const to = l + (up ? i : -i) / 100;
      const next = hexOf(fromHsl(h, s, clamp(to, 0, 1)));
      if (worst(next) >= min) return next;
      if (to <= 0 || to >= 1) break;
    }
    return null;
  };
  const upFirst = worst('#ffffff') >= worst('#000000');
  return walk(upFirst) ?? walk(!upFirst) ?? (upFirst ? '#ffffff' : '#000000');
}

// ---------- pixels → swatches (median cut) ----------

const MAX_PIXELS = 20000;
const byChannel = (ch: number) => (a: RGB, b: RGB) => a[ch] - b[ch] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The picture's colours as at most `k` swatches, the most common first. Median cut: the box of pixels with the widest
 *  spread is cut in two at its median, again and again. Pixels are sorted before every cut, so their order going in
 *  does not matter; anything that is not three finite numbers is skipped. */
export function quantize(pixels: RGB[], k = 8): Swatch[] {
  let px = (Array.isArray(pixels) ? pixels : []).filter(p => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(v => typeof v === 'number' && Number.isFinite(v)))
    .map(p => [clamp(Math.round(p[0]), 0, 255), clamp(Math.round(p[1]), 0, 255), clamp(Math.round(p[2]), 0, 255)] as RGB);
  if (!px.length) return [];
  px.sort(byChannel(0));
  if (px.length > MAX_PIXELS) { const step = px.length / MAX_PIXELS; px = Array.from({ length: MAX_PIXELS }, (_, i) => px[Math.floor(i * step)]); }
  const spread = (box: RGB[]) => {
    let best = 0, ch = 0;
    for (let c = 0; c < 3; c++) { let lo = 255, hi = 0; for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; } if (hi - lo > best) { best = hi - lo; ch = c; } }
    return { range: best, ch };
  };
  const boxes: RGB[][] = [px];
  const want = clamp(Math.round(k) || 0, 1, 32);
  while (boxes.length < want) {
    let pick = -1, score = 0, at = 0;
    boxes.forEach((box, i) => { const s = spread(box); const v = s.range * box.length; if (box.length > 1 && s.range > 0 && v > score) { score = v; pick = i; at = s.ch; } });
    if (pick < 0) break;   // every box is one flat colour
    const box = boxes[pick].slice().sort(byChannel(at));
    // cut between two different values, as near the middle as there is one
    let cut = Math.floor(box.length / 2);
    if (box[cut][at] === box[cut - 1][at]) {
      let up = cut, down = cut;
      while (up < box.length && box[up][at] === box[up - 1][at]) up++;
      while (down > 0 && box[down][at] === box[down - 1][at]) down--;
      cut = down > 0 && (up >= box.length || cut - down <= up - cut) ? down : up;
    }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }
  const total = px.length;
  return boxes.map(box => {
    const sum = box.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]] as RGB, [0, 0, 0] as RGB);
    const rgb = sum.map(v => Math.round(v / box.length)) as RGB;
    return { rgb, hex: hexOf(rgb), count: box.length, share: box.length / total };
  }).sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0));
}

// ---------- swatches → proposals ----------

// The deck's runtime moves any text colour that falls short of 4.5:1 on the page, or on the faint panels it draws
// over the page (the page with 7% of the ink mixed in). A proposal meets the same test on both, so what the builder
// shows is what the deck draws.
export const MIN_INK = 7, MIN_TEXT = 4.5, MIN_CARD_TEXT = 7, MIN_CARD_EDGE = 1.1;
export const PANEL_MIX = 0.07;
const NIGHT = 0.03, PAPER = 0.8;                    // how dark the night ground is, how light the paper: room for every text colour
const DUSK_DARK: [number, number] = [0.045, 0.07];  // the dusk ground when it comes from a dark colour: a step up from night
const DUSK_PALE: [number, number] = [0.62, 0.72];   // and when it comes from a light one: a step down from paper
const COLOURLESS = 0.12;                            // a picture whose strongest colour has less chroma than this has no accent to give
const WARM: RGB = [227, 137, 28];                   // the accent suggested for a picture with no colour of its own
const SAND: RGB = [226, 214, 190];                  // what a card is warmed with on a ground too near white to be lighter than

/** The surfaces the deck's text sits on for a page colour and its ink: the page, and the faint panel over it. */
export const textSurfaces = (bg: string, ink: string): string[] => [bg, mixHex(bg, ink, PANEL_MIX)];

/** A colour with its lightness moved until its luminance is inside `band`; hue kept, saturation capped at `maxSat`,
 *  lightness at `maxL` (a blue is still dark by luminance at a lightness where it plainly reads as blue). */
function ground(c: RGB, band: [number, number], maxSat: number, maxL = 1): RGB {
  const [h, s0, l0] = toHsl(c); const s = Math.min(s0, maxSat);
  let l = Math.min(l0, maxL), out = fromHsl(h, s, l);
  for (let i = 0; i < 200; i++) {
    const lum = luminanceOf(out);
    if (lum > band[1]) l = clamp(l - 0.005, 0, 1); else if (lum < band[0] && l < maxL) l = clamp(l + 0.005, 0, maxL); else break;
    out = fromHsl(h, s, l);
  }
  return out;
}
const byHex = (a: Swatch, b: Swatch) => (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0);
const significant = (sw: Swatch[]): Swatch[] => { const big = sw.filter(s => s.share >= 0.01); return big.length ? big : sw; };

/** True when the pictures have almost no colour: nothing in them is strong enough to be an accent. */
export function colourless(swatches: Swatch[]): boolean {
  const sw = (Array.isArray(swatches) ? swatches : []).filter(s => s && Array.isArray(s.rgb));
  return sw.length > 0 && Math.max(...significant(sw).map(s => chroma(s.rgb))) < COLOURLESS;
}

/** The swatch each ground is taken from. Night: the darkest of the dominant swatches. Paper: the lightest of them.
 *  Dusk: the second most common colour (the most common, when night already took the second); none when the picture
 *  is one colour. Dominant: an eighth of the picture or more, and always the three most common. */
function sources(sw: Swatch[]): { night: Swatch; paper: Swatch; dusk: Swatch | null } {
  const dominant = sw.filter((s, i) => i < 3 || s.share >= 0.125);
  const byLum = [...dominant].sort((a, b) => luminanceOf(a.rgb) - luminanceOf(b.rgb) || byHex(a, b));
  const night = byLum[0], paper = byLum[byLum.length - 1];
  const dusk = sw.length < 2 ? null : sw[1] !== night ? sw[1] : sw[0];
  return { night, paper, dusk };
}

function build(sw: Swatch[], bgRgb: RGB): ThemeColors {
  const bg = hexOf(bgRgb); const dark = luminanceOf(bgRgb) < 0.18;
  const byLum = [...sw].sort((a, b) => luminanceOf(a.rgb) - luminanceOf(b.rgb) || byHex(a, b));
  const darkest = byLum[0].rgb, lightest = byLum[byLum.length - 1].rgb;

  // ink: near-white on a dark ground, near-black on a light one, tinted with the picture's own lightest or darkest colour
  const ink = reach(hexOf(dark ? ground(lightest, [0.85, 1], 0.2) : ground(darkest, [0, 0.02], 0.4)), bg, MIN_INK);
  const inkRgb = rgbOf(ink)!;
  const on = textSurfaces(bg, ink);

  // accents: the most colourful swatch (a little weight for how much of the picture it is), then the next with a hue
  // of its own. A picture with no colour gets a warm accent of ours, and a quiet neutral beside it.
  const pool = significant(sw);
  const score = (s: Swatch) => chroma(s.rgb) * (0.5 + Math.min(s.share, 0.2) * 2.5);
  const ranked = [...pool].sort((a, b) => score(b) - score(a) || byHex(a, b));
  const grey = colourless(sw);
  const first = grey ? WARM : ranked[0].rgb;
  const firstHue = toHsl(first)[0];
  const second = grey ? undefined : ranked.slice(1).find(s => chroma(s.rgb) >= COLOURLESS && hueGap(toHsl(s.rgb)[0], firstHue) >= 35);
  const accent = reach(hexOf(first), on, MIN_TEXT);
  const accent2 = reach(hexOf(second ? second.rgb : grey ? mix(inkRgb, bgRgb, 0.2) : mix(first, inkRgb, 0.5)), on, MIN_TEXT);   // one colour only: a tint between the accent and the ink
  const muted = reach(hexOf(mix(inkRgb, bgRgb, 0.42)), on, MIN_TEXT);

  // card: paper, with dark ink on it. On a dark ground, the picture's lightest colour. On a light ground, lighter than
  // the ground; and when the ground is too near white for that, a shade warmer and deeper, until the edge can be seen.
  let card: string;
  if (dark) card = hexOf(ground(lightest, [0.72, 1], 0.3));
  else {
    card = hexOf(mix(bgRgb, [255, 255, 255], 0.65));
    for (let t = 0.45; contrast(card, bg) < MIN_CARD_EDGE && t <= 1.0001; t += 0.05) card = hexOf(mix(bgRgb, SAND, t));
  }
  return { bg, ink, accent, accent2, muted, card };
}

/** Two or three palettes from a picture's swatches, named for their character: Night (a near-black ground tinted with
 *  the picture's darkest dominant colour), Paper (a near-white one tinted with its lightest) and, when the picture has
 *  more than one colour, Dusk (a deeper tint of its second most common colour: mid-dark from a dark colour, a toned
 *  paper from a light one). A ground is never more than lightly saturated, however loud the picture. Every proposal
 *  passes `checkTheme`, and the deck draws its text colours exactly as proposed. `suggestedAccent` marks a picture
 *  with no colour of its own: the accent is ours, not the picture's. */
export function proposeThemes(swatches: Swatch[]): Proposal[] {
  const sw = (Array.isArray(swatches) ? swatches : []).filter(s => s && Array.isArray(s.rgb));
  if (!sw.length) return [];
  const src = sources(sw); const flag = colourless(sw) ? { suggestedAccent: true as const } : {};
  const out: Proposal[] = [
    { id: 'night', label: 'Night', colors: build(sw, ground(src.night.rgb, [0, NIGHT], 0.35, 0.15)), ...flag },
    { id: 'paper', label: 'Paper', colors: build(sw, ground(src.paper.rgb, [PAPER, 1], 0.3)), ...flag },
  ];
  if (src.dusk) out.push({ id: 'dusk', label: 'Dusk', colors: build(sw, ground(src.dusk.rgb, luminanceOf(src.dusk.rgb) < 0.4 ? DUSK_DARK : DUSK_PALE, 0.4)), ...flag });
  return out;
}

// ---------- the rules, for the proposals and for whatever the author changes by hand ----------

/** One colour against what it sits on. `on` says what is measured, in words; `fix` is which way to move the colour when it fails. */
export interface ThemeCheck { key: keyof ThemeColors; label: string; on: string; ratio: number; min: number; pass: boolean; fix: 'lighter' | 'darker' | '' }
/** Each colour against what it sits on, with the ratio it reaches and the ratio it needs. Text colours are measured on
 *  the page and on the faint panels over it (the lower of the two), as the deck does. The card's own text is the dark
 *  or the light ink, whichever the deck would pick for it. */
export function checkTheme(c: ThemeColors): ThemeCheck[] {
  const on = textSurfaces(c.bg, c.ink).filter(s => !!rgbOf(s));
  const worst = (hex: string) => (on.length && rgbOf(hex) ? Math.min(...on.map(s => contrast(hex, s))) : 0);
  const way: ThemeCheck['fix'] = worst('#ffffff') >= worst('#000000') ? 'lighter' : 'darker';
  const row = (key: keyof ThemeColors, label: string, ratio: number, says: string, min: number, fix: ThemeCheck['fix']): ThemeCheck => { const pass = ratio >= min; return { key, label, on: says, ratio, min, pass, fix: pass ? '' : fix }; };
  const cardInk = cardInkFor(c.card);
  return [
    row('ink', 'Text', contrast(c.ink, c.bg), 'On the background', MIN_INK, way),
    row('accent', 'Accent', worst(c.accent), 'On the background', MIN_TEXT, way),
    row('accent2', 'Second accent', worst(c.accent2), 'On the background', MIN_TEXT, way),
    row('muted', 'Muted', worst(c.muted), 'On the background', MIN_TEXT, way),
    row('card', 'Card', contrast(cardInk, c.card), 'The card\'s own text on it', MIN_CARD_TEXT, cardInk === DARK_INK ? 'lighter' : 'darker'),
    row('bg', 'Background', contrast(c.card, c.bg), 'The card against this background', MIN_CARD_EDGE, ''),
  ];
}

/** Type pairings that need nothing from the network: the three faces the app carries, and stacks every machine has. */
export const TYPE_PAIRINGS: { id: string; label: string; title: string; body: string }[] = [
  { id: 'typewriter', label: 'Typewriter titles, plain text', title: '"Special Elite", "Courier New", monospace', body: '"Work Sans", system-ui, sans-serif' },
  { id: 'plain', label: 'Plain throughout', title: '"Work Sans", system-ui, sans-serif', body: '"Work Sans", system-ui, sans-serif' },
  { id: 'serif-titles', label: 'Serif titles, plain text', title: 'Georgia, "Times New Roman", serif', body: '"Work Sans", system-ui, sans-serif' },
  { id: 'serif', label: 'Serif throughout', title: 'Georgia, "Times New Roman", serif', body: 'Georgia, "Times New Roman", serif' },
  { id: 'mono-titles', label: 'Monospace titles, plain text', title: 'ui-monospace, Menlo, Consolas, "Courier New", monospace', body: '"Work Sans", system-ui, sans-serif' },
  { id: 'hand-titles', label: 'Handwritten titles, plain text', title: '"Caveat", "Segoe Print", cursive', body: '"Work Sans", system-ui, sans-serif' },
];
