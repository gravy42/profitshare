// Records the demo video: drives the single-file build in Chromium with a visible cursor and on-screen captions.
// Output: demo/profitshare-demo.webm (convert with ffmpeg; see package.json "demo").
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, renameSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = 'file://' + root + 'dist-single/index.html';
const outDir = root + 'demo/';
mkdirSync(outDir, { recursive: true });
const W = 1280, H = 800;
// Optional voice-over timing: demo/vo-timing.json = { cues: [seconds, ...] } from tools/vo-mux.mjs analyze.
// When present, each cue's on-screen hold stretches to cover the read, and the moment each cue starts is written to
// demo/cue-times.json so the narration can be laid onto the video.
const timing = existsSync(outDir + 'vo-timing.json') ? JSON.parse(readFileSync(outDir + 'vo-timing.json', 'utf8')).cues : null;
const cueTimes = [];
let t0 = 0;
let cueIdx = 0;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: outDir, size: { width: W, height: H } }, colorScheme: 'light' });
const page = await ctx.newPage();
t0 = Date.now();
await page.addInitScript(() => {
  window.addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div'); c.id = '__cursor';
    c.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;pointer-events:none;left:0;top:0;transform:translate(-3px,-2px);transition:transform .05s';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 15 L11.5 21.5 L14.5 20 L11.5 13.8 L17.5 13.5 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    window.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; });
    window.addEventListener('mousedown', () => { c.style.transform = 'translate(-3px,-2px) scale(.8)'; });
    window.addEventListener('mouseup', () => { c.style.transform = 'translate(-3px,-2px) scale(1)'; });
    const cap = document.createElement('div'); cap.id = '__cap';
    cap.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:99998;max-width:900px;background:rgba(20,18,28,.92);color:#fff;padding:12px 20px;border-radius:12px;font:600 17px/1.35 Helvetica Neue,Helvetica,Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:0;transition:opacity .3s;text-align:center;pointer-events:none';
    document.body.appendChild(cap);
    window.__caption = t => { if (!t) { cap.style.opacity = '0'; return; } cap.textContent = t; cap.style.opacity = '1'; };
    window.__card = (title, sub) => {
      let k = document.getElementById('__card');
      if (!title) { if (k) { k.style.opacity = '0'; k.style.pointerEvents = 'none'; } return; }
      if (!k) { k = document.createElement('div'); k.id = '__card'; k.style.cssText = 'position:fixed;inset:0;z-index:99997;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:linear-gradient(120deg,#4b2a6b,#1f6f6b);color:#fff;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;transition:opacity .5s;text-align:center;padding:40px'; document.body.appendChild(k); }
      k.innerHTML = `<div style="font-size:54px;font-weight:800;letter-spacing:.5px">${title}</div><div style="font-size:22px;opacity:.9;max-width:760px;line-height:1.4">${sub}</div>`;
      k.style.opacity = '1'; k.style.pointerEvents = 'auto';
    };
  });
});

const wait = ms => page.waitForTimeout(ms);
// DEMO_CAPTIONS=off records without the on-screen captions (the narrated cut carries them as a subtitle track instead)
const burnIn = process.env.DEMO_CAPTIONS !== 'off';
const cap = async (t, ms = 0) => { if (burnIn) await page.evaluate(t => window.__caption(t), t); if (ms) await wait(ms); };
const card = async (title, sub, ms = 0) => { await page.evaluate(([a, b]) => window.__card(a, b), [title, sub]); if (ms) await wait(ms); };
// a cue = one narration line. `after` is the on-screen action that happens while it plays (runs after `lead` ms).
const holdFor = (ms) => timing && timing[cueIdx] !== undefined ? Math.max(ms, Math.round(timing[cueIdx] * 1000) + 700) : ms;
const cue = async (text, ms, { isCard = false, sub = '' } = {}) => {
  cueTimes.push(Math.round((Date.now() - t0)) / 1000);
  const hold = holdFor(ms); cueIdx++;
  if (isCard) await card(text, sub, hold); else await cap(text, hold);
};
let cur = { x: W / 2, y: H / 2 };
const moveTo = async (loc, dwell = 250) => {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box');
  const x = b.x + Math.min(b.width / 2, 60), y = b.y + b.height / 2;
  const d = Math.hypot(x - cur.x, y - cur.y);
  await page.mouse.move(x, y, { steps: Math.max(12, Math.min(40, Math.round(d / 18))) });
  cur = { x, y }; await wait(dwell);
};
const click = async (loc, dwell = 500) => { await moveTo(loc); await page.mouse.down(); await wait(90); await page.mouse.up(); await wait(dwell); };
const scrollTo = async (px, ms = 700) => { await page.evaluate(y => window.scrollTo({ top: y, behavior: 'smooth' }), px); await wait(ms); };

await page.goto(file);
await page.mouse.move(cur.x, cur.y);
await wait(400);
await cue('ProfitShare', 3200, { isCard: true, sub: 'Open-source budgeting, scheduling and profit-share modelling for independent films.<br>Local-first. No accounts. MIT.' });
await card(null);
await wait(300);

// 2. start screen
await cue('Three ways in: start from scratch, drop in a budget you already have, or load the sample.', 3000);
await click(page.getByRole('button', { name: 'Load the sample' }), 900);

// 3. the deal tab
await cue('One page for every term of the deal, on top of the budget, never rewriting it. Salt Flat: an invented 12-day SAG feature, $811,758 as budgeted.', 6000);
await scrollTo(560, 900);

// 4. everyone at scale
const c4 = cue('Flip to the Sing Sing deal: one hourly for everyone, above and below the line, overtime on top. The budget reprices while you watch.', 4200);
await wait(1200); await click(page.getByText('Everyone at scale (the'), 300); await c4;
await scrollTo(1000, 800);

// 5. premiums
const c5 = cue('Producer fees, the script, the star allowance: each can stay up front, move to points, or come off the budget entirely.', 4800);
await wait(600);
for (const sel of await page.locator('table select').all()) { await moveTo(sel, 150); await sel.selectOption('points'); await wait(500); }
await c5;
await scrollTo(1250, 800);

// 6. floor rate
const c6 = cue('Prep, wrap and post days at a floor rate, balance on the back end. Days worked don\'t change, so nobody\'s points change. What they\'re paid up front does.', 4600);
await wait(800); await click(page.getByLabel(/Pay non-shoot days/), 300); await c6;
await scrollTo(0, 500);
await cap(null);

// 7. top sheet
await click(page.getByRole('button', { name: 'Top sheet & budget', exact: true }), 500);
const c7 = cue('The top sheet shows the result. Lines the deal set are marked; days and descriptions are still yours.', 3600);
await click(page.getByText('1200 PRODUCERS'), 400); await click(page.getByText('1201 PRODUCERS'), 400); await c7;
await cap(null);

// 8. SAG tab
await click(page.getByRole('button', { name: 'SAG tier', exact: true }), 500);
await cue('SAG sets your tier by total production cost. Profit-share points aren\'t part of that cost, which is what makes this work.', 4200);
await cap(null);

// 9. points tab
await click(page.getByRole('button', { name: 'Points & waterfall', exact: true }), 500);
const c9 = cue('The back end splits by days worked times a tier multiplier, at three revenue scenarios. Grants are never recouped. Everyone on the schedule is here, wages next to their points.', 6500);
await wait(2600); await scrollTo(420, 1200); await c9;
await scrollTo(0, 400);
await cap(null);

// 10. stripboard
await click(page.getByRole('button', { name: 'Stripboard', exact: true }), 500);
const c10 = cue('The stripboard: ease, flexibility, and integration with your budget. Drag and reorder, set the shoot days and pages per day, then push cast days into the budget and the points schedule follows.', 8000);
await wait(1200);
const daysBox = page.locator('.ctl', { hasText: 'Shoot days' }).locator('input').first(); await moveTo(daysBox, 200); await daysBox.fill('11'); await wait(500); await daysBox.fill('12'); await wait(400);
await click(page.getByRole('button', { name: /^Fit to \d+ days$/ }), 900);
await scrollTo(500, 900); await scrollTo(0, 400);
await click(page.getByRole('button', { name: /Push cast days/ }), 400); await c10;
await cap(null);

// 11. drag and drop
await click(page.getByRole('button', { name: 'New…' }), 500);
const c11 = cue('Bring your own: drop a Shamel export, a Movie Magic export, a Movie Magic board, or a script from Final Draft, Highland, Celtx or a PDF anywhere on the page. It works out what it got.', 9000);
const csv = readFileSync(root + 'tools/fixtures/mmb-export.csv', 'utf8');
await page.evaluate(() => { const ev = new DragEvent('dragenter', { bubbles: true, dataTransfer: new DataTransfer() }); ev.dataTransfer.items.add(new File(['x'], 'x.csv')); window.dispatchEvent(ev); });
await moveTo(page.locator('.dropzone > div'), 1400);
await page.evaluate(() => { const ev = new DragEvent('dragleave', { bubbles: true, dataTransfer: new DataTransfer() }); ev.dataTransfer.items.add(new File(['x'], 'x.csv')); window.dispatchEvent(ev); });
await click(page.getByRole('button', { name: /Import \.xlsx/ }), 200);   // arms the replace guard
await page.evaluate(() => { const ev = new DragEvent('dragenter', { bubbles: true, dataTransfer: new DataTransfer() }); ev.dataTransfer.items.add(new File(['x'], 'x.csv')); window.dispatchEvent(ev); });
await wait(300);
await page.evaluate(text => { const dt = new DataTransfer(); dt.items.add(new File([text], 'movie-magic-export.csv', { type: 'text/csv' })); window.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt })); }, csv);
await wait(800);
await click(page.getByRole('button', { name: 'Top sheet & budget', exact: true }), 400);
await click(page.getByText('2100 PRODUCTION STAFF'), 400); await click(page.getByText('2102 1ST ASSISTANT DIRECTOR'), 400);
// ...then a screenplay PDF, which lands on the stripboard broken down into scenes, eighths and cast
const pdf = readFileSync(root + 'tools/fixtures/SaltFlat_Script.pdf').toString('base64');
await page.evaluate(() => { const ev = new DragEvent('dragenter', { bubbles: true, dataTransfer: new DataTransfer() }); ev.dataTransfer.items.add(new File(['x'], 'x.pdf')); window.dispatchEvent(ev); });
await wait(500);
await page.evaluate(b64 => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'SaltFlat_Script.pdf', { type: 'application/pdf' })); window.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt })); }, pdf);
await page.getByText('DESERT HIGHWAY').first().waitFor({ timeout: 15000 });
await wait(1200);
await scrollTo(300, 900);
await c11;
await cap(null);

// 12. end card
await cue('ProfitShare', 4200, { isCard: true, sub: 'github.com/gravy42/profitshare<br><span style="font-size:18px;opacity:.85">Free, open source, and yours. Budget, stripboard, SAG tier and profit-share waterfall in one file.</span>' });

writeFileSync(outDir + 'cue-times.json', JSON.stringify({ cues: cueTimes }, null, 1));
await page.close();
await ctx.close();
await browser.close();
const webm = readdirSync(outDir).find(f => f.endsWith('.webm'));
renameSync(outDir + webm, outDir + 'profitshare-demo.webm');
console.log('wrote demo/profitshare-demo.webm; cue starts (s):', cueTimes.map(t => t.toFixed(1)).join(' '));
