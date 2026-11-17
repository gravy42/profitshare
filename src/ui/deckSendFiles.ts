// Making the files a filmmaker sends: the web deck (.html), the PDFs and the .zip of all of them. Everything that
// needs a browser is here (canvas for the pictures, the off-screen deck the PDF is taken from, the app's own font
// files); the rules are in src/engine/deckExport.ts and the page itself is put together by
// src/deck-runtime/exportHtml.ts. Loaded only when a download is asked for.
//
// Making a file reads the project and writes nothing back to it.
import { runtimeJs } from 'virtual:deck-runtime';
import deckCss from '../deck-runtime/deck.css?inline';
import type { Project } from '../engine/types';
import type { DeckData, DeckImage } from '../deck-runtime/data';
import { deckData } from '../engine/deckData';
import { PICTURE_JPEG_QUALITY, dataUrlMime, fitWithin, pictureFormat, zipStore, type AskKind, type ZipEntry } from '../engine/deckExport';
import { LATIN_EXT_RANGE, LATIN_RANGE, bundledFacesNeeded, dataFor, deckHtml, deckTitle, fontFaceCss, needsLatinExt, type FaceNeed, type PageFont } from '../deck-runtime/exportHtml';
import { faceName } from '../deck-runtime/fonts';
import { cleanFontFaces, mountDeck } from '../deck-runtime/runtime';
import { aborted, pictureHash, slidesToPdf } from './deckPdf';
export { downloadBlob } from './deckPdf';

// ---------- pictures: at most 1600 px on the long edge, and always drawn again ----------
// Every picture in a sent file has been through a canvas: what comes out is pixels only, so nothing a camera or a
// phone wrote beside them (where and when it was taken, on what) travels with the deck. There is no path that
// passes a stored file through as it is; a picture that cannot be drawn is left out.

const pictures = new Map<string, Promise<string | null>>();   // by the picture's own fingerprint: a look book picture is drawn down once a session

/** A picture as it goes into a file, or null when the browser cannot draw it. */
export async function redrawn(src: string): Promise<string | null> {
  const mime = dataUrlMime(src);
  if (!mime) return null;
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch { return null; }
  const size = fitWithin(img.naturalWidth, img.naturalHeight);
  if (!size.width) return null;
  const canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size.width, size.height);
  let alpha = false;
  if (!/^image\/jpe?g$/.test(mime)) {
    const px = ctx.getImageData(0, 0, size.width, size.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
  }
  const format = pictureFormat(mime, alpha);
  if (format === 'image/jpeg') {   // a JPEG has no see-through: whatever was not quite solid is laid on white
    ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.width, size.height);
  }
  const out = canvas.toDataURL(format, PICTURE_JPEG_QUALITY);
  canvas.width = canvas.height = 0;
  return typeof out === 'string' && out.startsWith(`data:${format};base64,`) ? out : null;
}
function pictureFor(src: string): Promise<string | null> {
  const k = pictureHash(src);
  let p = pictures.get(k);
  if (!p) {
    p = redrawn(src); pictures.set(k, p);
    p.then(v => { if (v == null) pictures.delete(k); }, () => pictures.delete(k));
    if (pictures.size > 40) pictures.delete(pictures.keys().next().value as string);
  }
  return p;
}

// ---------- the app's own typefaces, read into the file only when the theme uses them ----------
// The app's pages already declare Work Sans and Special Elite (@font-face rules in its stylesheet). The files are
// found there and read from where the app itself is served, or, in the one-file build of the app, straight out of
// the rule, where they already are. Nothing is asked of any other address.

interface AppFace { family: string; weight: number; style: 'normal' | 'italic'; start: number; url: string }
/** Every woff2 the page's own stylesheets declare, with the first code point of the range it covers. */
function appFaces(doc: Document): AppFace[] {
  const out: AppFace[] = [];
  for (const sheet of Array.from(doc.styleSheets ?? [])) {
    let rules: CSSRuleList | CSSRule[];
    try { rules = sheet.cssRules; } catch { continue; }   // another origin's sheet: not the app's own
    for (const rule of Array.from(rules ?? [])) {
      if (rule.type !== 5) continue;   // CSSRule.FONT_FACE_RULE
      const st = (rule as CSSFontFaceRule).style;
      const family = st.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '');
      const src = st.getPropertyValue('src');
      const m = /url\(\s*(["']?)([^"')]+)\1\s*\)\s*format\(\s*["']?woff2["']?\s*\)/i.exec(src);
      if (!family || !m) continue;
      const range = /U\+([0-9a-f]+)/i.exec(st.getPropertyValue('unicode-range'));
      let url = m[2];
      if (!url.startsWith('data:')) { try { url = new URL(url, sheet.href ?? doc.baseURI).href; } catch { continue; } }
      out.push({ family, weight: parseInt(st.getPropertyValue('font-weight'), 10) || 400, style: /italic/i.test(st.getPropertyValue('font-style')) ? 'italic' : 'normal', start: range ? parseInt(range[1], 16) : 0, url });
    }
  }
  return out;
}
const LATIN_START = 0x0000, LATIN_EXT_START = 0x0100;   // where the two subsets' ranges begin
const fontData = new Map<string, Promise<string>>();
function fontDataUrl(url: string): Promise<string> {
  let p = fontData.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);   // the app's own font file (or, in the one-file build, the data: address already in the page)
      if (!res.ok) throw new Error('not there');
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!(bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32)) throw new Error('not a font file');
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:font/woff2;base64,${btoa(text)}`;
    })();
    fontData.set(url, p);
    p.catch(() => fontData.delete(url));
  }
  return p;
}
async function pageFonts(needs: FaceNeed[], ext: boolean): Promise<{ fonts: PageFont[]; missing: string[] }> {
  const fonts: PageFont[] = []; const missing = new Set<string>();
  const declared = needs.length ? appFaces(document) : [];
  const find = (n: FaceNeed, start: number) => declared.find(f => f.family.toLowerCase() === n.family.toLowerCase() && f.weight === n.weight && f.style === n.style && f.start === start);
  for (const n of needs) {
    try {
      const latin = find(n, LATIN_START);
      if (!latin) throw new Error('not declared');
      fonts.push({ family: n.family, weight: n.weight, style: n.style, src: await fontDataUrl(latin.url), unicodeRange: LATIN_RANGE });
      const wide = ext ? find(n, LATIN_EXT_START) : undefined;
      if (wide) fonts.push({ family: n.family, weight: n.weight, style: n.style, src: await fontDataUrl(wide.url), unicodeRange: LATIN_EXT_RANGE });
    } catch { missing.add(n.family); }
  }
  return { fonts, missing: [...missing] };
}

// ---------- the deck as it is sent ----------

/** Everything the files of one project are made from: the deck's data with its pictures drawn down, and the parts of the page. */
export interface Prepared {
  data: DeckData;
  fonts: PageFont[];
  missingFonts: string[];   // the app's typefaces that could not be read (offline, with the app's files not cached): those files go without them
  css: string;
  today: string;            // the day the files are dated (the cover line, the PDF's own date)
}
const prepared = new WeakMap<Project, Map<string, Promise<Prepared>>>();
/** The deck a file carries. Worked out once for a project as it stands (any edit makes a new project object). */
export function prepare(project: Project, today: string): Promise<Prepared> {
  let byDay = prepared.get(project);
  if (!byDay) { byDay = new Map(); prepared.set(project, byDay); }
  let p = byDay.get(today);
  if (!p) {
    p = (async () => {
      const raw = deckData(project, { today, fonts: 'embeddable' });   // only font files cleared to travel: never 'all', which is the preview's
      const images: DeckImage[] = [];
      for (const i of raw.images) {
        const src = await pictureFor(i.src);   // a picture still on its way back from the browser's store, or one the browser cannot draw, is left out
        if (src) images.push({ ...i, src });
      }
      const data = { ...raw, images };
      // every face any one file could need (a person's note is set in italics); each file then takes its own
      const needs = new Map<string, FaceNeed>();
      for (const d of [dataFor(data), ...data.recipients.map(r => dataFor(data, r.slug))]) for (const n of bundledFacesNeeded(d)) needs.set(`${n.family}|${n.weight}|${n.style}`, n);
      const { fonts, missing } = await pageFonts([...needs.values()], needsLatinExt(data));
      return { data, fonts, missingFonts: missing, css: deckCss, today };
    })();
    byDay.set(today, p);
    const forget = () => { if (byDay!.get(today) === p) byDay!.delete(today); };
    p.then(r => { if (r.missingFonts.length) forget(); }, forget);   // a result that went without a typeface is not kept: the next try reads the fonts again
  }
  return p;
}

/** The app's typefaces one file carries: what that file's own deck draws with (a note set in italics is in one person's file only). */
function fontsFor(prep: Prepared, mine: DeckData): PageFont[] {
  const needs = bundledFacesNeeded(mine), ext = needsLatinExt(mine);
  return prep.fonts.filter(f => needs.some(n => n.family === f.family && n.weight === f.weight && n.style === (f.style ?? 'normal')) && (ext || f.unicodeRange === LATIN_RANGE));
}

/** The web deck: one .html. `recipient` is a link ending; left out, the file names nobody. */
export function webDeck(prep: Prepared, recipient?: string): Blob {
  const html = deckHtml(prep.data, { runtimeJs, css: prep.css, fonts: fontsFor(prep, dataFor(prep.data, recipient)) }, { recipient });
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

// ---------- the PDF: the same deck, drawn still, off the screen, one slide to a page ----------

const SLIDE_W = 1600;
const frame = () => new Promise<void>(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

/** The deck as a PDF, as `recipient` (or anyone) sees it, opening on `ask` (left out: the ask their deck opens on). */
export async function pdfDeck(prep: Prepared, opts: { recipient?: string; ask?: AskKind; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<Blob> {
  const data = dataFor(prep.data, opts.recipient);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  // off the screen, not hidden: a hidden element has no layout to capture. Fixed, so the page does not grow a scrollbar.
  host.style.cssText = `position:fixed;left:-${SLIDE_W * 20}px;top:0;width:${SLIDE_W}px;pointer-events:none;contain:layout style`;
  document.body.appendChild(host);
  const handle = mountDeck(host, data, { css: prep.css, static: true, recipient: data.recipients[0]?.slug, lead: opts.ask });
  try {
    const rootEl: ParentNode = host.shadowRoot ?? host;
    const slides = [...rootEl.querySelectorAll<HTMLElement>('section.psd-slide')];
    // the capture is a picture of the page made apart from it, so it is given its typefaces by name: the app's own
    // (which the app's pages load as they need them) and the font files the deck carries
    const own = cleanFontFaces(data.theme.fontFaces).map(f => ({ ...f, name: faceName(f.role, f.family, f.src) }));
    const pageFaces = fontsFor(prep, data);
    const fontCss = [fontFaceCss(pageFaces), ...own.map(f => `@font-face{font-family:"${f.name}";src:url(${f.src})}`)].filter(Boolean).join('\n');
    const fontSet = document.fonts as FontFaceSet | undefined;
    if (fontSet) {
      const wanted = [...pageFaces.map(f => `${f.style === 'italic' ? 'italic ' : ''}${f.weight} 16px "${f.family}"`), ...own.map(f => `16px "${f.name}"`)];
      await Promise.all(wanted.map(f => fontSet.load(f).catch(() => undefined)));
      await fontSet.ready;
    }
    await Promise.all([...rootEl.querySelectorAll('img')].map(im => (typeof im.decode === 'function' ? im.decode().catch(() => undefined) : undefined)));
    await frame();
    handle.checkOverflow();   // the type steps down where a slide is full, now that the typefaces are in
    await frame();
    if (opts.signal?.aborted) throw aborted();
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(prep.today);
    const date = day ? new Date(Date.UTC(+day[1], +day[2] - 1, +day[3], 12)) : new Date(Date.UTC(2000, 0, 1, 12));   // noon, so the day reads the same in every time zone
    return await slidesToPdf(slides, { overlay: el => !!el.querySelector('img.psd-bg'), fontEmbedCSS: fontCss, signal: opts.signal, onProgress: opts.onProgress, meta: { title: deckTitle(data.film), date } });
  } finally {
    handle.destroy();
    host.remove();
  }
}

// ---------- everything, in one archive ----------

export async function blobBytes(blob: Blob): Promise<Uint8Array> { return new Uint8Array(await blob.arrayBuffer()); }
export function zipOf(files: ZipEntry[], now = new Date()): Blob {
  const bytes = zipStore(files, { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: now.getHours(), minute: now.getMinutes() });
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/zip' });
}
