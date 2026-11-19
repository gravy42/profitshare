// The Google Fonts picker against the REAL Google Fonts, in one browser engine: `BROWSER=webkit node
// tools/google-fonts-live.mjs` (chromium, firefox or webkit; PORT for another port). It builds nothing: run
// `npm run build` first. This is the only script here that needs the internet, so it is not part of `npm test`,
// `npm run browsers`: a CI job of its own runs it and is allowed to fail when Google is down.
// Every step is tried even when an earlier one failed; the report is printed and written to
// browsers-out/google-live-<browser>/. With BROWSER_SHEET=1 one small picture of the picker, with the previews Google
// sent, is printed into the log (the same SHEET lines tools/browsers.mjs prints).
//
// FAKE_GOOGLE=1 is for trying this script itself where Google cannot be reached (a sandbox): it answers the two
// hosts from the app's own bundled font files, so the steps and selectors can be proved, and proves nothing about
// Google. A fake family is never a variable font, so the bold-against-regular check is only noted there.
import { chromium, firefox, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const engines = { chromium, firefox, webkit };
const name = process.env.BROWSER || 'chromium';
const engine = engines[name];
if (!engine) { console.error(`BROWSER must be one of ${Object.keys(engines).join(', ')}`); process.exit(2); }
const FAKE = process.env.FAKE_GOOGLE === '1';
const out = `browsers-out/google-live-${name}`;
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT) || 4310 + Object.keys(engines).indexOf(name);
const origin = `http://127.0.0.1:${port}`;
const TITLE = process.env.LIVE_TITLE_FONT || 'Lora', BODY = process.env.LIVE_BODY_FONT || 'Inter';   // both variable families in the catalogue
const HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const rows = [];
const note = (step, ok, detail = '') => { rows.push({ step, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? `: ${detail}` : ''}`); };
const step = async (label, fn) => {
  try { const detail = await fn(); note(label, true, detail ?? ''); return true; }
  catch (e) { note(label, false, String(e?.message ?? e).split('\n')[0].slice(0, 400)); return false; }
};
const need = (cond, message) => { if (!cond) throw new Error(message); };

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { server.kill(); } };
const up = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) return; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 500)); } throw new Error('the preview server did not start'); };

/** Local use only (FAKE_GOOGLE=1): the two hosts answered from node_modules/@fontsource, in the form Google documents. */
async function fakeGoogle(context) {
  const file = (family, weight, style) => readFileSync(`node_modules/@fontsource/${family}/files/${family}-latin-${weight}-${style}.woff2`);
  const pool = slug => (/inter|sans|roboto|lato/.test(slug) ? 'work-sans' : /lora/.test(slug) || slug.length % 2 ? 'caveat' : 'special-elite');
  const bytes = (slug, weight, style) => { const p = pool(slug); return p === 'work-sans' ? file(p, weight, style) : p === 'caveat' ? file(p, weight >= 600 ? 700 : 400, 'normal') : file(p, 400, 'normal'); };
  const cors = { 'access-control-allow-origin': '*' };
  await context.route(u => HOSTS.includes(new URL(String(u)).hostname), route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'fonts.gstatic.com') {
      const m = /^\/s\/([a-z0-9]+)\/v1\/(\d+)(?:-\d+)?-(normal|italic)\.woff2$/.exec(u.pathname) ?? [null, u.searchParams.get('kit') ?? 'x', '400', 'normal'];
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'font/woff2' }, body: bytes(m[1], +m[2] < 100 ? 400 : Math.min(900, Math.max(100, +m[2])), m[3]) });
    }
    const [family, spec = 'wght@400'] = u.searchParams.get('family').split(':'); const slug = family.toLowerCase().replace(/[^a-z0-9]/g, '');
    const face = (style, weight, src, range) => `@font-face {\n  font-family: '${family}';\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(${src}) format('woff2');\n${range ? `  unicode-range: ${range};\n` : ''}}\n`;
    let css;
    if (u.searchParams.has('text')) css = face('normal', spec.replace('wght@', ''), `https://fonts.gstatic.com/l/font?kit=${slug}&skey=0&v=v1`);
    else {
      const tuples = spec.startsWith('ital,') ? spec.slice('ital,wght@'.length).split(';').map(t => t.split(',')) : spec.slice('wght@'.length).split(';').map(w => ['0', w]);
      css = tuples.flatMap(([ital, w]) => [['latin-ext', 'U+0100-02BA, U+02BD-02C5'], ['latin', 'U+0000-00FF, U+0131, U+0152-0153']].map(([subset, range]) =>
        `/* ${subset} */\n${face(ital === '1' ? 'italic' : 'normal', w.replace('..', ' '), `https://fonts.gstatic.com/s/${slug}${subset === 'latin' ? '' : 'ext'}/v1/${w.replace('..', '-')}-${ital === '1' ? 'italic' : 'normal'}.woff2`, range)}`)).join('');
    }
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/css; charset=utf-8' }, body: css });
  });
}

// What the preview deck (or a sent deck) draws its title and body text with, measured in the page: the name each
// role's font is registered under, the faces registered, and how wide a line is in regular, in bold and in fallbacks.
const measure = async hostSelector => {
  const host = hostSelector ? document.querySelector(hostSelector) : [...document.querySelectorAll('*')].find(e => e.shadowRoot);
  const root = host?.shadowRoot; const psd = root?.querySelector('.psd');
  if (!psd) return null;
  const TEXT = 'Hamburgefonstiv 0123 A Small Road Film';
  const stack = v => psd.style.getPropertyValue(v);
  const first = v => stack(v).split(',')[0].trim().replace(/"/g, '');
  const ctx = document.createElement('canvas').getContext('2d');
  const w = font => { ctx.font = font; return Math.round(ctx.measureText(TEXT).width * 10) / 10; };
  const res = { faces: [...document.fonts].filter(f => f.family.replace(/"/g, '').startsWith('psd-')).map(f => ({ family: f.family.replace(/"/g, ''), weight: f.weight, style: f.style, status: f.status })) };
  for (const role of ['title', 'body']) {
    const n = first(`--psd-${role}-font`);
    await Promise.all(['400', '700'].map(s => document.fonts.load(`${s} 60px "${n}"`, TEXT).catch(() => [])));
    res[role] = { name: n, stack: w(`400 60px ${stack(`--psd-${role}-font`)}`), regular: w(`400 60px "${n}", monospace`), bold: w(`700 60px "${n}", monospace`), mono: w('400 60px monospace'), serif: w('400 60px serif'), sans: w('400 60px sans-serif') };
  }
  const h = root.querySelector('.psd-h');
  res.heading = h ? { font: getComputedStyle(h).fontFamily.split(',')[0].replace(/"/g, ''), text: h.textContent.slice(0, 40) } : null;
  return res;
};

let browser;
const seen = [];        // every request that is not to the app itself
const failed = [];      // requests that failed
const errors = [];      // the page's own errors (a CORS refusal is one)
try {
  await up();
  browser = await engine.launch();
  note('browser', true, `${name} ${browser.version()}${FAKE ? '; FAKE_GOOGLE=1: Google is faked, this run proves the script and nothing about Google' : '; the real Google Fonts'}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  if (FAKE) await fakeGoogle(context);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', r => { if (!r.url().startsWith(origin) && !/^(data|blob|about):/.test(r.url())) seen.push(r.url()); });
  page.on('requestfailed', r => { if (!r.url().startsWith(origin)) failed.push(`${r.url().slice(0, 160)} (${r.failure()?.errorText ?? 'failed'})`); });
  const google = () => seen.filter(u => /google|gstatic/i.test(u));
  const shot = (file, target = page) => target.screenshot({ path: `${out}/${file}.png` }).catch(() => undefined);
  const deckMeasure = () => page.evaluate(measure, '#pitch-deck .pd-host');
  const titleButton = page.getByRole('button', { name: 'Pick the title font from Google Fonts' });
  const bodyButton = page.getByRole('button', { name: 'Pick the body font from Google Fonts' });
  const dialog = page.getByRole('dialog');
  const rowsOnScreen = dialog.locator('[role="listbox"] [role="option"]');
  let before = null, deckFile = null;

  await step('the app opens, the sample loads, the Pitch tab is shown', async () => {
    await page.goto(origin); await page.getByRole('button', { name: 'Load the sample' }).click({ timeout: 20000 }); await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Pitch', exact: true }).click(); await page.waitForTimeout(800);
    await page.locator('#pitch-deck').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide').length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(1200);
    before = await deckMeasure(); need(before, 'the preview deck could not be measured');
    return `before any pick the deck's title is set in "${before.title.name}" (a line is ${before.title.stack} px wide) and its body in "${before.body.name}" (${before.body.stack} px)`;
  });
  await step('before the question is answered nothing is asked of Google', async () => {
    await titleButton.scrollIntoViewIfNeeded(); await titleButton.click();
    await dialog.getByText('Browsing fonts loads previews from Google Fonts (fonts.googleapis.com and fonts.gstatic.com).', { exact: false }).waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Show the fonts' }).waitFor(); await page.waitForTimeout(800);
    await shot('01-question');
    need(seen.length === 0, `asked for ${seen[0]}`);
    need(await page.locator('link[href*="google"], link[href*="gstatic"]').count() === 0, 'a link to Google is in the page');
  });
  await step('Show the fonts: at least 5 rows draw their preview in the family itself', async () => {
    await dialog.getByRole('button', { name: 'Show the fonts' }).click();
    await rowsOnScreen.first().waitFor({ timeout: 15000 });
    // A row counts when the picker itself says its preview is ready, the private face it is drawn with is loaded, and
    // a line set in that face is not as wide as the same line in the fallback behind it: the letters really are the family's.
    const drawn = () => page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d'); const TEXT = 'Hamburgefonstiv Salt Flat 0123';
      const w = font => { ctx.font = font; return ctx.measureText(TEXT).width; };
      const loaded = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, ''));
      const rows = [...document.querySelectorAll('.gf-row')].map(r => {
        const sample = r.querySelector('.gf-sample'); const family = r.querySelector('.gf-name')?.textContent ?? '';
        const state = !sample ? 'no sample' : sample.classList.contains('none') ? 'no preview' : sample.classList.contains('wait') ? 'waiting' : 'ready';
        const stack = state === 'ready' ? getComputedStyle(sample).fontFamily : ''; const names = stack.split(',').map(x => x.trim());
        const face = (names[0] ?? '').replace(/"/g, '');
        const own = state === 'ready' ? w(`400 40px ${stack}`) : 0, fallback = state === 'ready' ? w(`400 40px ${names.slice(1).join(', ') || 'serif'}`) : 0;
        return { family, variable: /Variable/.test(r.querySelector('.gf-meta')?.textContent ?? ''), state, face, faceLoaded: loaded.includes(face), own: Math.round(own), fallback: Math.round(fallback), real: state === 'ready' && loaded.includes(face) && Math.abs(own - fallback) > 0.5 };
      });
      return { rows, real: rows.filter(r => r.real), links: document.querySelectorAll('link[href*="google"], link[href*="gstatic"]').length };
    });
    const enough = d => d.real.length >= 5 && d.real.filter(r => r.variable).length >= 3;
    let d = await drawn();
    for (let i = 0; i < 60 && !enough(d); i++) { await page.waitForTimeout(500); d = await drawn(); }
    await shot('02-previews');
    if (process.env.BROWSER_SHEET) {
      // one small picture of the picker as this browser drew it, printed into the log
      const sheet = await context.newPage(); await sheet.setViewportSize({ width: 900, height: 700 });
      const png = (await dialog.screenshot({ type: 'png' })).toString('base64');
      await sheet.setContent(`<body style="margin:0"><img src="data:image/png;base64,${png}" style="width:900px;display:block"></body>`); await sheet.waitForTimeout(400);
      const jpg = await sheet.screenshot({ type: 'jpeg', quality: 60, fullPage: true }); await sheet.close();
      writeFileSync(`${out}/sheet.jpg`, jpg);
      const b64 = jpg.toString('base64'); console.log('SHEET-BEGIN');
      for (let i = 0; i < b64.length; i += 4000) console.log('SHEET ' + b64.slice(i, i + 4000));
      console.log('SHEET-END');
    }
    const say = r => `${r.family}${r.variable ? ' (variable)' : ''}: ${r.state}${r.state === 'ready' ? `, face "${r.face}" ${r.faceLoaded ? 'loaded' : 'NOT loaded'}, ${r.own} px against ${r.fallback} px in the fallback` : ''}`;
    need(enough(d), `${d.real.length} rows are drawn in their own face, ${d.real.filter(r => r.variable).length} of them variable families (5 and 3 are needed). Rows: ${d.rows.map(say).join('; ')}. Failed requests: ${failed.slice(0, 3).join(' | ') || 'none'}; banner: ${(await dialog.locator('.gf-banner.bad').allInnerTexts()).join(' ') || 'none'}; errors: ${errors.slice(0, 2).join(' | ') || 'none'}`);
    need(d.links === 0, 'a link to Google is in the page: previews are meant to be fetched, not linked');
    const asked = google().filter(u => u.includes('/css2')).map(u => new URL(u).searchParams.get('family'));
    return `${d.real.length} rows drawn in their own face (${d.real.filter(r => r.variable).length} variable): ${d.real.map(r => `${r.family}${r.variable ? '*' : ''} ${r.own}/${r.fallback} px`).join(', ')}; stylesheets asked for: ${asked.length}`;
  });
  const pickWithKeys = async (which, family) => {
    const search = dialog.getByLabel('Search fonts');
    await search.fill(family); await page.waitForTimeout(1500);
    const active = () => page.evaluate(() => document.getElementById(document.querySelector('.gf-list')?.getAttribute('aria-activedescendant') ?? '')?.querySelector('.gf-name')?.textContent ?? '');
    for (let i = 0; i < 12 && (await active()) !== family; i++) await search.press('ArrowDown');
    need((await active()) === family, `the arrow keys did not reach ${family} (the highlight is on "${await active()}")`);
    await shot(which === 'title' ? '03-search-title' : '05-search-body');
    const at = seen.length;
    await search.press('Enter');
    await dialog.waitFor({ state: 'detached', timeout: 45000 }).catch(async () => { throw new Error(`the picker did not close: ${(await dialog.locator('.gf-foot [role="alert"]').allInnerTexts()).join(' ') || 'no message'}; failed requests: ${failed.slice(-3).join(' | ') || 'none'}; errors: ${errors.slice(-2).join(' | ') || 'none'}`); });
    await page.waitForTimeout(1200);
    return seen.slice(at).filter(u => !u.includes('text=') && !u.includes('/l/font'));
  };
  await step(`the title: search "${TITLE}", arrow keys, Enter`, async () => {
    const asked = await pickWithKeys('title', TITLE);
    need(await page.locator('#ds-title-font').inputValue() === TITLE, `the title font field says "${await page.locator('#ds-title-font').inputValue()}"`);
    need(await page.evaluate(() => [...document.fonts].filter(f => f.family.replace(/"/g, '').startsWith('gfp ')).length) === 0, 'preview faces are still registered after the picker closed');
    need(asked.length >= 2 && asked.every(u => HOSTS.includes(new URL(u).hostname)), `asked: ${asked.join(' , ')}`);
    return `asked: ${asked.join(' , ')}; ${(await page.locator('.gf-pick [role="status"]').first().innerText()).replace(/\s+/g, ' ')}`;
  });
  await step('Font files lists it with its weights and its size', async () => {
    await page.locator('.fontfiles').scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    const row = (await page.locator('.fontrow[data-role="title"]').innerText()).replace(/\s+/g, ' ');
    await shot('04-font-files');
    need(new RegExp(`${TITLE} from Google Fonts · [\\d, toand]+(italic )?· \\d+(\\.\\d)? (KB|MB)`).test(row), `the row reads: ${row}`);
    need(/Open licence \((OFL|Apache|UFL)\): can go inside a deck you send\./.test(row), `no licence line in: ${row}`);
    return row.slice(row.indexOf(TITLE), row.indexOf(TITLE) + 110);
  });
  await step('the preview deck draws its title in it: another width than before, and a bold of its own', async () => {
    await page.locator('#pitch-deck').scrollIntoViewIfNeeded(); await page.waitForTimeout(2500);
    const m = await deckMeasure(); need(m, 'the preview deck could not be measured');
    const mine = m.faces.filter(f => f.family === m.title.name);
    need(new RegExp(`^psd-title ${TITLE} `).test(m.title.name), `the title stack starts with "${m.title.name}"`);
    need(mine.length >= 1 && mine.every(f => f.status === 'loaded'), `its faces: ${JSON.stringify(mine)}`);
    need(m.heading?.font === m.title.name, `a headline is set in "${m.heading?.font}"`);
    need(m.title.stack !== before.title.stack, `a line is ${m.title.stack} px wide, the same as before the pick`);
    need(![m.title.mono, m.title.serif, m.title.sans].includes(m.title.regular), `the regular is as wide as a fallback: ${JSON.stringify(m.title)}`);
    const realBold = m.title.bold !== m.title.regular;
    if (!FAKE) need(realBold, `bold is exactly as wide as regular (${m.title.regular} px): it is drawn from the regular, not from the file`);
    await page.locator('#pitch-deck .pd-preview').scrollIntoViewIfNeeded(); await page.waitForTimeout(600); await shot('06-preview-deck');
    return `"${m.title.name}", faces ${mine.map(f => f.weight).join(' and ')}; a line was ${before.title.stack} px and is ${m.title.regular} px; in bold ${m.title.bold} px${realBold ? '' : ' (the same: expected only with FAKE_GOOGLE, where no file is a variable font)'}`;
  });
  await step(`the body: "${BODY}", a variable family`, async () => {
    await bodyButton.scrollIntoViewIfNeeded(); await bodyButton.click();
    await rowsOnScreen.first().waitFor({ timeout: 15000 });
    need(await dialog.getByRole('button', { name: 'Show the fonts' }).count() === 0, 'the question was asked again in the same session');
    const asked = await pickWithKeys('body', BODY);
    need(await page.locator('#ds-body-font').inputValue() === BODY, `the body font field says "${await page.locator('#ds-body-font').inputValue()}"`);
    await page.locator('#pitch-deck').scrollIntoViewIfNeeded(); await page.waitForTimeout(2500);
    const m = await deckMeasure();
    const mine = m.faces.filter(f => f.family === m.body.name);
    need(new RegExp(`^psd-body ${BODY} `).test(m.body.name) && mine.length >= 1 && mine.every(f => f.status === 'loaded'), `body "${m.body.name}", faces ${JSON.stringify(mine)}`);
    need(m.body.stack !== before.body.stack || FAKE, `a line of body text is ${m.body.stack} px wide, the same as before the pick`);
    if (!FAKE) need(m.body.bold !== m.body.regular, `body bold is exactly as wide as regular (${m.body.regular} px)`);
    return `asked: ${asked.join(' , ')}; faces ${mine.map(f => `${f.style === 'italic' ? 'italic ' : ''}${f.weight}`).join(', ')}; regular ${m.body.regular} px, bold ${m.body.bold} px`;
  });
  await step('the project carries the fonts as data: nothing in it points at Google', async () => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'Save', exact: true }).click()]);
    const path = `${out}/project.json`; await d.saveAs(path);
    const text = readFileSync(path, 'utf8'); const files = JSON.parse(text).pitch.design.fontFiles;
    need(files.length >= 2 && files.every(f => /^data:font\/woff2;base64,d09GMg/.test(f.dataUrl) && f.source === 'google' && f.embedOk === true), `font files: ${JSON.stringify(files.map(f => [f.family, f.weight, f.style, String(f.dataUrl).slice(0, 24)]))}`);
    need(!/gstatic|googleapis/i.test(text), 'the project file names an address at Google');
    return files.map(f => `${f.role} ${f.family} ${JSON.stringify(f.weight)}${f.style === 'italic' ? ' italic' : ''}: ${Math.round((f.dataUrl.length - 23) * 3 / 4 / 1000)} kB`).join('; ');
  });
  await step('the web deck is downloaded and names no address', async () => {
    await page.locator('#pitch-send').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    const inside = (await page.locator('.pd-sendfonts').innerText()).replace(/\s+/g, ' ');
    need(inside.includes(`${TITLE} (your title font, from Google Fonts)`) && inside.includes(`${BODY} (your body font, from Google Fonts)`), `Send says: ${inside.slice(0, 200)}`);
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('#pitch-send button', { hasText: 'Download web deck' }).first().click()]);
    deckFile = `${out}/deck.html`; await d.saveAs(deckFile);
    const html = readFileSync(deckFile, 'utf8');
    need(/^<!doctype html>/i.test(html) && html.includes('id="deck-data"'), 'the file is not the deck page');
    need(!/https?:/i.test(html), 'the file names an address');
    // the words are looked for in everything but the bytes of the pictures and fonts (base64 is letters: any short word turns up in it by chance)
    // and outside the page's own <meta http-equiv="Content-Security-Policy">, the one place the letters h-t-t-p belong
    const words = html.replace(/data:[a-z0-9/+.-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:…').replace(/<meta http-equiv=/gi, '<meta equiv=');
    for (const word of ['google', 'gstatic', 'http']) need(!new RegExp(word, 'i').test(words), `the file has "${word}" in it`);
    return `${(html.length / 1000).toFixed(0)} kB`;
  });
  await step('the app itself asked only the two hosts, and logged no errors', async () => {
    const others = seen.filter(u => !HOSTS.includes(new URL(u).hostname));
    need(others.length === 0, `asked elsewhere: ${others.slice(0, 3).join(' | ')}`);
    need(errors.length === 0, errors.slice(0, 4).join(' | '));
    // a preview still on its way when the picker closes is called off by the page itself: that is not a failure
    const real = failed.filter(f => !/ERR_ABORTED|cancell?ed|NS_BINDING_ABORTED/i.test(f));
    need(real.length === 0, `requests that failed: ${real.slice(0, 4).join(' | ')}`);
    return `${seen.length} requests to Google`;
  });
  await context.close();

  if (deckFile) {
    await step('the sent deck, opened from disk with every address refused: the faces load and nothing is asked', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      await ctx.route(u => !/^(file|data|blob|about):/.test(String(u)), r => r.abort());
      const p = await ctx.newPage(); const asked = [], errs = [];
      p.on('request', r => { if (!/^(file|data|blob|about):/.test(r.url())) asked.push(r.url()); });
      p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      await p.goto(pathToFileURL(deckFile).href); await p.waitForTimeout(2500);
      const m = await p.evaluate(measure, null);
      await p.screenshot({ path: `${out}/07-sent-deck.png` });
      await ctx.close();
      need(asked.length === 0, `asked for ${asked[0]}`); need(errs.length === 0, errs.slice(0, 3).join(' | '));
      need(m && new RegExp(`^psd-title ${TITLE} `).test(m.title.name) && new RegExp(`^psd-body ${BODY} `).test(m.body.name), `title "${m?.title.name}", body "${m?.body.name}"`);
      need(m.faces.length >= 2 && m.faces.every(f => f.status === 'loaded'), `faces: ${JSON.stringify(m.faces)}`);
      need(![m.title.mono, m.title.serif, m.title.sans].includes(m.title.regular), `the title is as wide as a fallback: ${JSON.stringify(m.title)}`);
      if (!FAKE) need(m.title.bold !== m.title.regular && m.body.bold !== m.body.regular, `bold is as wide as regular: title ${JSON.stringify(m.title)}, body ${JSON.stringify(m.body)}`);
      return `${m.faces.length} faces loaded (${m.faces.map(f => `${f.family.split(' ').slice(0, -1).join(' ')} ${f.style === 'italic' ? 'italic ' : ''}${f.weight}`).join('; ')}); no request`;
    });
  } else note('the sent deck', false, 'skipped: the web deck was not downloaded');
} catch (e) {
  note('the run itself', false, String(e?.message ?? e).split('\n')[0]);
} finally {
  await browser?.close().catch(() => undefined);
  stop();
}

// every address asked for outside the app, by host and path (the letters of a preview request left off), with a count
const tally = new Map();
for (const u of seen) { const x = new URL(u); const key = `${x.hostname}${x.pathname}${x.searchParams.get('family') ? `?family=${x.searchParams.get('family')}${x.searchParams.has('text') ? '&text=…' : ''}` : x.pathname === '/l/font' ? '?kit=…' : ''}`; tally.set(key, (tally.get(key) ?? 0) + 1); }
console.log(`\nREQUESTS outside the app: ${seen.length}`);
for (const [key, n] of tally) console.log(`  ${n > 1 ? `${n} x ` : ''}${key}`);
console.log(failed.length ? `FAILED REQUESTS\n  ${failed.join('\n  ')}` : 'FAILED REQUESTS: none');
console.log(errors.length ? `PAGE ERRORS\n  ${errors.join('\n  ')}` : 'PAGE ERRORS: none');

const bad = rows.filter(r => !r.ok);
const esc = s => String(s).replace(/\|/g, '\\|');
const md = [`### Google Fonts, live, ${name}${FAKE ? ' (FAKED)' : ''}: ${bad.length ? `${bad.length} of ${rows.length} steps failed` : `all ${rows.length} steps passed`}`, '', '| | Step | Detail |', '|---|---|---|', ...rows.map(r => `| ${r.ok ? '✅' : '❌'} | ${esc(r.step)} | ${esc(r.detail)} |`), '', `Requests outside the app: ${seen.length}. Failed: ${failed.length}. Page errors: ${errors.length}.`, ''].join('\n');
writeFileSync(`${out}/report.md`, md);
writeFileSync(`${out}/report.json`, JSON.stringify({ browser: name, fake: FAKE, rows, requests: [...tally].map(([url, count]) => ({ url, count })), failed, errors }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
process.exit(bad.length ? 1 : 0);
