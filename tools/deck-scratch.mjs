// Writes one self-contained HTML page for a deck: the runtime bundle, the stylesheet, the two bundled typefaces
// and the deck's JSON, all inlined, so the page opens from disk (file://) with no network.
//   node tools/deck-scratch.mjs <deck.json> <out.html> [--static] [--recipient <slug>]
// A development tool; the app's own export (with its own privacy rules for recipients) comes later.
// A scratch file never carries anyone it is not for: with --recipient only that one recipient is written into the
// file; without it every recipient is taken out.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeckRuntime, OUT_CSS, OUT_JS } from './build-deck-runtime.mjs';

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
if (slug) {
  data.recipients = everyone.filter(r => r && r.slug === slug).slice(0, 1);
  if (!data.recipients.length) { console.error(`no recipient with the link ending "${slug}" in ${jsonPath}`); process.exit(1); }
} else {
  data.recipients = [];
  if (everyone.length) console.log(`left out ${everyone.length} recipient${everyone.length === 1 ? '' : 's'}: pass --recipient <slug> to write a file for one of them`);
}
await buildDeckRuntime({ quiet: true });
const js = readFileSync(OUT_JS, 'utf8');
const css = readFileSync(OUT_CSS, 'utf8');

// @font-face has to be declared in the document: it does nothing inside a shadow tree.
const face = (family, weight, file) => {
  const p = resolve(root, 'node_modules/@fontsource', file);
  if (!existsSync(p)) return '';
  return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${readFileSync(p).toString('base64')}) format("woff2")}`;
};
const fonts = [
  face('Special Elite', 400, 'special-elite/files/special-elite-latin-400-normal.woff2'),
  face('Work Sans', 400, 'work-sans/files/work-sans-latin-400-normal.woff2'),
  face('Work Sans', 600, 'work-sans/files/work-sans-latin-600-normal.woff2'),
].join('\n');

// "<" never appears raw inside the inline scripts, so nothing in the deck's text can close a script element.
const inline = v => JSON.stringify(v).replace(/</g, '\\u003c');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bg = /^#[0-9a-f]{3,8}$/i.test(data?.theme?.colors?.bg ?? '') ? data.theme.colors.bg : '#ffffff';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.film ?? 'Deck')}</title>
<style>
${fonts}
html,body{margin:0;height:100%;background:${bg}}
#deck{height:${isStatic ? 'auto' : '100vh'}}
</style>
</head>
<body>
<div id="deck"></div>
<script type="application/json" id="deck-data">${inline(data)}</script>
<script type="text/plain" id="deck-css">${css.replace(/<\//g, '<\\/')}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('deck-data').textContent);
  var css = document.getElementById('deck-css').textContent;
  var host = document.getElementById('deck');
  window.deck = window.ProfitShareDeck.mountDeck(host, data, { css: css, useHash: true, pageKeys: true, static: ${isStatic ? 'true' : 'false'}${slug ? `, recipient: ${inline(slug)}` : ''} });
})();
</script>
</body>
</html>
`;
writeFileSync(resolve(outPath), html);
console.log(`wrote ${resolve(outPath)} (${(html.length / 1000).toFixed(0)} kB${isStatic ? ', static' : ''}${slug ? `, for ${slug}` : ''})`);
