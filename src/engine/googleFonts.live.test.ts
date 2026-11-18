// @vitest-environment node
// The one test that talks to the real Google Fonts. Skipped unless LIVE_GOOGLE=1 (a CI job sets it; `npm test` never
// does), because every other test must pass with no network. It asks only the two hosts the app asks, builds every
// address with the app's own builder, reads every answer with the app's own reader, and prints what it found, so a
// change in Google's format shows up here as a failure with the start of the real stylesheet in the message.
//
// Google writes the stylesheet for the browser that asks: a request with no modern User-Agent gets .ttf addresses, not
// .woff2. The app runs in a browser and sends a real one; this test sends a desktop Chrome's, and also shows what a
// bare request gets.
import { describe, expect, it } from 'vitest';
import raw from '../data/google-fonts.json';
import { fontMime } from './deckEdit';
import {
  GOOGLE_CSS_MAX, GOOGLE_CSS_ORIGIN, GOOGLE_FILE_MAX_BYTES, GOOGLE_FILE_ORIGIN, css2Url, filesToFetch, isGoogleFontsUrl, parseCss2, previewCssUrl, readCatalogue, weightsFor,
  type CatalogueFamily, type FontRole,
} from './googleFonts';

const LIVE = process.env.LIVE_GOOGLE === '1';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const catalogue = readCatalogue(raw);
const redirects: string[] = [];

/** One GET to one of the two hosts and nowhere else; a redirect is not followed, it is written down. */
async function ask(url: string, headers: Record<string, string> = {}): Promise<Response> {
  if (!isGoogleFontsUrl(url)) throw new Error(`not one of the two hosts: ${url}`);
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) redirects.push(`${res.status} ${url} -> ${res.headers.get('location')}`);
  return res;
}
/** The answer's bytes, read no further than `max` (the app's own cap). */
async function capped(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body!.getReader(); const parts: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > max) { await reader.cancel(); throw new Error(`more than ${max} bytes`); } parts.push(value); }
  const out = new Uint8Array(n); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const start = (css: string) => `\n--- the first 600 characters of what Google sent ---\n${css.slice(0, 600)}\n---`;

/** A family for a case: the one named if the catalogue has it in that shape, or else the first family of that shape. */
function pick(name: string, shape: (f: CatalogueFamily) => boolean): CatalogueFamily {
  const named = catalogue.families.find(f => f.family === name);
  const f = named && shape(named) ? named : catalogue.families.find(shape);
  if (!f) throw new Error(`the catalogue has no family for the case that ${name} stood for`);
  return f;
}
const CASES: { what: string; role: FontRole; family: CatalogueFamily }[] = [
  { what: 'static, regular and bold, no italics', role: 'title', family: pick('Cabin Condensed', f => !f.variable && f.weights.includes(400) && f.weights.includes(700) && !f.italics.length) },
  { what: 'static, with italics, for body text', role: 'body', family: pick('Lato', f => !f.variable && f.weights.includes(400) && f.weights.includes(700) && f.italics.includes(400)) },
  { what: 'static, body bold nearest 600', role: 'body', family: pick('Poppins', f => !f.variable && f.weights.includes(400) && f.weights.includes(600) && f.italics.includes(400)) },
  { what: 'variable, no italics', role: 'body', family: pick('Oswald', f => !!f.variable && !f.italics.length) },
  { what: 'variable, with italics, for a title', role: 'title', family: pick('Lora', f => !!f.variable && f.italics.length > 0) },
  { what: 'variable, with italics, for body text', role: 'body', family: pick('Inter', f => !!f.variable && f.italics.length > 0) },
  { what: 'one weight, display', role: 'title', family: pick('Abril Fatface', f => f.category === 'display' && f.weights.length === 1 && !f.variable) },
  { what: 'handwriting', role: 'title', family: pick('Caveat', f => f.category === 'handwriting') },
  { what: 'a space in the name, one weight', role: 'body', family: pick('Special Elite', f => f.family.includes(' ') && f.weights.length === 1) },
  { what: 'digits and spaces in the name', role: 'body', family: pick('Source Sans 3', f => /\d/.test(f.family) && f.family.includes(' ')) },   // the catalogue's names are letters, digits and spaces: this is as unusual as they get
];

describe.skipIf(!LIVE)('the real Google Fonts (LIVE_GOOGLE=1)', () => {
  it('answers each kind of family in a form the app reads, and its files are woff2 within the cap', async () => {
    const table: Record<string, string | number>[] = []; const notes: string[] = []; const problems: string[] = [];
    for (const c of CASES) {
      const f = c.family, plan = weightsFor(c.role, f);
      let url = css2Url(f, plan), res = await ask(url), italicRefused = false;
      if (res.status === 400 && plan.italic !== undefined) { italicRefused = true; notes.push(`${f.family}: Google refused the italic request (${url}); the app would retry without it`); url = css2Url(f, plan, { italic: false }); res = await ask(url); }
      if (res.status !== 200) { problems.push(`${f.family} (${c.what}): HTTP ${res.status} for ${url}`); continue; }
      const css = new TextDecoder().decode(await capped(res, GOOGLE_CSS_MAX));
      const faces = parseCss2(css);
      if (!faces.length) { problems.push(`${f.family} (${c.what}): the reader found no face in the answer to ${url}${start(css)}`); continue; }
      const files = filesToFetch(faces, f, plan);
      const want = [`normal ${plan.range ? plan.range.join('-') : plan.regular}`, ...(!plan.range && plan.bold !== undefined ? [`normal ${plan.bold}`] : []), ...(plan.italic !== undefined && !italicRefused ? [`italic ${plan.range ? plan.range.join('-') : plan.italic}`] : [])];
      const got = files.map(x => `${x.style} ${typeof x.weight === 'number' ? x.weight : x.weight.join('-')}`);
      if (JSON.stringify(got) !== JSON.stringify(want)) { problems.push(`${f.family} (${c.what}): wanted the latin files [${want.join(', ')}] and read [${got.join(', ')}] from ${url}; subsets seen: ${[...new Set(faces.map(x => x.subset))].join(', ')}${start(css)}`); continue; }
      let total = 0; const sizes: string[] = [];
      for (const file of files) {
        expect(file.url.startsWith(`${GOOGLE_FILE_ORIGIN}/`)).toBe(true);
        const r = await ask(file.url);
        if (r.status !== 200) { problems.push(`${f.family}: HTTP ${r.status} for ${file.url}`); continue; }
        const bytes = await capped(r, GOOGLE_FILE_MAX_BYTES);
        if (fontMime(bytes) !== 'font/woff2') problems.push(`${f.family}: ${file.url} is not a woff2 (it starts ${[...bytes.slice(0, 4)].map(b => b.toString(16)).join(' ')}; content-type ${r.headers.get('content-type')})`);
        total += bytes.length; sizes.push(`${file.style === 'italic' ? 'italic ' : ''}${typeof file.weight === 'number' ? file.weight : file.weight.join('-')}: ${bytes.length}`);
      }
      table.push({ family: f.family, case: c.what, role: c.role, asked: url.slice(`${GOOGLE_CSS_ORIGIN}/css2?family=`.length), 'faces in the answer': faces.length, subsets: [...new Set(faces.map(x => x.subset))].join(' '), 'files: bytes': sizes.join('; '), 'total bytes': total, 'over 600 kB': total > 600_000 ? 'YES' : 'no' });
    }
    console.log('\nGOOGLE FONTS LIVE: families\n' + table.map(r => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' | ')).join('\n'));
    console.table(table.map(r => ({ family: r.family, role: r.role, files: r['files: bytes'], total: r['total bytes'] })));
    if (notes.length) console.log('NOTES\n' + notes.join('\n'));
    console.log(redirects.length ? `REDIRECTS (the app does not follow them)\n${redirects.join('\n')}` : 'REDIRECTS: none');
    expect(problems, problems.join('\n\n')).toEqual([]);
    expect(redirects, 'the app asks with redirect: "error", so a redirect would read as "could not be reached"').toEqual([]);
  }, 180_000);

  it('a preview stylesheet (the fixed letters) is one small face whose file is on fonts.gstatic.com', async () => {
    const f = pick('Lora', x => !!x.variable);
    const url = previewCssUrl(f); const res = await ask(url); const css = await res.text();
    const addresses = [...css.matchAll(/url\(\s*["']?([^"')\s]+)/g)].map(m => m[1]);
    console.log(`\nGOOGLE FONTS LIVE: preview\nasked: ${url}\nstatus: ${res.status}; ${css.length} characters; @font-face blocks: ${(css.match(/@font-face/g) ?? []).length}\naddresses: ${addresses.join(' , ')}\nthe pick reader makes of it: ${JSON.stringify(parseCss2(css))} (a preview is loaded by the browser from a <link>, so the reader does not have to read it)`);
    expect(res.status, start(css)).toBe(200);
    expect(addresses.length, start(css)).toBeGreaterThan(0);
    for (const a of addresses) expect(a.startsWith(`${GOOGLE_FILE_ORIGIN}/`), `a preview file somewhere else: ${a}${start(css)}`).toBe(true);
    const file = await ask(addresses[0]); const bytes = await capped(file, GOOGLE_FILE_MAX_BYTES);
    console.log(`preview file: HTTP ${file.status}, ${bytes.length} bytes, ${fontMime(bytes) ?? 'not a font this app knows'}, content-type ${file.headers.get('content-type')}`);
    expect(file.status).toBe(200);
    expect(bytes.length).toBeLessThan(60_000);
  }, 60_000);

  it('both hosts let a page on another origin read their answers (CORS), and a bare request gets another format', async () => {
    const f = pick('Lato', x => !x.variable && x.weights.includes(400));
    const cssUrl = css2Url(f, weightsFor('title', f));
    const sheet = await ask(cssUrl, { origin: 'https://example.org' }); const css = await sheet.text();
    const fileUrl = filesToFetch(parseCss2(css), f, weightsFor('title', f))[0]?.url;
    expect(fileUrl, `no file read from ${cssUrl}${start(css)}`).toBeTruthy();
    const file = await ask(fileUrl, { origin: 'https://example.org' }); await file.arrayBuffer();
    const row = (name: string, r: Response) => `${name}: HTTP ${r.status}; access-control-allow-origin: ${r.headers.get('access-control-allow-origin')}; content-type: ${r.headers.get('content-type')}; cache-control: ${r.headers.get('cache-control')}; timing-allow-origin: ${r.headers.get('timing-allow-origin')}`;
    // what a request with no browser's name gets: not asserted, written down
    const bare = await fetch(cssUrl, { headers: { 'user-agent': 'profitshare-live-check' }, redirect: 'manual' }); const bareCss = await bare.text();
    const formats = (text: string) => [...new Set([...text.matchAll(/format\(\s*["']?([a-z0-9-]+)/g)].map(m => m[1]))].join(', ') || 'none named';
    console.log(`\nGOOGLE FONTS LIVE: CORS (Origin: https://example.org)\n${row('fonts.googleapis.com/css2', sheet)}\n${row('fonts.gstatic.com file', file)}\nwith a Chrome User-Agent the stylesheet names: ${formats(css)}\nwith no browser's User-Agent it names: ${formats(bareCss)} (HTTP ${bare.status}); the reader takes ${parseCss2(bareCss).length} faces from that\n${redirects.length ? `REDIRECTS\n${redirects.join('\n')}` : 'REDIRECTS: none'}`);
    for (const r of [sheet, file]) { expect(r.status).toBe(200); expect(['*', 'https://example.org']).toContain(r.headers.get('access-control-allow-origin')); }
  }, 60_000);
});

describe('the live check', () => {
  it('is off unless LIVE_GOOGLE=1, and its cases are in the catalogue', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(8);
    for (const c of CASES) expect(catalogue.families).toContain(c.family);
    expect(new Set(CASES.map(c => c.family.family)).size).toBe(CASES.length);
    if (!LIVE) expect(process.env.LIVE_GOOGLE).not.toBe('1');
  });
});
