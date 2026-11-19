// Bundles the deck's runtime: one minified IIFE that defines window.ProfitShareDeck = { mountDeck }, and the
// stylesheet beside it. The export step inlines both into the single .html a filmmaker sends out.
// Nothing is written to disk: the app gets the bundle as text through the `virtual:deck-runtime` module (the plugin
// in vite.config.ts calls `bundleDeckRuntime` here), and so do the tests and tools/deck-scratch.mjs, so the file that
// is sent can never be a different build from the one that was checked.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild'; // a devDependency of its own (the same version Vite uses)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = resolve(root, 'src/deck-runtime');

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
    charset: 'ascii', // nothing outside ASCII in the script, so it reads the same whatever the page's encoding
    write: false,
    metafile: true,
    absWorkingDir: root, // the paths in the metafile are relative to this, wherever the tool was started from
    logLevel: quiet ? 'silent' : 'warning',
  });
  const cssPath = resolve(RUNTIME_DIR, 'deck.css');
  // the entry above is text, not a file: esbuild lists it under the name it was given, and a watcher handed a path that
  // is not on disk fails. Only real files are named.
  const inputs = [...new Set([...Object.keys(out.metafile.inputs).map(f => resolve(root, f)), cssPath])].filter(f =>
    existsSync(f),
  );
  return { js: out.outputFiles[0].text, css: readFileSync(cssPath, 'utf8'), inputs };
}

/** The page assembler (`src/deck-runtime/exportHtml.ts`) as a module a Node tool can call. */
export async function loadDeckExport() {
  const out = await build({
    entryPoints: [resolve(RUNTIME_DIR, 'exportHtml.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}
