// Writes one self-contained HTML page for a deck from its JSON: the same page the app's "Download web deck" makes,
// put together by the same function (`deckHtml` in src/deck-runtime/exportHtml.ts), so it opens from disk
// (file://) with no network.
//   node tools/deck-scratch.mjs <deck.json> <out.html> [--static] [--recipient <slug>]
// A development tool. A file never carries anyone it is not for: with --recipient only that one recipient is
// written into the file; without it every recipient is taken out.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleDeckRuntime, loadDeckExport } from './build-deck-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const isStatic = args.includes('--static');
const usage = () => { console.error('usage: node tools/deck-scratch.mjs <deck.json> <out.html> [--static] [--recipient <slug>]'); process.exit(1); };
const at = args.indexOf('--recipient');
const slug = at >= 0 ? args[at + 1] : null;
if (at >= 0 && (!slug || slug.startsWith('--'))) usage();
const [jsonPath, outPath] = args.filter((a, i) => !a.startsWith('--') && !(at >= 0 && i === at + 1));
if (!jsonPath || !outPath) usage();

const data = JSON.parse(readFileSync(resolve(jsonPath), 'utf8'));
const everyone = Array.isArray(data.recipients) ? data.recipients : [];
if (slug && !everyone.some(r => r && r.slug === slug)) { console.error(`no recipient with the link ending "${slug}" in ${jsonPath}`); process.exit(1); }
if (!slug && everyone.length) console.log(`left out ${everyone.length} recipient${everyone.length === 1 ? '' : 's'}: pass --recipient <slug> to write a file for one of them`);

const { js, css } = await bundleDeckRuntime({ quiet: true });
const { deckHtml, dataFor, bundledFacesNeeded, needsLatinExt, LATIN_RANGE, LATIN_EXT_RANGE } = await loadDeckExport();

// the app's own typefaces, only the faces this deck's theme uses
const mine = dataFor(data, slug ?? undefined);
const fonts = [];
for (const need of bundledFacesNeeded(mine)) {
  const dir = need.family === 'Work Sans' ? 'work-sans' : need.family === 'Caveat' ? 'caveat' : 'special-elite';
  for (const [subset, unicodeRange] of [['latin', LATIN_RANGE], ...(needsLatinExt(mine) ? [['latin-ext', LATIN_EXT_RANGE]] : [])]) {
    const file = resolve(root, 'node_modules/@fontsource', dir, 'files', `${dir}-${subset}-${need.weight}-${need.style}.woff2`);
    if (existsSync(file)) fonts.push({ ...need, unicodeRange, src: `data:font/woff2;base64,${readFileSync(file).toString('base64')}` });
  }
}

const html = deckHtml(data, { runtimeJs: js, css, fonts }, { recipient: slug ?? undefined, static: isStatic });
writeFileSync(resolve(outPath), html);
console.log(`wrote ${resolve(outPath)} (${(html.length / 1000).toFixed(0)} kB${isStatic ? ', static' : ''}${slug ? `, for ${slug}` : ''})`);
