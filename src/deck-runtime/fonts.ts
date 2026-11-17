// The two checks a font file passes before it goes anywhere near a stylesheet. Shared by the runtime (which
// registers the faces) and the engine (which writes them into the deck's data). Pure: no DOM, no imports.

/** A font file as a data URL, base64 only: `data:font/...` or `data:application/(font-|x-font-|octet-stream)`. Nothing that could reach the network. */
const FONT_SRC = /^data:(font\/[a-z0-9.+-]+|application\/(font-[a-z0-9.+-]+|x-font-[a-z0-9.+-]+|octet-stream));base64,[a-z0-9+/]+=*$/i;
export const fontSrcOk = (src: unknown): src is string => typeof src === 'string' && FONT_SRC.test(src);

/** A family name with everything but letters, digits, spaces and hyphens taken out; at most 60 characters. */
export const cleanFamily = (name: unknown): string =>
  (typeof name === 'string' ? name : '').replace(/[^A-Za-z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).trim();

export const MAX_FONT_FACES = 4;
const hashes = new Map<string, string>();   // a file's address is long: its hash is worked out once
/** A short fingerprint of a string (FNV-1a, base 36): the same text always gives the same six or seven characters. */
export function shortHash(text: string): string {
  const known = hashes.get(text);
  if (known) return known;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const out = (h >>> 0).toString(36);
  if (hashes.size >= 16) hashes.clear();
  hashes.set(text, out);
  return out;
}
/** The name a face is registered under. Faces are registered on the whole document, so the name is the deck's own
 *  (never one a page already has) and is different for each role and each file: a title and a body file that share a
 *  family name, or two decks with different files under one name, never get each other's letters. */
export const faceName = (role: 'title' | 'body', family: string, src: string): string => `psd-${role} ${family} ${shortHash(src)}`;
