// pdf.js no longer carries its picture decoders inside its worker: the JPEG 2000 decoder (OpenJPEG) and the JBIG2
// decoder (scanned black-and-white pages) are WebAssembly files it asks for by name, when a PDF has such a picture.
// This puts those files in the build at fixed names (dist/pdfjs/…), copied from node_modules each time so no binary is
// kept in the repo, with the licence notices that come with them. `npm run dev` serves the same files at the same
// address. The one-file build has no sibling files, so it gets none: there such a picture is left out of the page.
//
// Not copied: pdf.js's JavaScript stand-ins for the two decoders (a browser that can run the app can run
// WebAssembly), its colour-management module (it is used only when the worker itself fetches, which ours does not),
// and the script sandbox (the app never runs a PDF's scripts).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The folder, relative to the page, that src/engine/importers/pdfLib.ts tells pdf.js to ask. */
export const PDFJS_DECODER_DIR = 'pdfjs/';
/** What is shipped: the two decoders, and every licence that covers them. */
export const PDFJS_DECODER_FILES = [
  'openjpeg.wasm',
  'jbig2.wasm',
  'LICENSE_OPENJPEG',
  'LICENSE_PDFJS_OPENJPEG',
  'LICENSE_JBIG2',
  'LICENSE_PDFJS_JBIG2',
];

const TYPES = { wasm: 'application/wasm' };
/** Where pdfjs-dist keeps them. */
export function pdfjsDecoderSource() {
  return join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'wasm');
}

/** Vite: `__PDFJS_DECODERS__` is the folder's name for the app's code ('' in the one-file build, which has none);
 *  a build writes the files; the dev server answers for them. */
export function pdfjsDecodersPlugin({ oneFile = false } = {}) {
  const from = pdfjsDecoderSource();
  return {
    name: 'profitshare-pdfjs-decoders',
    config: () => ({ define: { __PDFJS_DECODERS__: JSON.stringify(oneFile ? '' : PDFJS_DECODER_DIR) } }),
    generateBundle() {
      if (oneFile) return;
      for (const name of PDFJS_DECODER_FILES)
        this.emitFile({ type: 'asset', fileName: PDFJS_DECODER_DIR + name, source: readFileSync(join(from, name)) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = /\/pdfjs\/([^/?#]+)(?:[?#].*)?$/.exec(req.url ?? '')?.[1];
        if (!name || !PDFJS_DECODER_FILES.includes(name)) return next();
        res.setHeader('Content-Type', TYPES[name.split('.')[1]] ?? 'text/plain; charset=utf-8');
        res.end(readFileSync(join(from, name)));
      });
    },
  };
}
