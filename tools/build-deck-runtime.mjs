// Bundles the deck's runtime into dist-deck/: one minified IIFE that defines window.ProfitShareDeck = { mountDeck },
// and a copy of the stylesheet. The export step inlines both into the single .html a filmmaker sends out.
//   node tools/build-deck-runtime.mjs
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';   // a devDependency of its own (the same version Vite uses)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = resolve(root, 'dist-deck');
export const OUT_JS = resolve(OUT_DIR, 'deck-runtime.js');
export const OUT_CSS = resolve(OUT_DIR, 'deck.css');

export async function buildDeckRuntime({ quiet = false } = {}) {
  mkdirSync(OUT_DIR, { recursive: true });
  await build({
    stdin: {
      contents: "import { mountDeck } from './runtime';\nwindow.ProfitShareDeck = { mountDeck };\n",
      resolveDir: resolve(root, 'src/deck-runtime'),
      sourcefile: 'deck-runtime-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    platform: 'browser',
    legalComments: 'none',
    outfile: OUT_JS,
    logLevel: quiet ? 'silent' : 'warning',
  });
  copyFileSync(resolve(root, 'src/deck-runtime/deck.css'), OUT_CSS);
  const js = statSync(OUT_JS).size, css = statSync(OUT_CSS).size;
  if (!quiet) console.log(`dist-deck/deck-runtime.js  ${(js / 1000).toFixed(1)} kB\ndist-deck/deck.css         ${(css / 1000).toFixed(1)} kB`);
  return { js, css };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildDeckRuntime().catch(err => { console.error(err); process.exit(1); });
}
