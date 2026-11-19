// The two checks a font file passes before it goes anywhere near a stylesheet. Shared by the runtime (which
// registers the faces) and the engine (which writes them into the deck's data). Pure: no DOM, no imports.

/** A font file as a data URL, base64 only: `data:font/...` or `data:application/(font-|x-font-|octet-stream)`. Nothing that could reach the network. */
const FONT_SRC =
  /^data:(font\/[a-z0-9.+-]+|application\/(font-[a-z0-9.+-]+|x-font-[a-z0-9.+-]+|octet-stream));base64,[a-z0-9+/]+=*$/i;
export const fontSrcOk = (src: unknown): src is string => typeof src === 'string' && FONT_SRC.test(src);

/** A family name with everything but letters, digits, spaces and hyphens taken out; at most 60 characters. */
export const cleanFamily = (name: unknown): string =>
  (typeof name === 'string' ? name : '')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();

export const MAX_FONT_FACES = 8; // a regular, a bold and an italic for each of the two roles, and room to spare
export type FaceWeight = number | [number, number];
/** A face's weight as a stylesheet can take it: a whole number from 1 to 1000, or two of them (the lightest and the
 *  heaviest a variable file holds). Anything else is no weight at all. */
export function cleanWeight(raw: unknown): FaceWeight | undefined {
  const one = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(1000, Math.max(1, Math.round(v))) : undefined;
  if (Array.isArray(raw)) {
    if (raw.length !== 2) return undefined;
    const a = one(raw[0]),
      b = one(raw[1]);
    if (a === undefined || b === undefined) return undefined;
    return a === b ? a : [Math.min(a, b), Math.max(a, b)];
  }
  return one(raw);
}
/** The weight as a descriptor: "400", or "100 900" for a variable file. */
export const weightText = (w: FaceWeight): string => (typeof w === 'number' ? String(w) : `${w[0]} ${w[1]}`);
export const cleanStyle = (raw: unknown): 'normal' | 'italic' | undefined =>
  raw === 'italic' || raw === 'normal' ? raw : undefined;
/** The handwriting face a deck's papers can be written in (the app carries it, in one weight), and that weight. */
export const HAND_FAMILY = 'Caveat',
  HAND_WEIGHT = 600;
const hashes = new Map<string, string>(); // a file's address is long: its hash is worked out once
/** A short fingerprint of a string (FNV-1a, base 36): the same text always gives the same six or seven characters. */
export function shortHash(text: string): string {
  const known = hashes.get(text);
  if (known) return known;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const out = (h >>> 0).toString(36);
  if (hashes.size >= 16) hashes.clear();
  hashes.set(text, out);
  return out;
}
/** The name a face is registered under. Faces are registered on the whole document, so the name is the deck's own
 *  (never one a page already has) and is different for each role and each file: a title and a body file that share a
 *  family name, or two decks with different files under one name, never get each other's letters. */
export const faceName = (role: 'title' | 'body', family: string, src: string): string =>
  `psd-${role} ${family} ${shortHash(src)}`;
/** The one name the weights of a family are registered under for a role (a regular, a bold, an italic: the browser
 *  chooses among them by weight and style, so they must share a name). It carries a fingerprint of every file. */
export const familyFaceName = (role: 'title' | 'body', family: string, srcs: string[]): string =>
  `psd-${role} ${family} ${shortHash(srcs.map(shortHash).join('.'))}`;
