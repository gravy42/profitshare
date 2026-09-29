// Renders tools/fixtures/SaltFlat_Script.fountain as a standard-format screenplay PDF (Courier 12, 1.5" left margin,
// page numbers top right) so the PDF importer has an invented script to be tested against.
//   node tools/make-script-pdf.mjs  →  tools/fixtures/SaltFlat_Script.pdf
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(root + 'tools/fixtures/SaltFlat_Script.fountain', 'utf8').replace(/\r\n?/g, '\n');
const body = src.slice(src.search(/\n\s*\n/));   // drop the title page block
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const blocks = [];
let mode = 'action';
for (const raw of body.split('\n')) {
  const t = raw.trim();
  if (!t) { mode = 'action'; continue; }
  if (t === '===') continue;   // let the PDF paginate itself, the way a real script does
  if (/^(INT|EXT|I\/E)[.\s]/.test(t)) { blocks.push(`<p class="h">${esc(t)}</p>`); mode = 'action'; continue; }
  if (/TO:$|^FADE (IN|OUT)[:.]$/.test(t)) { blocks.push(`<p class="${/^FADE IN/.test(t) ? 'a' : 't'}">${esc(t)}</p>`); mode = 'action'; continue; }
  if (mode === 'dialogue') { blocks.push(`<p class="${/^\(/.test(t) ? 'p' : 'd'}">${esc(t)}</p>`); continue; }
  if (/^[A-Z0-9 .'()\-]+$/.test(t) && t.length < 40) { blocks.push(`<p class="c">${esc(t)}</p>`); mode = 'dialogue'; continue; }
  blocks.push(`<p class="a">${esc(t)}</p>`);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 8.5in 11in; margin: 1in 1in 1in 1.5in; }
body { font: 12pt/1 "Courier New", Courier, monospace; margin: 0; }
p { margin: 0 0 12pt 0; white-space: pre-wrap; }
.h { text-transform: uppercase; margin-top: 12pt; }
.c { margin: 0 0 0 2.2in; }
.d { margin: 0 0 12pt 1in; width: 3.5in; }
.p { margin: 0 0 0 1.6in; width: 2.5in; }
.t { text-align: right; }
.pb { page-break-after: always; }
</style></head><body>${blocks.join('\n')}</body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const page = await browser.newPage();
await page.setContent(html);
const pdf = await page.pdf({ format: 'Letter', printBackground: false, displayHeaderFooter: true, headerTemplate: '<div style="font:12pt Courier New,Courier,monospace;width:100%;text-align:right;padding-right:1in"><span class="pageNumber"></span>.</div>', footerTemplate: '<div></div>', margin: { top: '1in', right: '1in', bottom: '1in', left: '1.5in' } });
writeFileSync(root + 'tools/fixtures/SaltFlat_Script.pdf', pdf);
await browser.close();
console.log('wrote tools/fixtures/SaltFlat_Script.pdf');
