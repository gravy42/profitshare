// Quick visual smoke test of the single-file build: loads the sample, walks the tabs, screenshots each one (light + dark).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
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
  await page.getByText('1400 CAST').click(); await page.getByText('1401 PRINCIPAL CAST').click(); await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}${scheme}-top.png` });
  for (const [name, label] of [['board', 'Stripboard'], ['points', 'Points & waterfall'], ['sag', 'SAG tier']]) {
    await page.getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(300);
    if (name === 'board') { await page.getByRole('button', { name: 'Auto day breaks' }).click(); await page.waitForTimeout(300); }
    if (name === 'sag') { await page.getByRole('button', { name: 'Convert above-scale ATL to points' }).click(); await page.waitForTimeout(300); }
    await page.screenshot({ path: `${out}${scheme}-${name}.png` });
  }
  console.log(scheme, 'KPI after preset:', (await page.locator('.kpi').innerText()).replace(/\n/g, ' | '));
  // drag-and-drop intake: drop a budget and a board together
  await page.getByRole('button', { name: 'New…' }).click();
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
