// Bundles the deck's runtime: one minified IIFE that defines window.ProfitShareDeck = { mountDeck }, and the
// stylesheet beside it. The export step inlines both into the single .html a filmmaker sends out.
//   node tools/build-deck-runtime.mjs        writes dist-deck/deck-runtime.js and dist-deck/deck.css
// The app gets the same bundle as text through the `virtual:deck-runtime` module (the plugin in vite.config.ts calls
// `bundleDeckRuntime` here), so the file that is sent and this tool's output can never be two different builds.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';   // a devDependency of its own (the same version Vite uses)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_DIR = resolve(root, 'src/deck-runtime');
export const OUT_DIR = resolve(root, 'dist-deck');
export const OUT_JS = resolve(OUT_DIR, 'deck-runtime.js');
export const OUT_CSS = resolve(OUT_DIR, 'deck.css');

/** The runtime as text: `js` is the IIFE, `css` the stylesheet, `inputs` every source file the bundle was made from. */
export async function bundleDeckRuntime({ quiet = false } = {}) {
  const out = await build({
    stdin: {
      contents: "import { mountDeck } from './runtime';\nwindow.ProfitShareDeck = { mountDeck };\n",
      resolveDir: RUNTIME_DIR,
      sourcefile: 'deck-runtime-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    platform: 'browser',
    legalComments: 'none',
    charset: 'ascii',      // nothing outside ASCII in the script, so it reads the same whatever the page's encoding
    write: false,
    metafile: true,
    absWorkingDir: root,    // the paths in the metafile are relative to this, wherever the tool was started from
    logLevel: quiet ? 'silent' : 'warning',
  });
  const cssPath = resolve(RUNTIME_DIR, 'deck.css');
  // the entry above is text, not a file: esbuild lists it under the name it was given, and a watcher handed a path that
  // is not on disk fails. Only real files are named.
  const inputs = [...new Set([...Object.keys(out.metafile.inputs).map(f => resolve(root, f)), cssPath])].filter(f => existsSync(f));
  return { js: out.outputFiles[0].text, css: readFileSync(cssPath, 'utf8'), inputs };
}

/** The page assembler (`src/deck-runtime/exportHtml.ts`) as a module a Node tool can call. */
export async function loadDeckExport() {
  const out = await build({ entryPoints: [resolve(RUNTIME_DIR, 'exportHtml.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2020', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

export async function buildDeckRuntime({ quiet = false } = {}) {
  const { js, css } = await bundleDeckRuntime({ quiet });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_JS, js);
  writeFileSync(OUT_CSS, css);
  const sizes = { js: Buffer.byteLength(js), css: Buffer.byteLength(css) };
  if (!quiet) console.log(`dist-deck/deck-runtime.js  ${(sizes.js / 1000).toFixed(1)} kB\ndist-deck/deck.css         ${(sizes.css / 1000).toFixed(1)} kB`);
  return sizes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildDeckRuntime().catch(err => { console.error(err); process.exit(1); });
}
