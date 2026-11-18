// Writes src/data/google-fonts.json: the list of Google Fonts families the font picker on the Pitch tab scrolls
// through. Run by hand (`npm run fonts:catalogue`) when the list wants refreshing; the file it writes is committed,
// so a build and the tests never need the network.
//
// Where the facts come from:
//   - families, categories, weights, styles, subsets, variable axes: the npm package `google-font-metadata` (MIT),
//     fetched with `npm pack` into a temporary folder (it is not a dependency of the app), or read from a folder
//     given with --data <the package's data folder>;
//   - licences: the folder each family lives in at github.com/google/fonts (ofl/, apache/, ufl/), read from a
//     tree-only clone (no font is downloaded); the package's own licences.json fills in what that misses;
//   - an order to browse in: Google's own popularity figures when https://fonts.google.com/metadata/fonts answers
//     (--popularity <file> reads a saved copy); otherwise a short hand-kept list of widely used families below,
//     and the catalogue says which of the two it holds (`rank`).
//
// Only families with a `latin` subset and an open licence we could name are kept. Icon families are left out.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = new URL('../src/data/google-fonts.json', import.meta.url);
const arg = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const CATEGORIES = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'];
const LICENCES = ['OFL', 'Apache', 'UFL'];
const FOLDER_LICENCE = { ofl: 'OFL', apache: 'Apache', ufl: 'UFL' };

// Not measured: families that are in wide use, in no strict order, so the list does not open on the letter A.
// Used only when Google's own figures cannot be read. A name the catalogue does not have is reported and skipped.
const WELL_KNOWN = ['Roboto', 'Open Sans', 'Noto Sans', 'Montserrat', 'Lato', 'Poppins', 'Inter', 'Oswald', 'Raleway', 'Nunito', 'Playfair Display',
  'Merriweather', 'Rubik', 'Roboto Condensed', 'Roboto Slab', 'Roboto Mono', 'Ubuntu', 'Work Sans', 'PT Sans', 'PT Serif', 'Lora', 'Nunito Sans', 'Mulish',
  'DM Sans', 'Quicksand', 'Barlow', 'Fira Sans', 'Manrope', 'Libre Baskerville', 'Bebas Neue', 'Source Sans 3', 'Source Serif 4', 'Inconsolata',
  'Josefin Sans', 'Karla', 'Libre Franklin', 'EB Garamond', 'Cormorant Garamond', 'Crimson Text', 'Bitter', 'Anton', 'Archivo', 'Cabin',
  'Dancing Script', 'Pacifico', 'Caveat', 'Space Grotesk', 'Space Mono', 'IBM Plex Sans', 'IBM Plex Serif', 'IBM Plex Mono', 'Abril Fatface', 'Lobster',
  'Outfit', 'Figtree', 'Plus Jakarta Sans', 'Special Elite', 'Courier Prime', 'DM Serif Display', 'Fraunces', 'Alegreya', 'Spectral', 'Zilla Slab', 'Arvo',
  'Shadows Into Light', 'Permanent Marker', 'Righteous', 'Fjalla One', 'JetBrains Mono', 'Cinzel'];

const scratch = mkdtempSync(join(tmpdir(), 'font-catalogue-'));
try {
  // ---- the metadata package ----
  let dataDir = arg('--data'), version = arg('--data-version') ?? 'a local copy';
  if (!dataDir) {
    console.log('fetching google-font-metadata with npm pack…');
    const tgz = execFileSync('npm', ['pack', 'google-font-metadata', '--pack-destination', scratch, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['xzf', join(scratch, tgz), '-C', scratch, 'package/data/google-fonts-v2.json', 'package/data/variable.json', 'package/data/licenses.json', 'package/package.json']);
    dataDir = join(scratch, 'package', 'data');
    version = JSON.parse(readFileSync(join(scratch, 'package', 'package.json'), 'utf8')).version;
  }
  const read = file => JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
  const fonts = read('google-fonts-v2.json'), variable = read('variable.json'), licences = existsSync(join(dataDir, 'licenses.json')) ? read('licenses.json') : {};

  // ---- licences, from the folders of google/fonts ----
  const folderOf = new Map(); let repo = '';
  try {
    console.log('reading the folders of github.com/google/fonts (a tree-only clone)…');
    const dir = join(scratch, 'gf');
    execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', '--depth', '1', 'https://github.com/google/fonts.git', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
    repo = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    for (const folder of Object.keys(FOLDER_LICENCE)) {
      for (const line of execFileSync('git', ['-C', dir, 'ls-tree', '--name-only', 'HEAD', `${folder}/`], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n')) {
        const name = line.slice(folder.length + 1); if (name && !folderOf.has(name)) folderOf.set(name, FOLDER_LICENCE[folder]);
      }
    }
  } catch (e) { console.warn(`could not read google/fonts (${String(e.message).split('\n')[0]}): licences come from the package alone`); }
  const fromPackage = id => { const t = licences[id]?.license?.type ?? ''; return /open font/i.test(t) ? 'OFL' : /apache/i.test(t) ? 'Apache' : /ubuntu/i.test(t) ? 'UFL' : ''; };

  // ---- an order to browse in ----
  const rankOf = new Map(); let rank = 'well-known';
  try {
    const file = arg('--popularity');
    let text;
    if (file) text = readFileSync(file, 'utf8');
    else { const r = await fetch('https://fonts.google.com/metadata/fonts', { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); text = await r.text(); }
    const list = JSON.parse(text.replace(/^\)\]\}'?\s*/, '')).familyMetadataList;
    for (const f of list) if (typeof f.family === 'string' && Number.isFinite(f.popularity) && f.popularity > 0) rankOf.set(f.family, Math.round(f.popularity));
    if (rankOf.size < 500) throw new Error(`only ${rankOf.size} families had a figure`);
    rank = 'google';
    console.log(`popularity: Google's own figures for ${rankOf.size} families`);
  } catch (e) {
    rankOf.clear(); WELL_KNOWN.forEach((family, i) => rankOf.set(family, i + 1));
    console.log(`popularity: Google's figures could not be read (${String(e.message).split('\n')[0]}); using the hand-kept list of ${WELL_KNOWN.length}`);
  }

  // ---- the families ----
  const mask = weights => weights.reduce((m, w) => (w % 100 === 0 && w >= 100 && w <= 900 ? m | (1 << (w / 100 - 1)) : m), 0);
  const rows = []; const skipped = { notLatin: 0, icons: 0, noLicence: [], noWeights: 0 };
  for (const f of Object.values(fonts)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/.test(f.family)) { console.warn(`skipped, a name the app cannot carry: ${JSON.stringify(f.family)}`); continue; }
    if (/^Material (Icons|Symbols)/.test(f.family)) { skipped.icons++; continue; }
    if (!f.subsets.includes('latin')) { skipped.notLatin++; continue; }
    const licence = folderOf.get(f.family.toLowerCase().replace(/[^a-z0-9]/g, '')) ?? fromPackage(f.id);
    if (!licence) { skipped.noLicence.push(f.family); continue; }
    const normal = [], italic = [];
    for (const [w, styles] of Object.entries(f.variants ?? {})) { if (styles.normal?.latin) normal.push(+w); if (styles.italic?.latin) italic.push(+w); }
    if (!mask(normal)) { skipped.noWeights++; continue; }   // nothing upright to set text in
    const axis = variable[f.id]?.axes?.wght; const lo = Math.round(+axis?.min), hi = Math.round(+axis?.max);
    const row = [f.family, CATEGORIES.indexOf(f.category), mask(normal), mask(italic), LICENCES.indexOf(licence), f.subsets.includes('latin-ext') ? 1 : 0, rankOf.get(f.family) ?? 0];
    if (row[1] < 0) { console.warn(`skipped, an unknown category: ${f.family} (${f.category})`); continue; }
    if (axis && lo >= 1 && hi <= 1000 && lo < hi) row.push(lo, hi);
    rows.push(row);
  }
  rows.sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase(), 'en') || (a[0] < b[0] ? -1 : 1));
  if (rank === 'well-known') for (const name of WELL_KNOWN) if (!rows.some(r => r[0] === name)) console.warn(`the hand-kept list names a family the catalogue does not have: ${name}`);

  const made = new Date().toISOString().slice(0, 10);
  const head = {
    about: 'The Google Fonts families the font picker lists. Written by tools/make-font-catalogue.mjs (npm run fonts:catalogue); do not edit by hand.',
    made,
    source: { 'google-font-metadata': version, 'google/fonts': repo || 'not read' },
    rank,   // 'google': the last number of a row before any weight range is Google's popularity rank; 'well-known': a place in a hand-kept list of widely used families; 0 either way: none
    columns: ['family', 'category', 'upright weights (bit 0 = 100 … bit 8 = 900)', 'italic weights', 'licence', '1 when there is a latin-ext subset', 'rank', 'variable: lightest weight', 'variable: heaviest weight'],
    categories: CATEGORIES,
    licences: LICENCES,
  };
  // one family a line: compact, and a change to the list reads as a change to lines
  const json = `${JSON.stringify(head).slice(0, -1)},"families":[\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]}\n`;
  writeFileSync(OUT, json);
  console.log(`${rows.length} families, ${(json.length / 1000).toFixed(1)} kB → src/data/google-fonts.json (${made}; google-font-metadata ${version}; google/fonts ${repo.slice(0, 10) || 'not read'})`);
  console.log(`left out: ${skipped.notLatin} with no latin subset, ${skipped.icons} icon families, ${skipped.noWeights} with no upright weight, ${skipped.noLicence.length} with no licence we could name${skipped.noLicence.length ? ` (${skipped.noLicence.join(', ')})` : ''}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
