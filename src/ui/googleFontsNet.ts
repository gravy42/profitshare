// The one part of the app that asks Google Fonts for anything, and only after the person has said yes in the picker.
// Two hosts, hard-coded in the engine (fonts.googleapis.com for a family's stylesheet, fonts.gstatic.com for its
// files); a family's name comes from the bundled catalogue, never from what was typed; what comes back is read as
// text and bytes and is never put into the page as markup. The rules (which weights, how the address is built, how
// the answer is read) are in src/engine/googleFonts.ts; this file is the browser's side of it.
import type { FontFile } from '../engine/types';
import { fontMime } from '../engine/deckEdit';
import {
  GOOGLE_CSS_MAX, GOOGLE_CSS_ORIGIN, GOOGLE_FILE_MAX_BYTES, GOOGLE_FILE_ORIGIN, PREVIEW_LETTERS, css2Url, filesToFetch, googleFontFiles, parseCss2, previewCssUrl,
  previewWeight, readCatalogue, weightsFor, type Catalogue, type CatalogueFamily, type FontRole,
} from '../engine/googleFonts';

// ---------- the answer to "may this page ask Google?": kept for this session of the tab, never in the project ----------

const CONSENT_KEY = 'profitshare.gfonts.ok';
let agreed = false;
export function googleFontsAllowed(): boolean {
  if (agreed) return true;
  try { agreed = sessionStorage.getItem(CONSENT_KEY) === '1'; } catch { /* a private window: the answer lasts as long as the page */ }
  return agreed;
}
export function allowGoogleFonts(): void { agreed = true; try { sessionStorage.setItem(CONSENT_KEY, '1'); } catch { /* kept in memory */ } }
/** For tests: forget the answer. */
export function forgetGoogleFontsAnswer(): void { agreed = false; try { sessionStorage.removeItem(CONSENT_KEY); } catch { /* nothing kept */ } }

// ---------- the catalogue: its own file, read when the picker first opens ----------

let catalogue: Promise<Catalogue> | null = null;
export function loadCatalogue(): Promise<Catalogue> {
  catalogue ??= import('../data/google-fonts.json').then(m => readCatalogue((m as { default: unknown }).default));
  catalogue.catch(() => { catalogue = null; });
  return catalogue;
}

// ---------- asking ----------

export type GoogleProblem = 'offline' | 'unreachable' | 'refused' | 'unreadable' | 'stopped';
export class GoogleFontsError extends Error {
  constructor(public kind: GoogleProblem, message: string) { super(message); this.name = 'GoogleFontsError'; }
}
export const OFFLINE_WORDS = 'This computer is offline, so Google Fonts cannot be reached. You can still read the list, and every font already in your project keeps working.';
export const UNREACHABLE_WORDS = 'Google Fonts could not be reached. Your connection, a firewall or a blocker may be stopping it. You can still read the list, and every font already in your project keeps working.';
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** One request to one of the two hosts: no cookies, no referrer, no redirect followed. */
async function ask(url: string, origin: string, signal?: AbortSignal): Promise<Response> {
  if (!googleFontsAllowed()) throw new GoogleFontsError('stopped', 'Nothing is asked of Google Fonts until you say so.');
  if (!url.startsWith(`${origin}/`)) throw new GoogleFontsError('unreadable', 'That is not an address at Google Fonts, so it was not asked for.');
  if (offline()) throw new GoogleFontsError('offline', OFFLINE_WORDS);
  let res: Response;
  try { res = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal }); }
  catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new GoogleFontsError('stopped', 'Stopped.');
    throw new GoogleFontsError(offline() ? 'offline' : 'unreachable', offline() ? OFFLINE_WORDS : UNREACHABLE_WORDS);
  }
  if (res.status === 400 || res.status === 404) throw new GoogleFontsError('refused', 'Google Fonts does not have that font in the weights asked for.');
  if (!res.ok) throw new GoogleFontsError('unreachable', `Google Fonts answered with an error (${res.status}). Try again in a little while.`);
  return res;
}
/** The answer's bytes, read no further than `max`. */
async function bytesOf(res: Response, max: number): Promise<Uint8Array> {
  const tooBig = () => new GoogleFontsError('unreadable', 'Google Fonts sent more than a font should be, so it was not saved.');
  if (Number(res.headers.get('content-length')) > max) throw tooBig();
  const reader = res.body?.getReader?.();
  if (!reader) { const all = new Uint8Array(await res.arrayBuffer()); if (all.length > max) throw tooBig(); return all; }
  const parts: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { void reader.cancel().catch(() => undefined); throw tooBig(); }
    parts.push(value);
  }
  const out = new Uint8Array(n); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A family's files for a role, downloaded and ready to be the project's font files: the stylesheet is asked for, its
 *  .woff2 addresses read out by the engine's strict reader, and each file fetched, checked to be a woff2 and turned
 *  into a data URL. Throws a GoogleFontsError, in words for the page, when any step cannot be done; nothing is kept
 *  from a pick that did not finish. */
export async function fetchGoogleFamily(family: CatalogueFamily, role: FontRole, signal?: AbortSignal): Promise<FontFile[]> {
  const plan = weightsFor(role, family);
  let css: string;
  const sheet = async (italic: boolean) => new TextDecoder().decode(await bytesOf(await ask(css2Url(family, plan, { italic }), GOOGLE_CSS_ORIGIN, signal), GOOGLE_CSS_MAX));
  try { css = await sheet(true); }
  catch (e) {
    // the catalogue said there was an italic and Google says otherwise: the upright files are still worth having
    if (e instanceof GoogleFontsError && e.kind === 'refused' && plan.italic !== undefined) css = await sheet(false);
    else throw e;
  }
  const wanted = filesToFetch(parseCss2(css), family, plan);
  if (!wanted.some(w => w.style === 'normal')) throw new GoogleFontsError('unreadable', `Google Fonts answered, but not with files for ${family.family} that this app can read. Nothing was saved.`);
  const got = await Promise.all(wanted.map(async w => {
    const bytes = await bytesOf(await ask(w.url, GOOGLE_FILE_ORIGIN, signal), GOOGLE_FILE_MAX_BYTES);
    if (fontMime(bytes) !== 'font/woff2') throw new GoogleFontsError('unreadable', `Google Fonts sent something that is not a font file for ${family.family}. Nothing was saved.`);
    return { weight: w.weight, style: w.style, dataUrl: `data:font/woff2;base64,${base64(bytes)}` };
  }));
  return googleFontFiles(role, family, got);
}

// ---------- previews: one small stylesheet a family, only for rows on screen, a few at a time ----------

export type PreviewState = 'waiting' | 'ready' | 'failed';
export const PREVIEW_AT_ONCE = 4;      // stylesheets being fetched at one time
const PREVIEW_KEEP = 90;               // stylesheets kept in the page; the ones longest out of sight go first
const PREVIEW_WAIT_MS = 12000;
const OWN_FAMILIES = ['Work Sans', 'Special Elite', 'Caveat'];   // the app's own pages already carry these

/** Loads previews by adding a stylesheet link to fonts.googleapis.com for a family (the fixed preview letters only),
 *  at most PREVIEW_AT_ONCE at a time, and takes every link out again when it is closed. */
export class PreviewLoader {
  private links = new Map<string, HTMLLinkElement>();
  private states = new Map<string, PreviewState>();
  private queue: CatalogueFamily[] = [];
  private busy = 0;
  private closed = false;
  private failures = 0;
  private successes = 0;
  constructor(private onChange: () => void, private doc: Document = document) {}

  state(family: string): PreviewState | undefined { return this.states.get(family); }
  /** True when previews have failed and none has ever worked: Google cannot be reached from here. */
  get unreachable(): boolean { return this.successes === 0 && this.failures >= 3; }

  /** A row has come into view: load its preview if it has none. */
  want(f: CatalogueFamily): void {
    if (this.closed || !googleFontsAllowed() || this.unreachable) return;
    if (this.states.has(f.family)) { const link = this.links.get(f.family); if (link) { this.links.delete(f.family); this.links.set(f.family, link); } return; }   // seen again: the last to go
    if (OWN_FAMILIES.includes(f.family)) { this.states.set(f.family, 'ready'); this.onChange(); return; }
    if (offline()) { this.failures++; this.states.set(f.family, 'failed'); this.onChange(); return; }
    this.states.set(f.family, 'waiting');
    this.queue.push(f);
    this.pump();
  }
  /** A row has gone out of view before its turn came: it gives up its place. */
  drop(family: string): void {
    const at = this.queue.findIndex(f => f.family === family);
    if (at >= 0) { this.queue.splice(at, 1); this.states.delete(family); }
  }
  /** Forget the failures and let rows ask again. */
  retry(): void {
    this.failures = 0;
    for (const [family, s] of [...this.states]) if (s === 'failed') { this.states.delete(family); this.links.get(family)?.remove(); this.links.delete(family); }
    this.onChange();
  }
  close(): void {
    this.closed = true; this.queue = [];
    for (const link of this.links.values()) link.remove();
    this.links.clear(); this.states.clear();
  }

  private pump(): void {
    while (!this.closed && this.busy < PREVIEW_AT_ONCE && this.queue.length) {
      const f = this.queue.pop()!;   // the row that came into view last is the one being looked at
      this.busy++;
      void this.load(f).then(ok => {
        this.busy--;
        if (this.closed) return;
        if (ok) this.successes++; else this.failures++;
        this.states.set(f.family, ok ? 'ready' : 'failed');
        if (this.unreachable) { for (const q of this.queue) this.states.delete(q.family); this.queue = []; }
        this.trim();
        this.onChange();
        this.pump();
      });
    }
  }
  private load(f: CatalogueFamily): Promise<boolean> {
    return new Promise<boolean>(done => {
      let over = false;
      const finish = (ok: boolean) => { if (!over) { over = true; clearTimeout(timer); done(ok); } };
      const timer = setTimeout(() => finish(false), PREVIEW_WAIT_MS);
      const link = this.doc.createElement('link');
      link.rel = 'stylesheet';
      link.referrerPolicy = 'no-referrer';
      link.dataset.googleFontPreview = f.family;
      link.onerror = () => finish(false);
      link.onload = () => {
        // the stylesheet is in; the letters themselves arrive when something is drawn with them
        const fonts = this.doc.fonts as FontFaceSet | undefined;
        if (!fonts?.load) { finish(true); return; }
        fonts.load(`${previewWeight(f)} 20px "${f.family}"`, PREVIEW_LETTERS).then(faces => finish(faces.length > 0), () => finish(false));
      };
      link.href = previewCssUrl(f);   // built by the engine from the catalogue's own name: always fonts.googleapis.com
      this.links.set(f.family, link);
      this.doc.head.appendChild(link);
    });
  }
  private trim(): void {
    for (const [family, link] of this.links) {
      if (this.links.size <= PREVIEW_KEEP) break;
      if (this.states.get(family) === 'waiting') continue;
      link.remove(); this.links.delete(family); this.states.delete(family);
    }
  }
}
