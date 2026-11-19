// The pictures a link preview and a home screen ask for, drawn from public/favicon.svg and the app's own bundled
// faces: `node tools/make-icons.mjs` writes public/apple-touch-icon.png (180x180) and public/social.png (1200x630).
// Run it again after changing the mark or the line. Nothing here is a screenshot of a film: it is the name and a sentence.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const face = file => `data:font/woff2;base64,${readFileSync(new URL(`../node_modules/@fontsource/${file}`, import.meta.url)).toString('base64')}`;
// the mark without its rounded ground: a phone rounds the corners of a home-screen icon itself
const mark = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/, '').replace(/<rect[^>]*>/, '');

const fonts = `
  @font-face { font-family: "Special Elite"; src: url(${face('special-elite/files/special-elite-latin-400-normal.woff2')}) format("woff2"); }
  @font-face { font-family: "Work Sans"; font-weight: 500; src: url(${face('work-sans/files/work-sans-latin-500-normal.woff2')}) format("woff2"); }
  * { margin: 0; box-sizing: border-box; } body { background: #092827; }`;

const touch = `<!doctype html><style>${fonts} body { width: 180px; height: 180px; display: grid; place-items: center; } svg { width: 156px; height: 156px; }</style>${mark}`;

// the masthead, large: the name typed in periwinkle on midnight, the marigold string under it, one plain sentence
const social = `<!doctype html><style>${fonts}
  body { width: 1200px; height: 630px; padding: 0 96px; display: flex; flex-direction: column; justify-content: center; }
  .name { display: flex; align-items: center; gap: 36px; }
  .name svg { width: 150px; height: 150px; flex: none; }
  h1 { font: 400 132px/1 "Special Elite", monospace; letter-spacing: .01em; color: #91a9d9; padding-top: 22px; }
  hr { border: 0; height: 6px; background: #f2b705; margin: 44px 0 46px; }
  p { font: 500 40px/1.35 "Work Sans", sans-serif; color: #f4eddc; }
  p + p { color: #8c9fc2; margin-top: 6px; }
</style><div class="name">${mark}<h1>ProfitShare</h1></div><hr><p>Film budgeting with a profit share built in.</p><p>Free and open source.</p>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch({ channel: 'chrome' })).catch(() => chromium.launch());
for (const [html, width, height, file] of [[touch, 180, 180, 'apple-touch-icon.png'], [social, 1200, 630, 'social.png']]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, clip: { x: 0, y: 0, width, height } });
  await page.close();
  console.log(`public/${file}  ${width}x${height}`);
}
// the favicon at the sizes a tab and a bookmark draw it, side by side, to look at (scratch/ is not committed)
if (process.argv.includes('--look')) {
  const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const page = await browser.newPage({ viewport: { width: 520, height: 240 }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:20px;background:#ddd;display:flex;gap:24px;align-items:flex-start">${[16, 32, 180].map(s => `<img src="${uri}" width="${s}" height="${s}">`).join('')}<div style="background:#222;padding:10px;display:flex;gap:10px">${[16, 32].map(s => `<img src="${uri}" width="${s}" height="${s}">`).join('')}</div></body>`);
  await page.screenshot({ path: new URL('../scratch/favicon-sizes.png', import.meta.url).pathname });
}
await browser.close();
