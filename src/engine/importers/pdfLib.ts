// pdf.js, loaded on first use and set up the one way the app uses it: for a script's text (pdfScript.ts) and for a
// brand book's or look book's text and pages (src/ui/brandPdf.ts).
//
// The `legacy` build is the one for browsers a year or two old: the other build needs language features that only
// the newest have, and a filmmaker's laptop is not always up to date.
//
// pdf.js has no eval and no `new Function` in it any more (the option that used to turn them off is gone with them),
// so it runs under the app's content security policy as it is. WebAssembly it does use, which the policy allows by name.

/** The folder of pdf.js's picture decoders, written by tools/pdfjs-decoders.mjs: 'pdfjs/', or '' in the one-file build. */
declare const __PDFJS_DECODERS__: string;

async function pdfjsLib() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    // the worker is spun up from an inline blob, so it works from the one-file build too
    const src = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  }
  return pdfjs;
}

/** What `getDocument` is told about the picture decoders. The address is whole (the worker lives at a blob: address,
 *  where 'pdfjs/' alone means nothing) and is the app's own folder, so nothing is asked of any other site. In the
 *  one-file build there is no such folder: WebAssembly decoding is switched off, and a JPEG 2000 or JBIG2 picture is
 *  left out of the page (the rest of the page is still drawn) rather than asked for from somewhere it is not. */
export function pdfDecoderOptions(
  baseURI: string = document.baseURI,
  dir: string = __PDFJS_DECODERS__,
): { wasmUrl: string } | { useWasm: false } {
  return dir ? { wasmUrl: new URL(dir, baseURI).href } : { useWasm: false };
}

/** Open a PDF from its bytes. */
export async function openPdf(data: ArrayBuffer) {
  const pdfjs = await pdfjsLib();
  return pdfjs.getDocument({ data, ...pdfDecoderOptions() }).promise;
}
