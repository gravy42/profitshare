// Records the demo video: drives the single-file build in Chromium with a visible cursor and on-screen captions.
// Output: demo/profitshare-demo.webm (convert with ffmpeg; see package.json "demo").
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = 'file://' + root + 'dist-single/index.html';
const outDir = root + 'demo/';
mkdirSync(outDir, { recursive: true });
const W = 1280, H = 800;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: outDir, size: { width: W, height: H } }, colorScheme: 'light' });
const page = await ctx.newPage();
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
const cap = async (t, ms = 0) => { await page.evaluate(t => window.__caption(t), t); if (ms) await wait(ms); };
const card = async (title, sub, ms = 0) => { await page.evaluate(([a, b]) => window.__card(a, b), [title, sub]); if (ms) await wait(ms); };
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
await card('ProfitShare', 'Open-source budgeting, scheduling and profit-share modelling for independent films.<br>Local-first. No accounts. MIT.', 3200);
await card(null);
await wait(300);

// 1. start screen
await cap('Three ways in: start from scratch, drop a file, or load the sample.', 2600);
await click(page.getByRole('button', { name: 'Load the sample' }), 900);
await cap('Salt Flat: an invented 12-day SAG feature. $811,758 in cash, every line with a pay type.', 2600);

// 2. open cast, flip a line to points
await click(page.getByText('1400 CAST'), 500);
await click(page.getByText('1401 PRINCIPAL CAST'), 800);
await cap('Cash is what you raise. Deferred is an IOU. Points live in the back end.', 2400);
const starIdx = await page.locator('tr.line input.l').evaluateAll(els => els.findIndex(e => e.value === 'STAR ALLOWANCE'));
const star = page.locator('tr.line').nth(starIdx);
const paySel = star.locator('select.tag');
await moveTo(paySel, 300);
await paySel.selectOption('points');
await wait(400);
await cap('Move the star allowance to points and the cash budget drops by $15,000, live.', 2800);
await cap(null);

// 3. SAG tab
await click(page.getByRole('button', { name: 'SAG tier', exact: true }), 800);
await cap('SAG measures total production cost. Deferred pay counts; points do not.', 2600);
await click(page.getByRole('button', { name: 'Convert above-scale ATL to points' }), 900);
await cap('Producer fees and the script go to points: $105,000 off the top, and the film drops from Low Budget to Moderate Low Budget scale.', 3600);
await cap(null);

// 4. points tab
await click(page.getByRole('button', { name: 'Points & waterfall', exact: true }), 800);
await cap('The back end is split by days worked times a tier multiplier, at three revenue scenarios.', 2800);
await scrollTo(420, 1600);
await cap('Everyone on the schedule is here, cast and crew, with cash pay next to their points.', 2600);
await scrollTo(0, 600);
await cap(null);

// 5. stripboard
await click(page.getByRole('button', { name: 'Stripboard', exact: true }), 800);
await cap('The stripboard: drag to reorder, or let it place the day breaks.', 2200);
await click(page.getByRole('button', { name: /^Fit to \d+ days$/ }), 900);
await cap('Fit to 12 days keeps your shooting order and balances the pages.', 2400);
await scrollTo(500, 1400);
await scrollTo(0, 600);
await click(page.getByRole('button', { name: /Push cast days/ }), 800);
await cap('Push cast days to the budget: the day-out-of-days sets each actor\'s days on the cast lines and in the points schedule.', 3200);
await cap(null);

// 6. drag and drop
await click(page.getByRole('button', { name: 'New…' }), 700);
await cap('Bring your own: drop a Shamel export, a Movie Magic Budgeting export, a .sex board or a Final Draft script anywhere on the page.', 1200);
const csv = readFileSync(root + 'tools/fixtures/mmb-export.csv', 'utf8');
await page.evaluate(() => { const ev = new DragEvent('dragenter', { bubbles: true, dataTransfer: new DataTransfer() }); ev.dataTransfer.items.add(new File(['x'], 'x.csv')); window.dispatchEvent(ev); });
await moveTo(page.locator('.dropzone > div'), 1800);
await page.evaluate(() => { const ev = new DragEvent('dragleave', { bubbles: true, dataTransfer: new DataTransfer() }); ev.dataTransfer.items.add(new File(['x'], 'x.csv')); window.dispatchEvent(ev); });
// the start screen guards against replacing a project: arm it, then drop for real
await click(page.getByRole('button', { name: /Import \.xlsx/ }), 300);
await page.evaluate(() => { const ev = new DragEvent('dragenter', { bubbles: true, dataTransfer: new DataTransfer() }); ev.dataTransfer.items.add(new File(['x'], 'x.csv')); window.dispatchEvent(ev); });
await wait(300);
await page.evaluate(text => {
  const dt = new DataTransfer(); dt.items.add(new File([text], 'movie-magic-export.csv', { type: 'text/csv' }));
  window.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
}, csv);
await wait(1200);
await cap('It works out what it got and imports it: accounts, lines, fringes.', 2600);
await click(page.getByText('2100 PRODUCTION STAFF'), 500);
await click(page.getByText('2102 1ST ASSISTANT DIRECTOR'), 1800);
await cap(null);

// 7. end card
await card('ProfitShare', 'github.com/gravy42/profitshare<br><span style="font-size:18px;opacity:.85">Budget, stripboard, SAG tier and profit-share waterfall in one file. Yours stays in your browser.</span>', 3600);

await page.close();
await ctx.close();
await browser.close();
const webm = readdirSync(outDir).find(f => f.endsWith('.webm'));
renameSync(outDir + webm, outDir + 'profitshare-demo.webm');
console.log('wrote demo/profitshare-demo.webm');
