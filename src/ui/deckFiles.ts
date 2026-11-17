// Reading the files the Pitch tab's deck tools take: a font file into a data URL, a picture into pixels for the
// palette. Everything that needs a browser (FileReader, canvas) is here; the rules are in the engine.
import type { FontFile } from '../engine/types';
import type { RGB } from '../engine/palette';
import { FONT_MAX_BYTES, familyFromFileName, fileSize, fontMime } from '../engine/deckEdit';

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A font file read for one role. Throws, in words for the page, when the file is not a font or is too big to carry. */
export async function readFontFile(file: File, role: FontFile['role']): Promise<FontFile> {
  if (file.size > FONT_MAX_BYTES) throw new Error(`${file.name} is ${fileSize(file.size)}, which is too big to carry in a deck. Look for a .woff2 of the same font.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = fontMime(bytes);
  if (!mime) throw new Error(`${file.name} is not a font file this can read. It takes .woff2, .woff, .ttf and .otf.`);
  const id = `font_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return { id, role, family: familyFromFileName(file.name), dataUrl: `data:${mime};base64,${base64(bytes)}`, embedOk: false };
}

/** A picture as pixels: drawn down to `size` px on its long side, every pixel that is not see-through. */
export async function pixelsOf(src: string | Blob, size = 64): Promise<RGB[]> {
  let source: CanvasImageSource, w: number, h: number, done = () => { /* nothing to free */ };
  if (typeof src === 'string') {
    const img = new Image();
    img.src = src;
    await img.decode();
    source = img; w = img.naturalWidth; h = img.naturalHeight;
  } else {
    const bmp = await createImageBitmap(src);
    source = bmp; w = bmp.width; h = bmp.height; done = () => bmp.close();
  }
  if (!(w > 0) || !(h > 0)) { done(); return []; }
  const scale = Math.min(1, size / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) { done(); return []; }
  ctx.drawImage(source, 0, 0, cw, ch);
  done();
  const d = ctx.getImageData(0, 0, cw, ch).data;
  const out: RGB[] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) out.push([d[i], d[i + 1], d[i + 2]]);
  return out;
}

/** A data URL as a blob: URL, so a preview that is redrawn often does not decode megabytes of base64 each time. */
export function blobUrlOf(dataUrl: string): string | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: m[1] }));
  } catch { return null; }
}
