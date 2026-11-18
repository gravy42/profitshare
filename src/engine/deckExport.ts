// The pure parts of sending a deck: what the files are called, how big a picture goes in, what to say about a file
// that has grown heavy, and a ZIP writer for "Download everything". No DOM, no clock: the browser work (canvas,
// downloads, the PDF) is in src/ui/deckSendFiles.ts and calls these.
import type { DeckImage } from '../deck-runtime/data';
import type { Project } from './types';
import { cleanFamily } from '../deck-runtime/fonts';
import { bundledFacesNeeded } from '../deck-runtime/exportHtml';
import { dataUrlBytes, fileSize } from './deckEdit';
import { deckData, fontFacesOf, slugify } from './deckData';

// ---------- file names ----------

export type AskKind = 'with-grants' | 'without-grants';
export const FILE_NAME_MAX = 120, ENDING_MAX = 60;
const trimmed = (slug: string, max: number) => slug.slice(0, Math.max(0, max)).replace(/-+$/, '');
/** "salt-flat-deck.html", "salt-flat-deck-ada-example.html", "salt-flat-deck-ada-example-without-grants.pdf".
 *  `ending` is a person's link ending (at most 60 characters of it are used); `ask` is given for a PDF when the
 *  project has two asks, and the name then always says which. Never longer than 120 characters: the film's name
 *  gives way first. */
export function deckFileName(film: string, kind: 'html' | 'pdf' | 'zip', opts: { ending?: string; ask?: AskKind } = {}): string {
  const who = kind === 'zip' ? '' : trimmed(slugify(opts.ending ?? ''), ENDING_MAX);
  const tail = kind === 'zip' ? '-deck-files.zip' : `-deck${who ? `-${who}` : ''}${kind === 'pdf' && opts.ask ? `-${opts.ask === 'without-grants' ? 'without' : 'with'}-grants` : ''}.${kind}`;
  return `${trimmed(slugify(typeof film === 'string' ? film : ''), Math.min(60, FILE_NAME_MAX - tail.length)) || 'film'}${tail}`;
}

// ---------- pictures ----------

export const PICTURE_MAX_EDGE = 1600;
export const PICTURE_JPEG_QUALITY = 0.85;
/** The size a picture is drawn at so its long edge is at most `max`: whole pixels, the shape kept, never larger than it is. */
export function fitWithin(width: number, height: number, max = PICTURE_MAX_EDGE): { width: number; height: number; scale: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 0, h = Number.isFinite(height) && height > 0 ? height : 0;
  if (!w || !h) return { width: 0, height: 0, scale: 1 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}
/** What a picture is saved as: PNG only when it is a kind that can be see-through and some of it is; a JPEG otherwise. */
export const pictureFormat = (mime: string, hasAlpha: boolean): 'image/png' | 'image/jpeg' =>
  hasAlpha && !/^image\/jpe?g$/i.test(mime) ? 'image/png' : 'image/jpeg';
/** The kind of picture a data URL says it is ("image/jpeg"), or '' when it is not a picture's data URL. */
export const dataUrlMime = (dataUrl: string): string => /^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(typeof dataUrl === 'string' ? dataUrl.slice(0, 64) : '')?.[1].toLowerCase() ?? '';

// ---------- size ----------

export const HEAVY_FILE_BYTES = 15_000_000;
/** The biggest pictures in a deck, largest first: what to name when a file has grown heavy. */
export function biggestPictures(images: DeckImage[], count = 3): { id: string; label: string; bytes: number }[] {
  return (Array.isArray(images) ? images : [])
    .map((i, at) => ({ id: i.id, label: i.alt && i.alt !== 'Look book picture' ? `"${i.alt}"` : `picture ${at + 1} of the deck`, bytes: dataUrlBytes(i.src) }))
    .sort((a, b) => b.bytes - a.bytes).slice(0, count);
}
/** What to say about a web file of this size, or '' while it is light enough to email. */
export function heavyFileWarning(bytes: number, images: DeckImage[]): string {
  if (!(bytes > HEAVY_FILE_BYTES)) return '';
  const big = biggestPictures(images).filter(p => p.bytes > 0);
  const named = big.length ? ` The biggest pictures in it: ${big.map(p => `${p.label} (${fileSize(p.bytes)})`).join(', ')}.` : '';
  return `This file is ${fileSize(bytes)}. Many mail services refuse attachments over 20 to 25 MB, and a file this size is slow to open on a phone.${named} Use fewer pictures on the slides, or send the PDF.`;
}

// ---------- fonts: what is inside a file, said before it is made ----------

/** Attached font files that are a font, have a name, and whose licence box is not ticked: the preview draws with
 *  them and a sent file leaves them behind. One a role, as the deck reads them. */
export function fontsLeftOut(project: Project): { family: string; role: 'title' | 'body' }[] {
  const all = roleFonts(fontFacesOf(project, false)), sent = roleFonts(fontFacesOf(project, true));
  return all.filter(a => !sent.some(s => s.role === a.role && s.family === a.family));
}
/** The faces as the one font each role has: a family picked from Google Fonts is several files and one font. */
const roleFonts = (faces: { family: string; role: 'title' | 'body' }[]): { family: string; role: 'title' | 'body' }[] =>
  faces.filter((f, i) => faces.findIndex(x => x.role === f.role) === i).map(f => ({ family: f.family, role: f.role }));
/** A role's font in words: "Lato (your body font, from Google Fonts)", "Invented Slab (your title font file)". */
function fontWords(project: Project, f: { family: string; role: 'title' | 'body' }): string {
  const files = project?.pitch?.design?.fontFiles;
  const google = (Array.isArray(files) ? files : []).some(x => !!x && typeof x === 'object' && x.role === f.role && x.source === 'google' && cleanFamily(x.family) === f.family);
  return google ? `${f.family} (your ${f.role} font, from Google Fonts)` : `${f.family} (your ${f.role} font file)`;
}

export interface SendSummary {
  inside: string[];      // the typefaces a sent file carries, in words
  leftOut: string[];     // attached font files that stay behind (their licence box is not ticked)
  twoAsks: boolean;      // the project has grants, so the deck has a smaller and a larger ask
  slides: number;        // the slides a sent deck has (hidden ones are never sent)
}
/** What can be said about the files before any is made. Light: the pictures and the font files are not copied to work it out. */
export function sendSummary(project: Project): SendSummary {
  const pitch = project.pitch;
  const light = deckData({ ...project, pitch: pitch ? { ...pitch, lookbook: [], design: pitch.design ? { ...pitch.design, fontFiles: [] } : pitch.design } : pitch });
  const files = fontFacesOf(project, true);
  const inside: string[] = roleFonts(files).map(f => fontWords(project, f));
  for (const family of new Set(bundledFacesNeeded({ ...light, theme: { ...light.theme, fontFaces: files } }).map(f => f.family))) inside.push(family);
  return { inside, leftOut: fontsLeftOut(project).map(f => fontWords(project, f)), twoAsks: light.paths.sources.some(s => s.key === 'grants'), slides: light.slides.length };
}

// ---------- "Download everything": how big it will be, said before it is made ----------

export const BIG_DOWNLOAD_BYTES = 50_000_000;
export const PDF_SLIDE_BYTES = 180_000;   // a slide captured at 3200 x 1800, about what the sample's come to
/** Roughly how big every file together will be: each web deck about the size of the one that was made, each PDF
 *  its slides plus one copy of every picture a slide uses. */
export function estimateEverything(webDeckBytes: number, webDecks: number, pdfs: number, slides: number, images: DeckImage[]): number {
  const pictures = (Array.isArray(images) ? images : []).reduce((sum, i) => sum + dataUrlBytes(i?.src), 0);
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  return Math.round(n(webDeckBytes) * n(webDecks) + n(pdfs) * (n(slides) * PDF_SLIDE_BYTES + pictures));
}
/** The estimate in words, with a warning when it is over 50 MB. */
export function estimateText(bytes: number, files: number): { text: string; big: boolean } {
  const big = bytes > BIG_DOWNLOAD_BYTES;
  return { big, text: `About ${fileSize(bytes)} in ${files} file${files === 1 ? '' : 's'}.${big ? ' That is a big download: it can take a few minutes to make, and it needs that much free memory in this browser. A file for each person, one at a time, is lighter.' : ''}` };
}

// ---------- a ZIP, stored (no compression): the files in it are already compressed or small ----------

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
/** CRC-32 (the ZIP and PNG one) of some bytes. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array }
/** A date as ZIP writes it. With no date, 1 January 1980 (the format's zero), so the same files always give the same archive. */
function dosStamp(date?: { year: number; month: number; day: number; hour?: number; minute?: number }): { time: number; date: number } {
  if (!date) return { time: 0, date: (1 << 5) | 1 };
  const y = Math.max(1980, Math.min(2107, Math.round(date.year))), mo = Math.max(1, Math.min(12, Math.round(date.month))), d = Math.max(1, Math.min(31, Math.round(date.day)));
  const h = Math.max(0, Math.min(23, Math.round(date.hour ?? 0))), mi = Math.max(0, Math.min(59, Math.round(date.minute ?? 0)));
  return { time: (h << 11) | (mi << 5), date: ((y - 1980) << 9) | (mo << 5) | d };
}
const encoder = new TextEncoder();
export const ZIP_NAME_MAX_BYTES = 255;   // the format holds 65,535; no file system takes more than this
/** A name that is safe inside an archive: no folders, no drive, nothing a file system chokes on; never empty, and at
 *  most 255 bytes as UTF-8 (cut between characters, the extension kept). */
export function zipName(name: string, suffix = ''): string {
  const parts = String(name).split(/[\\/:*?"<>|\u0000-\u001f]+/).map(x => x.trim()).filter(x => x && x !== '.' && x !== '..');
  const clean = parts.join('-').replace(/^\.+/, '') || 'file';
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : '';
  const tail = suffix + ext;   // what a cut never touches: the number that tells two files apart, and the extension
  let stem = [...(ext ? clean.slice(0, dot) : clean)];   // whole characters, so a cut never splits one
  while (stem.length > 1 && encoder.encode(stem.join('') + tail).length > ZIP_NAME_MAX_BYTES) stem = stem.slice(0, -1);
  return stem.join('') + tail;
}

/** A .zip of the files, stored as they are. Names are made safe and, when two are the same, numbered. Sizes are
 *  limited to what the classic format holds (under 4 GB in all, fewer than 65,536 files). */
export function zipStore(files: ZipEntry[], date?: { year: number; month: number; day: number; hour?: number; minute?: number }): Uint8Array {
  if (files.length > 0xfffe) throw new Error('Too many files for one archive.');
  const stamp = dosStamp(date);
  const taken = new Set<string>();
  const entries = files.map(f => {
    let name = zipName(f.name);
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = zipName(f.name, `-${n}`);
    taken.add(name.toLowerCase());
    return { name: encoder.encode(name), data: f.data, crc: crc32(f.data), offset: 0 };
  });
  let size = 22;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  if (size > 0xfffffffe) throw new Error('These files are too big for one archive.');
  const out = new Uint8Array(size); const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v: number) => { view.setUint16(at, v, true); at += 2; };
  const u32 = (v: number) => { view.setUint32(at, v >>> 0, true); at += 4; };
  const put = (b: Uint8Array) => { out.set(b, at); at += b.length; };
  const FLAGS = 0x0800;   // names are UTF-8
  for (const e of entries) {
    e.offset = at;
    u32(0x04034b50); u16(20); u16(FLAGS); u16(0); u16(stamp.time); u16(stamp.date);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0);
    put(e.name); put(e.data);
  }
  const dirAt = at;
  for (const e of entries) {
    u32(0x02014b50); u16(20); u16(20); u16(FLAGS); u16(0); u16(stamp.time); u16(stamp.date);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
    put(e.name);
  }
  const dirSize = at - dirAt;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(dirSize); u32(dirAt); u16(0);
  return out;
}
