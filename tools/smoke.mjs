// Quick visual smoke test of the single-file build: loads the sample, walks the tabs, screenshots each one (light + dark).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const file = 'file://' + fileURLToPath(new URL('../dist-single/index.html', import.meta.url));
const out = process.env.SMOKE_OUT || '/tmp/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(file); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Load the sample' }).click(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Top sheet & budget', exact: true }).click(); await page.waitForTimeout(200);
  await page.getByText('1400 CAST').click(); await page.getByText('1401 PRINCIPAL CAST').click(); await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}${scheme}-top.png` });
  for (const [name, label] of [['deal', 'Deal'], ['board', 'Stripboard'], ['points', 'Points & waterfall'], ['sag', 'SAG tier']]) {
    await page.getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(300);
    if (name === 'board') { await page.getByRole('button', { name: 'Auto day breaks' }).click(); await page.waitForTimeout(300); }
    if (name === 'deal') {
      // premiums to points via the Deal tab selects (producer fees, script, allowances)
      for (const sel of await page.locator('table select').all()) await sel.selectOption('points');
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: `${out}${scheme}-${name}.png`, fullPage: name === 'deal' });
  }
  console.log(scheme, 'KPI after preset:', (await page.locator('.kpi').innerText()).replace(/\n/g, ' | '));
  // the pitch deck: the sample's own fourteen slides in the preview, paged, and the web deck anyone can be sent, downloaded
  await page.getByRole('button', { name: 'Pitch', exact: true }).click(); await page.waitForTimeout(400);
  await page.locator('#pitch-deck').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide').length === 14, null, { timeout: 15000 });
  const count = page.locator('#pitch-deck .pd-count');
  await page.locator('#pitch-deck .pd-preview').scrollIntoViewIfNeeded();
  const at = async () => (await count.innerText()).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) { await page.getByRole('button', { name: 'Next slide' }).click(); await page.waitForTimeout(700); }
  if (!/5 \/ 14$/.test(await at())) throw new Error(`${scheme}: the preview did not page to slide 5 of 14 (it says "${await at()}")`);
  await page.screenshot({ path: `${out}${scheme}-pitch-deck.png` });
  await page.getByRole('button', { name: 'Previous slide' }).click(); await page.waitForTimeout(500);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('#pitch-send button', { hasText: 'Download web deck' }).first().click()]);
  const saved = await download.path();
  const html = saved ? readFileSync(saved, 'utf8') : '';
  if (!/^<!doctype html>/.test(html) || !html.includes('id="deck-data"')) throw new Error(`${scheme}: the web deck was not downloaded as a page`);
  if (/https?:/i.test(html)) throw new Error(`${scheme}: the web deck names an address: ${html.match(/.{0,40}https?:.{0,40}/i)[0]}`);
  console.log(scheme, 'pitch deck:', await at(), '| web deck', download.suggestedFilename(), `${(html.length / 1000).toFixed(0)} kB, no address in it`);
  // drag-and-drop intake: drop a budget and a board together
  await page.getByRole('button', { name: 'New project' }).click();   // the header's button (it was "New…" once)
  await page.evaluate(() => { /* nothing */ });
  const dt = await page.evaluateHandle(async () => new DataTransfer());
  await page.evaluate(() => { const ev = new DragEvent('dragenter', { bubbles: true, dataTransfer: new DataTransfer() }); ev.dataTransfer.items.add(new File(['x'], 'x.csv')); window.dispatchEvent(ev); });
  await page.waitForTimeout(150);
  console.log(scheme, 'overlay shown:', await page.locator('.dropzone').count());
  await page.evaluate(() => { const ev = new DragEvent('dragleave', { bubbles: true, dataTransfer: new DataTransfer() }); ev.dataTransfer.items.add(new File(['x'], 'x.csv')); window.dispatchEvent(ev); });
  await dt.dispose();
  console.log(scheme, 'errors:', errors.length ? errors : 'none');
  await page.close();
}
await browser.close();
