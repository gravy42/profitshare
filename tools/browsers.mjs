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
const port = Number(process.env.PORT) || 4300 + Object.keys(engines).indexOf(name);   // PORT: another port, when something else on this machine has the usual one
const origin = `http://127.0.0.1:${port}`;

const rows = [];
const note = (step, ok, detail = '') => { rows.push({ step, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? `: ${detail}` : ''}`); };
const step = async (label, fn) => {
  try { const detail = await fn(); note(label, true, detail ?? ''); return true; }
  catch (e) { note(label, false, String(e?.message ?? e).split('\n')[0].slice(0, 300)); return false; }
};
const need = (cond, message) => { if (!cond) throw new Error(message); };

// The built page carries a Content-Security-Policy (tools/csp.mjs). Whatever it stops is heard two ways: the page's own
// `securitypolicyviolation` event (heard from the first script on, in every document of the context), and the
// browser's console, which is also where a worker's refusals are said. Returns the list, filled as the page runs.
const POLICY_WORDS = /content[ -]security[ -]policy/i;
async function watchPolicy(context, page) {
  const refused = [];
  await context.exposeBinding('__policyRefused', (_source, what) => { refused.push(String(what)); });
  await context.addInitScript(() => {
    addEventListener('securitypolicyviolation', e => {
      const from = e.sourceFile ? ` (from ${e.sourceFile.split('/').pop()}${e.lineNumber ? `:${e.lineNumber}` : ''})` : '';
      window.__policyRefused?.(`${e.effectiveDirective || e.violatedDirective} refused ${e.blockedURI || 'inline'}${from}`);
    });
  });
  page.on('console', m => { if (POLICY_WORDS.test(m.text())) refused.push(`console: ${m.text().slice(0, 240)}`); });
  return refused;
}

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
  const refused = await watchPolicy(context, page);   // everything the page's Content-Security-Policy stopped
  const shot = (file, target = page) => target.screenshot({ path: `${out}/${file}.png` }).catch(() => undefined);
  const deckSlides = () => page.evaluate(() => document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide').length ?? 0);
  const download = async (click, file) => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), click()]);
    const path = `${out}/${file}`; await d.saveAs(path); saved[file] = path; return { path, name: d.suggestedFilename() };
  };

  await step('the app opens', async () => { await page.goto(origin); await page.getByRole('button', { name: 'Load the sample' }).waitFor({ timeout: 20000 }); });
  await step('the page carries its policy', async () => {
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content', { timeout: 5000 });
    const scripts = /(?:^|;)\s*script-src ([^;]*)/.exec(policy)?.[1] ?? '';
    need(/^default-src 'none'/.test(policy), `the policy does not start from nothing: ${policy.slice(0, 80)}`);
    need(scripts && !scripts.split(/\s+/).some(src => src === "'unsafe-inline'" || src === "'unsafe-eval'"), `script-src is "${scripts}"`);
    need(await page.locator('head script:not([src])').count() > 0 && refused.length === 0, `the page's own inline script was refused: ${refused[0]}`);
    return policy;
  });
  await step('the sample loads', async () => { await page.getByRole('button', { name: 'Load the sample' }).click(); await page.waitForTimeout(600); await shot('01-sample'); });
  const TABS = ['Top sheet & budget', 'Deal', 'Stripboard', 'Calendar', 'Call sheets', 'Breakdowns', 'Points & waterfall', 'SAG tier', 'Incentives', 'About', 'Start', 'Pitch'];
  for (const label of TABS) {
    await step(`tab: ${label}`, async () => { await page.getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(500); await shot(`02-tab-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`); });
  }
  await step('the pitch deck preview draws 14 slides', async () => {
    await page.locator('#pitch-deck').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide').length === 14, null, { timeout: 20000 });
    await page.locator('#pitch-deck .pd-preview').scrollIntoViewIfNeeded(); await page.waitForTimeout(800); await shot('03-pitch-deck');
  });
  await step('no slide overflows in the preview', async () => {
    const over = await page.evaluate(() => [...(document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide[data-overflow="true"]') ?? [])].map(s => s.id || s.getAttribute('aria-label')));
    need(over.length === 0, `overflowing: ${over.join(', ')}`);
  });
  await step('the preview pages with its buttons', async () => {
    for (let i = 0; i < 4; i++) { await page.getByRole('button', { name: 'Next slide' }).click(); await page.waitForTimeout(700); }
    const at = (await page.locator('#pitch-deck .pd-count').innerText()).replace(/\s+/g, ' ').trim();
    need(/5 \/ 14$/.test(at), `the counter says "${at}"`); await shot('04-pitch-slide-5');
  });
  await step('a slide opens in the editor', async () => {
    await page.locator('#pitch-deck .pd-row .pd-pick').nth(1).click();
    await page.locator('#pitch-deck .pd-editor').waitFor({ timeout: 10000 }); await page.waitForTimeout(600); await shot('04-slide-editor');
  });
  await step('Play replays a slide', async () => { await page.getByRole('button', { name: /^Play/ }).first().click(); await page.waitForTimeout(1500); await shot('05-play'); });
  await step('the design builder proposes looks from pictures', async () => {
    const open = page.getByRole('button', { name: 'Build one from my pictures' });
    await open.scrollIntoViewIfNeeded(); await open.click(); await page.waitForTimeout(800); await shot('06-design-builder');
  });
  // The font picker, as far as its question: CI must not depend on Google, so the answer given here is "Not now".
  await step('the font picker asks before it asks Google for anything', async () => {
    const open = page.getByRole('button', { name: 'Pick the title font from Google Fonts' });
    await open.scrollIntoViewIfNeeded(); await open.click();
    const dialog = page.getByRole('dialog', { name: 'Pick a title font from Google Fonts' });
    await dialog.getByText('Browsing fonts loads previews from Google Fonts (fonts.googleapis.com and fonts.gstatic.com).', { exact: false }).waitFor({ timeout: 15000 });
    await dialog.getByText('Nothing about your project is sent.', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Show the fonts' }).waitFor();
    await page.waitForTimeout(400); await shot('07-font-picker');
    need(outside.length === 0, `asked for ${outside[0]} before any answer`);
    await dialog.getByRole('button', { name: 'Not now' }).click();
    await dialog.locator('[role="listbox"] [role="option"]').first().waitFor({ timeout: 15000 });
    const rows = await dialog.locator('[role="listbox"] [role="option"]').count(); const count = (await dialog.locator('.gf-count').innerText()).trim();
    need(/^[\d,]+ fonts$/.test(count) && rows > 3, `the list says "${count}" and shows ${rows} rows`);
    await page.waitForTimeout(600); await shot('07-font-picker-names');
    need(outside.length === 0, `asked for ${outside[0]} after "Not now"`);
    need(await page.locator('link[href*="google"], link[href*="gstatic"]').count() === 0, 'a link to Google is in the page');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached', timeout: 5000 });
    return `${count}, listed by name; nothing asked of Google`;
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
    need(n === 14, `the PDF has ${n} pages, not 14`); need(kb > 300, `the PDF is only ${kb.toFixed(0)} kB, so its pages are probably blank`);
    return `${d.name}, ${n} pages, ${kb.toFixed(0)} kB`;
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
  // Files brought in from outside, each read by its own importer (a PDF by pdf.js, in a worker made from a blob:).
  const bring = async (button, file, said) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.getByRole('button', { name: button, exact: true }).click()]);
    await chooser.setFiles(`tools/fixtures/${file}`);
    const status = page.locator('main [role="status"]').first();
    await page.waitForFunction(re => new RegExp(re, 'i').test(document.querySelector('main [role="status"]')?.textContent ?? ''), said, { timeout: 30000 }).catch(() => undefined);
    const text = (await status.innerText()).replace(/\s+/g, ' ').trim();
    need(new RegExp(said, 'i').test(text), `after ${file} the page says "${text.slice(0, 160)}"`);
    const dismiss = page.getByRole('button', { name: 'Dismiss this message' }); if (await dismiss.count()) await dismiss.first().click();
    return text.slice(0, 120);
  };
  await step('look book: the pages of a PDF, drawn as pictures', async () => {
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();
    const book = page.locator('#pitch-lookbook'); await book.scrollIntoViewIfNeeded();
    const had = await book.locator('figure').count();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), book.getByRole('button', { name: 'Add the pages of a PDF' }).click()]);
    await chooser.setFiles('tools/fixtures/SaltFlat_Script.pdf');
    await page.waitForFunction(n => document.querySelectorAll('#pitch-lookbook figure img').length > n, had, { timeout: 60000 });
    return `${await book.locator('figure').count() - had} pages added`;
  });
  // A PDF whose picture is a JPEG 2000: pdf.js decodes those in WebAssembly, which the policy has to allow by name.
  await step('look book: a PDF with a JPEG 2000 picture in it', async () => {
    const book = page.locator('#pitch-lookbook'); await book.scrollIntoViewIfNeeded();
    const had = await book.locator('figure').count(), said = refused.length;
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), book.getByRole('button', { name: 'Add the pages of a PDF' }).click()]);
    await chooser.setFiles('tools/fixtures/jpx-picture.pdf');
    await page.waitForFunction(n => document.querySelectorAll('#pitch-lookbook figure img').length > n, had, { timeout: 60000 });
    need(refused.length === said, `the picture was not decoded: ${refused[said]}`);
    // the page is the picture, edge to edge: a page left white means the decoder did not run
    const dark = await page.evaluate(async () => {
      const img = [...document.querySelectorAll('#pitch-lookbook figure img')].pop(); await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 720) n++; return n;
    });
    need(dark > 32, `only ${dark} of 64 sampled points of the page are not white`);
  });
  const BUDGET = 'Import budget (.xlsx / .csv)', BOARD = 'Import board or script (.sex / .fdx / .pdf)';
  await step('import: a budget (.xlsx)', () => bring(BUDGET, 'Budget_SaltFlat_Draft3.xlsx', 'Budget_SaltFlat_Draft3'));
  await step('import: a budget (.csv)', () => bring(BUDGET, 'mmb-export.csv', 'mmb-export'));
  await step('import: a board (.sex)', () => bring(BOARD, 'SaltFlat_Board.sex', 'SaltFlat_Board'));
  await step('import: a script (.fdx)', () => bring(BOARD, 'sample.fdx', 'sample\\.fdx'));
  await step('import: a script (.fountain)', () => bring(BOARD, 'SaltFlat_Script.fountain', 'SaltFlat_Script'));
  await step('import: a script (.pdf)', () => bring(BOARD, 'SaltFlat_Script.pdf', 'SaltFlat_Script'));
  await step('the policy refused nothing the app does', async () => { need(refused.length === 0, `${refused.length} refused: ${[...new Set(refused)].slice(0, 4).join(' | ')}`); });
  await step('the app logged no errors', async () => { need(errors.length === 0, errors.slice(0, 4).join(' | ')); });
  await step('the app asked for nothing outside itself', async () => { need(outside.length === 0, outside.slice(0, 3).join(' | ')); });
  await context.close();

  // ---- names: every field and button on every tab has one a screen reader can say --------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const named = await ctx.newPage();
    await named.goto(origin); await named.getByRole('button', { name: 'Load the sample' }).click(); await named.waitForTimeout(600);
    await step('every field and button has a name', async () => {
      const bare = []; let seen = 0;
      for (const label of TABS) {
        await named.getByRole('button', { name: label, exact: true }).click(); await named.waitForTimeout(500);
        const r = await named.evaluate(() => {
          const shown = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
          const has = el => !!(el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby') || el.title?.trim() || el.closest('label')
            || (el.id && [...document.querySelectorAll('label[for]')].some(l => l.getAttribute('for') === el.id)));
          const fields = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter(shown);
          const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(shown);
          const none = [...fields.filter(f => !has(f)), ...buttons.filter(b => !has(b) && !b.textContent.trim())];
          return { count: fields.length + buttons.length, none: none.slice(0, 3).map(e => e.outerHTML.slice(0, 90)), n: none.length };
        });
        seen += r.count; if (r.n) bare.push(`${label}: ${r.n} (${r.none.join(' ')})`);
      }
      need(bare.length === 0, bare.join('; ')); return `${seen} fields and buttons`;
    });
    await ctx.close();
  }

  // ---- a phone: no tab may push the page wider than the screen -------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await ctx.newPage();
    await phone.goto(origin); await phone.getByRole('button', { name: 'Load the sample' }).click(); await phone.waitForTimeout(600);
    // which elements stick out past the screen without a scrolling box around them, widest first: says what to fix
    const widest = () => {
      const vw = document.documentElement.clientWidth, out = [];
      const all = root => { for (const el of root.querySelectorAll('*')) { see(el); if (el.shadowRoot) all(el.shadowRoot); } };
      const say = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className?.baseVal ?? el.className).split(' ').slice(0, 2).join('.')}`;
      const see = el => {
        // an element's box can end inside the screen while its words or pictures spill out of it: count the spill too
        const r = el.getBoundingClientRect(); const cs0 = getComputedStyle(el); const spills = cs0.overflowX === 'visible' && cs0.display !== 'inline' && el.scrollWidth > el.clientWidth + 1;
        const far = Math.max(r.right, spills ? r.left + el.scrollWidth : 0); if (far <= vw + 1) return;
        // held in by a box that clips sideways and itself ends inside the screen?
        let p = el.parentElement ?? el.getRootNode().host, held = false;
        while (p && p !== document.documentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && p.getBoundingClientRect().right <= vw + 1) { held = true; break; } p = p.parentElement ?? p.getRootNode().host; }
        if (!held) { const cs = getComputedStyle(el); out.push([Math.round(far - vw), `${say(el)} ${cs.display}/${cs.position} w${Math.round(r.width)} sw${el.scrollWidth} "${(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)}" in ${el.parentElement ? say(el.parentElement) : 'shadow'}`]); }
      };
      all(document);
      const d = document.documentElement, b = document.body;
      // whatever the cause, hiding the culprit removes the overflow: walk down to the smallest element that does
      const trail = []; let node = b;
      for (let depth = 0; depth < 14; depth++) {
        let found = null;
        for (const kid of node.children) {
          const was = kid.style.display; kid.style.display = 'none'; const ok = d.scrollWidth <= vw + 1; kid.style.display = was;
          if (ok) { found = kid; break; }
        }
        if (!found) break;
        const r = found.getBoundingClientRect(), cs = getComputedStyle(found);
        trail.push(`${say(found)}[${cs.display} ${Math.round(r.left)}..${Math.round(r.right)} sw${found.scrollWidth} ox:${cs.overflowX}]`); node = found;
      }
      out.unshift([d.scrollWidth - vw, `CULPRIT ${trail.join(' > ') || 'none found by hiding'} "${(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`]);
      return `html ${d.scrollWidth}/${d.clientWidth} body ${b.scrollWidth}/${b.clientWidth}: ` + (out.slice(0, 9).map(([n, t]) => `${t} +${n}`).join(' | ') || 'no element past the edge');
    };
    await step('at phone width no tab scrolls the page sideways', async () => {
      const wide = [];
      for (const label of TABS) {
        await phone.getByRole('button', { name: label, exact: true }).click(); await phone.waitForTimeout(400);
        const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 1) { wide.push(`${label} +${over}px`); console.log(`     ${label} is ${over}px too wide: ${await phone.evaluate(widest)}`); }
      }
      need(wide.length === 0, wide.join(', ')); return `${TABS.length} tabs`;
    });
    await ctx.close();
  }

  // ---- the policy, tried: what it must let through, and what it must stop ------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // Google is not asked for anything here (CI must not depend on it): the two hosts are cut off at the wire. A request
    // the policy lets through is seen leaving and then fails; one the policy stops is never seen at all.
    // (`asked` is filled at the wire and not from the page's 'request' event, which Chromium also raises for a request its policy then stops.)
    const asked = [];
    await ctx.route(u => !String(u).startsWith(origin) && !/^(data|blob|about):/.test(String(u)), r => { asked.push(r.request().url()); return r.abort(); });
    const p = await ctx.newPage();
    const stopped = await watchPolicy(ctx, p);
    await step('policy: the font picker may ask Google Fonts', async () => {
      await p.goto(origin); await p.getByRole('button', { name: 'Load the sample' }).click({ timeout: 20000 }); await p.waitForTimeout(500);
      await p.getByRole('button', { name: 'Pitch', exact: true }).click();
      const open = p.getByRole('button', { name: 'Pick the title font from Google Fonts' });
      await open.scrollIntoViewIfNeeded(); await open.click();
      await p.getByRole('dialog').getByRole('button', { name: 'Show the fonts' }).click();
      for (let i = 0; i < 40 && !asked.some(u => u.startsWith('https://fonts.googleapis.com/')); i++) await p.waitForTimeout(250);
      need(asked.some(u => u.startsWith('https://fonts.googleapis.com/')), 'no request for fonts.googleapis.com left the page');
      need(stopped.length === 0, `the policy refused: ${stopped[0]}`);
      await p.keyboard.press('Escape');
      return `${asked.length} request${asked.length === 1 ? '' : 's'} left for Google Fonts (cut off at the wire here); none refused by the policy`;
    });
    const tried = async (label, directive, attempt) => step(label, async () => {
      const before = stopped.length, left = asked.length;
      const result = await p.evaluate(attempt); await p.waitForTimeout(400);
      const mine = stopped.slice(before);
      need(result === 'stopped', `it was not stopped: ${result}`);
      need(mine.length > 0, 'it did not happen, but the policy reported no refusal');
      need(asked.length === left, `a request left the page: ${asked[left]}`);
      return mine.find(v => v.startsWith(directive)) ?? mine[0];
    });
    await tried('policy: fetch() to another site is stopped', 'connect-src', () => fetch('https://example.com/').then(() => 'answered', () => 'stopped'));
    await tried('policy: a picture from another site is stopped', 'img-src', () => new Promise(done => {
      const img = new Image(); img.onload = () => done('loaded'); img.onerror = () => done('stopped'); img.src = 'https://example.com/x.png'; document.body.appendChild(img);
    }));
    await tried('policy: an injected inline script does not run', 'script-src', () => {
      const s = document.createElement('script'); s.textContent = 'window.__injected = true'; document.head.appendChild(s);
      return window.__injected ? 'it ran' : 'stopped';
    });
    await tried('policy: a script from another site is stopped', 'script-src', () => new Promise(done => {
      const s = document.createElement('script'); s.onload = () => done('loaded'); s.onerror = () => done('stopped'); s.src = 'https://example.com/x.js'; document.head.appendChild(s);
    }));
    await tried('policy: a frame is stopped', 'frame-src', () => new Promise(done => {
      const f = document.createElement('iframe'); f.src = 'https://example.com/'; document.body.appendChild(f); setTimeout(() => done('stopped'), 300);
    }));
    await ctx.close();
  }

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
      need(r.slides === 14, `${r.slides} slides`); need(r.errs.length === 0, r.errs.slice(0, 3).join(' | ')); need(r.asked.length === 0, `asked for ${r.asked[0]}`);
      need(r.over === 0, `${r.over} slides overflow`); need(r.failed.length === 0, `fonts failed: ${r.failed.join(', ')}`);
      withGrants = r.ask; return `${r.ask}; fonts ${[...new Set(r.fonts)].join(', ') || 'none loaded'}`;
    });
    await step('sent file: #without opens the larger ask', async () => {
      const r = await reader('without', { width: 1600, height: 900 }, '#without');
      need(r.ask && r.ask !== withGrants, `the ask reads "${r.ask}" both ways`); return r.ask;
    });
    await step('sent file, 1024x768', async () => { const r = await reader('1024', { width: 1024, height: 768 }); need(r.slides === 14 && r.over === 0 && r.errs.length === 0, `${r.slides} slides, ${r.over} overflow, ${r.errs[0] ?? ''}`); });
    await step('sent file on a phone, 390x844', async () => {
      const r = await reader('phone', { width: 390, height: 844 });
      need(r.slides === 14, `${r.slides} slides`); need(!r.wide, 'the page scrolls sideways'); need(r.errs.length === 0, r.errs.slice(0, 2).join(' | '));
    });
    await step('sent file: every slide, one by one', async () => {
      const ctx = await sealed({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
      const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(1500);
      for (let i = 0; i < 14; i++) {
        await p.evaluate(n => { const root = [...document.querySelectorAll('*')].find(e => e.shadowRoot)?.shadowRoot; root?.querySelectorAll('section.psd-slide')[n]?.scrollIntoView({ behavior: 'instant' }); }, i);
        await p.waitForTimeout(350); await p.screenshot({ path: `${out}/20-slide-${String(i + 1).padStart(2, '0')}.png` });
      }
      // One small sheet of all fourteen, printed into the log when asked (BROWSER_SHEET=1), so a run on a machine nobody
      // can open still shows what the browser drew.
      if (process.env.BROWSER_SHEET) {
        const imgs = Array.from({ length: 14 }, (_, i) => `<img src="data:image/png;base64,${readFileSync(`${out}/20-slide-${String(i + 1).padStart(2, '0')}.png`).toString('base64')}">`).join('');
        const sheet = await ctx.newPage(); await sheet.setViewportSize({ width: 1640, height: 1200 });
        await sheet.setContent(`<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(4,400px);gap:8px;padding:8px">${imgs}<style>img{width:400px;display:block}</style></body>`);
        await sheet.waitForTimeout(800);
        const jpg = await sheet.screenshot({ type: 'jpeg', quality: 62, fullPage: true });
        writeFileSync(`${out}/sheet.jpg`, jpg);
        const b64 = jpg.toString('base64'); console.log('SHEET-BEGIN');
        for (let i = 0; i < b64.length; i += 4000) console.log('SHEET ' + b64.slice(i, i + 4000));
        console.log('SHEET-END');
      }
      await ctx.close();
    });
    await step('sent file: arrow keys page it', async () => {
      const ctx = await sealed({ viewport: { width: 1600, height: 900 } });
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
