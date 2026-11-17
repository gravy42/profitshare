// Movement, as a fixed vocabulary. A deck never carries code or styles for how it moves: only words from the short
// lists below and a few numbers, and `cleanMotion()` is the one door they come through. Whatever is not a word on a
// list is dropped; every number is clamped. Shared by the runtime (which turns the words into classes) and the
// engine (which writes them into the deck's data). Pure: no DOM, no imports but types.
import type { DeckMotion, SlideMotion } from './data';

export const DECK_PACES = ['calm', 'brisk'] as const;
export const DECK_ENTRANCES = ['rise', 'fade', 'none'] as const;
export const ENTRANCES = ['rise', 'fade', 'drop', 'slide-left', 'slide-right', 'none'] as const;
export const ORDERS = ['together', 'one-by-one', 'reverse'] as const;
export const HEADLINES = ['none', 'type'] as const;
export const MARKER_PATHS = ['line', 'timeline'] as const;
export const MARKER_ENDS = ['stop', 'settle'] as const;
export const STAGGER_MAX = 400;                      // milliseconds between one part and the next
export const MARKER_SIZE_MIN = 0.5, MARKER_SIZE_MAX = 2;
const ID_MAX = 200;

/** The layouts a travelling picture has a line to travel along, and which line that is. */
export const markerPathOf = (layout: unknown): 'line' | 'timeline' | null =>
  (layout === 'cards' || layout === 'ways' ? 'line' : layout === 'timeline' ? 'timeline' : null);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const oneOf = <T extends string>(v: unknown, words: readonly T[]): T | undefined => (typeof v === 'string' && (words as readonly string[]).includes(v) ? (v as T) : undefined);
const clamp = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);

/** A slide's movement with everything that is not in the vocabulary taken out; undefined when nothing is left.
 *  With `layout`, a travelling picture is kept only on a slide that has a line for it, on that line. */
export function cleanMotion(raw: unknown, layout?: unknown): SlideMotion | undefined {
  if (!isObj(raw)) return undefined;
  const out: SlideMotion = {};
  const entrance = oneOf(own(raw, 'entrance'), ENTRANCES); if (entrance) out.entrance = entrance;
  const order = oneOf(own(raw, 'order'), ORDERS); if (order) out.order = order;
  const stagger = clamp(own(raw, 'stagger'), 0, STAGGER_MAX); if (stagger !== undefined) out.stagger = Math.round(stagger);
  if (own(raw, 'headline') === 'type') out.headline = 'type';
  if (own(raw, 'count') === true) out.count = true;
  const m = own(raw, 'marker');
  if (isObj(m)) {
    const imageId = own(m, 'imageId');
    const path = layout === undefined ? oneOf(own(m, 'path'), MARKER_PATHS) ?? 'line' : markerPathOf(layout);
    if (typeof imageId === 'string' && imageId.trim() && imageId.length <= ID_MAX && path) {
      out.marker = { imageId, path, end: oneOf(own(m, 'end'), MARKER_ENDS) ?? 'stop' };
      const size = clamp(own(m, 'size'), MARKER_SIZE_MIN, MARKER_SIZE_MAX);
      const rounded = size === undefined ? 1 : Math.round(size * 100) / 100;   // rounded first, so cleaning twice gives what cleaning once gave
      if (rounded !== 1) out.marker.size = rounded;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** The whole deck's movement: a pace and how parts arrive. Undefined for anything that is not an object. */
export function cleanDeckMotion(raw: unknown): DeckMotion | undefined {
  if (!isObj(raw)) return undefined;
  return { pace: oneOf(own(raw, 'pace'), DECK_PACES) ?? 'calm', entrance: oneOf(own(raw, 'entrance'), DECK_ENTRANCES) ?? 'rise' };
}
