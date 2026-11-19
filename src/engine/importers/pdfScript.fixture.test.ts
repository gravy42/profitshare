// @vitest-environment node
// The script import, run on a real PDF with the real pdf.js (outside the browser): what it reads from the sample
// screenplay must not move when pdf.js is upgraded. The three fingerprints below were taken with pdfjs-dist 4.10.38,
// before the move to 6.x, and 6.5 gives the same ones to the byte: every piece of text and where it sits, the lines
// made from them, and the scenes, eighths and cast read from those lines.
// (The one thing 6.x does differently: 4.10 also reported one empty, zero-width piece of text per page. The import
// never read those, and they are left out of the first fingerprint.)
// If a later pdf.js changes a fingerprint, look at what moved before taking a new one: a filmmaker's breakdown
// depends on it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { linesFromPdfItems, pdfPageItems } from './pdfScript';
import { parseScreenplayLines } from './screenplay';
import { pdfDecoderOptions } from './pdfLib';
import { PDFJS_DECODER_DIR, PDFJS_DECODER_FILES, pdfjsDecoderSource } from '../../../tools/pdfjs-decoders.mjs';

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read = async (file: string) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`tools/fixtures/${file}`)) }).promise;
  const pages = await pdfPageItems(doc);
  const lines = linesFromPdfItems(pages);
  return { pages, lines, script: parseScreenplayLines(lines, { cueIndent: 90 }) }; // cueIndent as App.tsx passes it for a PDF
};

describe('a screenplay PDF, read by the real pdf.js', () => {
  it('SaltFlat_Script.pdf: the same text, lines, scenes, eighths and cast as pdf.js 4.10 gave', async () => {
    const { pages, lines, script } = await read('SaltFlat_Script.pdf');
    expect(pages.map(p => p.items.filter(i => i.s !== '').length)).toEqual([327, 273, 356, 165]);
    expect(sha(pages.map(p => ({ ...p, items: p.items.filter(i => i.s !== '') })))).toBe(
      '8471cd9aa77514af43d6579e7041f300a47938e42729833f6592cd840bc19ce5',
    );
    expect(lines).toHaveLength(199);
    expect(sha(lines)).toBe('428757b5fc386ae2b748a6c07e9a1b3b4b560711f2be8e7389616116266bd030');
    expect(sha(script)).toBe('5c97b5a4af7a98a915d50753e9d540a7e16000fa0920bdadee6b038aa2069767');
    // and in words, so a failure above can be read
    expect(script.pages).toBe(4);
    expect(script.board.scenes).toHaveLength(9);
    expect(script.board.scenes.reduce((t, s) => t + s.eighths, 0)).toBe(26);
    expect(script.board.castList.map(c => c.name)).toEqual(['JUNE', 'LENA', 'WALT', 'THE MECHANIC', 'WAITRESS', 'KID']);
  });
  it('a PDF that is only a picture has no text, and says so rather than failing', async () => {
    const { pages, lines, script } = await read('jpx-picture.pdf');
    expect(pages).toHaveLength(1);
    expect(lines).toEqual([]);
    expect(script.board.scenes).toEqual([]);
  });
});

describe("pdf.js's picture decoders", () => {
  it("are asked for at a whole address in the app's own folder, wherever the app is served from", () => {
    expect(pdfDecoderOptions('https://profitshare.example/', 'pdfjs/')).toEqual({
      wasmUrl: 'https://profitshare.example/pdfjs/',
    });
    expect(pdfDecoderOptions('https://example.github.io/profitshare/index.html', 'pdfjs/')).toEqual({
      wasmUrl: 'https://example.github.io/profitshare/pdfjs/',
    });
    expect(pdfDecoderOptions('http://localhost:5173/', PDFJS_DECODER_DIR)).toEqual({
      wasmUrl: 'http://localhost:5173/pdfjs/',
    }); // pdf.js refuses a folder without its closing slash
  });
  it('are not asked for at all in the one-file build, which has no folder beside it', () => {
    expect(pdfDecoderOptions('file:///home/ada/profitshare.html', '')).toEqual({ useWasm: false });
  });
  it('are the two WebAssembly files pdf.js names, each with its licences, and nothing that runs as script', () => {
    const from = pdfjsDecoderSource();
    expect(PDFJS_DECODER_FILES.filter(f => f.endsWith('.wasm')).sort()).toEqual(['jbig2.wasm', 'openjpeg.wasm']);
    for (const f of PDFJS_DECODER_FILES) {
      const bytes = readFileSync(`${from}/${f}`);
      if (f.endsWith('.wasm')) expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
      else {
        expect(f).toMatch(/^LICENSE_/);
        expect(bytes.length).toBeGreaterThan(200);
      }
    }
    for (const wasm of ['OPENJPEG', 'JBIG2'])
      expect(PDFJS_DECODER_FILES).toEqual(expect.arrayContaining([`LICENSE_${wasm}`, `LICENSE_PDFJS_${wasm}`]));
    expect(PDFJS_DECODER_FILES.some(f => /\.m?js$/.test(f))).toBe(false);
    // the names pdf.js's worker asks for, read from the worker itself
    const worker = readFileSync(`${from}/../legacy/build/pdf.worker.mjs`, 'utf8');
    expect([...worker.matchAll(/_filename = "([^"]+)"/g)].map(m => m[1]).sort()).toEqual([
      'jbig2.wasm',
      'openjpeg.wasm',
    ]);
  });
  it("pdf.js runs no eval and no new Function, which the app's policy would refuse", () => {
    const from = pdfjsDecoderSource();
    for (const f of ['pdf.mjs', 'pdf.worker.mjs', 'pdf.min.mjs', 'pdf.worker.min.mjs']) {
      let code = readFileSync(`${from}/../legacy/build/${f}`, 'utf8');
      // One is written down and never reached: the last resort of a helper that looks for the global object, tried
      // only after `globalThis`, `window` and `self` have all failed to be it. Every browser the app runs in has those.
      const lastResort =
        /check\((?:typeof globalThis == 'object'|"object"==typeof globalThis)[\s\S]{0,700}?\|\|\s*Function\((["'])return this\1\)\(\)/;
      expect(code).toMatch(lastResort);
      code = code.replace(lastResort, '');
      expect(code).not.toMatch(/\bnew Function\b|[^.\w$]eval\s*\(|[^\w$.]Function\s*\(\s*["'`]|isEvalSupported/);
    }
  });
});
