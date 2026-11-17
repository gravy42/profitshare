// The app and the deck it sends, walked in one browser engine: `BROWSER=webkit node tools/browsers.mjs` (webkit is
// Safari's engine, firefox, or chromium). It builds nothing: run `npm run build` first. Every step is tried even when
// an earlier one failed, so one run tells the whole story; the report is printed and written to browsers-out/.
import { chromium, firefox, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const engines = { chromium, firefox, webkit };
const name = process.env.BROWSER || 'chromium';
const engine = engines[name];
if (!engine) { console.error(`BROWSER must be one of ${Object.keys(engines).join(', ')}`); process.exit(2); }
const out = `browsers-out/${name}`;
mkdirSync(out, { recursive: true });
const port = 4300 + Object.keys(engines).indexOf(name);
const origin = `http://127.0.0.1:${port}`;

const rows = [];
const note = (step, ok, detail = '') => { rows.push({ step, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? `: ${detail}` : ''}`); };
const step = async (label, fn) => {
  try { const detail = await fn(); note(label, true, detail ?? ''); return true; }
  catch (e) { note(label, false, String(e?.message ?? e).split('\n')[0].slice(0, 300)); return false; }
};
const need = (cond, message) => { if (!cond) throw new Error(message); };

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const up = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) return; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 500)); } throw new Error('the preview server did not start'); };

let browser;
const saved = {};
try {
  await up();
  browser = await engine.launch();
  note('browser', true, `${name} ${browser.version()}`);

  // ---- the app -------------------------------------------------------------------------------------------------
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`console: ${m.text()}`); });
  const outside = [];
  page.on('request', r => { if (!r.url().startsWith(origin) && !/^(data|blob|about):/.test(r.url())) outside.push(r.url()); });
  const shot = (file, target = page) => target.screenshot({ path: `${out}/${file}.png` }).catch(() => undefined);
  const deckSlides = () => page.evaluate(() => document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide').length ?? 0);
  const download = async (click, file) => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), click()]);
    const path = `${out}/${file}`; await d.saveAs(path); saved[file] = path; return { path, name: d.suggestedFilename() };
  };

  await step('the app opens', async () => { await page.goto(origin); await page.getByRole('button', { name: 'Load the sample' }).waitFor({ timeout: 20000 }); });
  await step('the sample loads', async () => { await page.getByRole('button', { name: 'Load the sample' }).click(); await page.waitForTimeout(600); await shot('01-sample'); });
  for (const label of ['Top sheet & budget', 'Deal', 'Stripboard', 'Points & waterfall', 'SAG tier', 'Pitch']) {
    await step(`tab: ${label}`, async () => { await page.getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(500); await shot(`02-tab-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`); });
  }
  await step('the pitch deck preview draws 13 slides', async () => {
    await page.locator('#pitch-deck').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide').length === 13, null, { timeout: 20000 });
    await page.locator('#pitch-deck .pd-preview').scrollIntoViewIfNeeded(); await page.waitForTimeout(800); await shot('03-pitch-deck');
  });
  await step('no slide overflows in the preview', async () => {
    const over = await page.evaluate(() => [...(document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide[data-overflow="true"]') ?? [])].map(s => s.id || s.getAttribute('aria-label')));
    need(over.length === 0, `overflowing: ${over.join(', ')}`);
  });
  await step('the preview pages with its buttons', async () => {
    for (let i = 0; i < 4; i++) { await page.getByRole('button', { name: 'Next slide' }).click(); await page.waitForTimeout(700); }
    const at = (await page.locator('#pitch-deck .pd-count').innerText()).replace(/\s+/g, ' ').trim();
    need(/5 \/ 13$/.test(at), `the counter says "${at}"`); await shot('04-pitch-slide-5');
  });
  await step('Play replays a slide', async () => { await page.getByRole('button', { name: /^Play/ }).first().click(); await page.waitForTimeout(1500); await shot('05-play'); });
  await step('the design builder proposes looks from pictures', async () => {
    const open = page.getByRole('button', { name: 'Build one from my pictures' });
    await open.scrollIntoViewIfNeeded(); await open.click(); await page.waitForTimeout(800); await shot('06-design-builder');
  });
  await step('download: web deck', async () => {
    await page.locator('#pitch-send').scrollIntoViewIfNeeded();
    const d = await download(() => page.locator('#pitch-send button', { hasText: 'Download web deck' }).first().click(), 'deck.html');
    const html = readFileSync(d.path, 'utf8');
    need(/^<!doctype html>/i.test(html) && html.includes('id="deck-data"'), 'the file is not the deck page');
    need(!/https?:/i.test(html), 'the file names an address');
    return `${d.name}, ${(html.length / 1000).toFixed(0)} kB`;
  });
  const pdfPages = async file => (await PDFDocument.load(readFileSync(file))).getPageCount();
  await step('download: deck PDF', async () => {
    const d = await download(() => page.locator('#pitch-send button', { hasText: /^PDF/ }).first().click(), 'deck.pdf');
    const n = await pdfPages(d.path); const kb = readFileSync(d.path).length / 1000;
    need(n === 13, `the PDF has ${n} pages, not 13`); need(kb > 300, `the PDF is only ${kb.toFixed(0)} kB, so its pages are probably blank`);
    return `${d.name}, ${n} pages, ${kb.toFixed(0)} kB`;
  });
  await step('download: report deck PDF', async () => {
    const button = page.getByRole('button', { name: 'Download the PDF', exact: true });
    await button.scrollIntoViewIfNeeded();
    const d = await download(() => button.click(), 'report.pdf');
    const n = await pdfPages(d.path); need(n >= 4, `the report PDF has ${n} pages`);
    return `${n} pages, ${(readFileSync(d.path).length / 1000).toFixed(0)} kB`;
  });
  await step('download: everything as a zip', async () => {
    await page.locator('#pitch-send').scrollIntoViewIfNeeded();
    const d = await download(async () => {
      await page.locator('#pitch-send button', { hasText: 'Download everything' }).click();
      const go = page.locator('#pitch-send button', { hasText: /^(Download anyway|Go ahead|Yes)/ }); await page.waitForTimeout(500);
      if (await go.count()) await go.first().click();
    }, 'all.zip');
    const bytes = readFileSync(d.path); need(bytes[0] === 0x50 && bytes[1] === 0x4b, 'not a zip'); return `${(bytes.length / 1e6).toFixed(1)} MB`;
  });
  await step('the app logged no errors', async () => { need(errors.length === 0, errors.slice(0, 4).join(' | ')); });
  await step('the app asked for nothing outside itself', async () => { need(outside.length === 0, outside.slice(0, 3).join(' | ')); });
  await context.close();

  // ---- the file a reader opens, with no network -------------------------------------------------------------------
  if (saved['deck.html']) {
    const url = pathToFileURL(saved['deck.html']).href;
    // No network for the reader: everything that is not the file itself is refused. (WebKit will not open a file at all
    // in a context set offline, so the wall is a route instead; a request that hits it is still counted below.)
    const sealed = async options => { const ctx = await browser.newContext(options); await ctx.route(u => !/^(file|data|blob|about):/.test(String(u)), r => r.abort()); return ctx; };
    const reader = async (label, viewport, hash = '') => {
      const ctx = await sealed({ viewport });
      const p = await ctx.newPage(); const errs = []; const asked = [];
      p.on('pageerror', e => errs.push(`pageerror: ${e.message}`));
      p.on('console', m => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
      p.on('request', r => { if (!/^(file|data|blob|about):/.test(r.url())) asked.push(r.url()); });
      await p.goto(url + hash); await p.waitForTimeout(2500);
      const info = await p.evaluate(async () => {
        const root = document.querySelector('.psd-host, #deck, body > div')?.shadowRoot ?? [...document.querySelectorAll('*')].find(e => e.shadowRoot)?.shadowRoot;
        const slides = root ? [...root.querySelectorAll('section.psd-slide')] : [];
        await document.fonts.ready;
        return {
          slides: slides.length,
          over: slides.filter(s => s.getAttribute('data-overflow') === 'true').length,
          ask: (slides.map(s => s.textContent).find(t => /We are raising/.test(t)) || '').replace(/\s+/g, ' ').match(/We are raising\s*\$[\d,]+/)?.[0] ?? '',
          wide: document.documentElement.scrollWidth > window.innerWidth + 1,
          fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')),
          failed: [...document.fonts].filter(f => f.status === 'error').map(f => f.family),
          stacked: !!root?.querySelector('.psd-stacked, [data-stacked="true"]') || root?.host?.classList?.contains('psd-stacked') || false,
        };
      });
      await p.screenshot({ path: `${out}/10-file-${label}.png` });
      await ctx.close();
      return { ...info, errs, asked };
    };
    let withGrants = '';
    await step('sent file, offline, 1600x900', async () => {
      const r = await reader('1600', { width: 1600, height: 900 });
      need(r.slides === 13, `${r.slides} slides`); need(r.errs.length === 0, r.errs.slice(0, 3).join(' | ')); need(r.asked.length === 0, `asked for ${r.asked[0]}`);
      need(r.over === 0, `${r.over} slides overflow`); need(r.failed.length === 0, `fonts failed: ${r.failed.join(', ')}`);
      withGrants = r.ask; return `${r.ask}; fonts ${[...new Set(r.fonts)].join(', ') || 'none loaded'}`;
    });
    await step('sent file: #without opens the larger ask', async () => {
      const r = await reader('without', { width: 1600, height: 900 }, '#without');
      need(r.ask && r.ask !== withGrants, `the ask reads "${r.ask}" both ways`); return r.ask;
    });
    await step('sent file, 1024x768', async () => { const r = await reader('1024', { width: 1024, height: 768 }); need(r.slides === 13 && r.over === 0 && r.errs.length === 0, `${r.slides} slides, ${r.over} overflow, ${r.errs[0] ?? ''}`); });
    await step('sent file on a phone, 390x844', async () => {
      const r = await reader('phone', { width: 390, height: 844 });
      need(r.slides === 13, `${r.slides} slides`); need(!r.wide, 'the page scrolls sideways'); need(r.errs.length === 0, r.errs.slice(0, 2).join(' | '));
    });
    await step('sent file: every slide, one by one', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, offline: true, reducedMotion: 'reduce' });
      const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(1500);
      for (let i = 0; i < 13; i++) {
        await p.evaluate(n => { const root = [...document.querySelectorAll('*')].find(e => e.shadowRoot)?.shadowRoot; root?.querySelectorAll('section.psd-slide')[n]?.scrollIntoView({ behavior: 'instant' }); }, i);
        await p.waitForTimeout(350); await p.screenshot({ path: `${out}/20-slide-${String(i + 1).padStart(2, '0')}.png` });
      }
      await ctx.close();
    });
    await step('sent file: arrow keys page it', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, offline: true });
      const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(1500);
      await p.mouse.click(800, 450); for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(900); }
      const at = await p.evaluate(() => { const root = [...document.querySelectorAll('*')].find(e => e.shadowRoot)?.shadowRoot; const s = [...(root?.querySelectorAll('section.psd-slide') ?? [])]; return s.findIndex(x => { const r = x.getBoundingClientRect(); return r.top > -10 && r.top < 10 && r.left > -10 && r.left < 10; }); });
      await ctx.close(); need(at === 3, `after three presses the deck is on slide ${at + 1}`);
    });
  } else note('sent file checks', false, 'skipped: the web deck was not downloaded');
} catch (e) {
  note('the run itself', false, String(e?.message ?? e).split('\n')[0]);
} finally {
  await browser?.close().catch(() => undefined);
  server.kill();
}

const failed = rows.filter(r => !r.ok);
const esc = s => String(s).replace(/\|/g, '\\|');
const md = [`### ${name}: ${failed.length ? `${failed.length} of ${rows.length} steps failed` : `all ${rows.length} steps passed`}`, '', '| | Step | Detail |', '|---|---|---|', ...rows.map(r => `| ${r.ok ? '✅' : '❌'} | ${esc(r.step)} | ${esc(r.detail)} |`), ''].join('\n');
writeFileSync(`${out}/report.md`, md);
writeFileSync(`${out}/report.json`, JSON.stringify({ browser: name, rows }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
process.exit(failed.length ? 1 : 0);
