import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const file = 'file://' + fileURLToPath(new URL('../dist-single/index.html', import.meta.url));
const out = process.env.SMOKE_OUT || '/tmp/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());
await page.goto(file); await page.waitForTimeout(600);
await page.screenshot({ path: out + 'start.png' });
console.log('first tab:', await page.locator('nav.tabs button.on').innerText());
// from scratch
await page.getByPlaceholder('Working title').fill('Test Film');
await page.getByRole('button', { name: 'Start from scratch' }).click(); await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Top sheet & budget', exact: true }).click(); await page.waitForTimeout(200);
console.log('KPI blank:', (await page.locator('.kpi').innerText()).replace(/\n/g,' | '));
await page.getByText('2600 CAMERA').click();
await page.getByText('2601 DIRECTOR OF PHOTOGRAPHY').click().catch(async()=>{ const t = await page.locator('tr.acct').first().innerText(); console.log('first acct:', t); await page.locator('tr.acct td').first().click(); });
await page.getByRole('button', { name: '+ line' }).first().click(); await page.waitForTimeout(200);
const row = page.locator('tr.line').first();
await row.getByPlaceholder('description').fill('DP');
await row.locator('input[type=number]').nth(0).fill('20');
await row.locator('select').first().selectOption('DAY');
await row.locator('input[type=number]').nth(2).fill('494');
await page.waitForTimeout(300);
await row.locator('.pick button').first().click();
await row.locator('.pick label').nth(0).click(); await row.locator('.pick label').nth(1).click(); await row.getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(300);
console.log('KPI after line:', (await page.locator('.kpi').innerText()).replace(/\n/g,' | '));
await page.screenshot({ path: out + 'scratch.png' });
// edit accounts: add category
await page.getByRole('button', { name: 'Edit accounts' }).click();
await page.getByPlaceholder('e.g. 3800').first().fill('3800');
await page.getByPlaceholder('name').first().fill('DRONE UNIT');
await page.getByRole('button', { name: '+ category' }).first().click(); await page.waitForTimeout(200);
console.log('has 3800:', await page.getByText('3800').count());
await page.screenshot({ path: out + 'editing.png' });
// import generic csv via New
await page.getByRole('button', { name: 'New…' }).click();
await page.getByRole('button', { name: /Import \.xlsx/ }).click(); await page.waitForTimeout(200); // arms
console.log('armed label:', await page.getByRole('button', { name: /Import \.xlsx/ }).innerText());
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Import \.xlsx/ }).click()]);
await chooser.setFiles(fileURLToPath(new URL('./fixtures/mmb-export.csv', import.meta.url)));
await page.waitForTimeout(600);
console.log('notice:', await page.locator('.notice').first().innerText());
await page.getByRole('button', { name: 'Top sheet & budget', exact: true }).click(); await page.waitForTimeout(200);
console.log('KPI after import:', (await page.locator('.kpi').innerText()).replace(/\n/g,' | '));
await page.getByText('2100 PRODUCTION STAFF').click(); await page.getByText('2102 1ST ASSISTANT DIRECTOR').click(); await page.waitForTimeout(200);
await page.screenshot({ path: out + 'imported.png' });
// fringes panel
await page.locator('details.panel summary').click(); await page.waitForTimeout(200);
await page.screenshot({ path: out + 'fringes.png', fullPage: true });
// sample still loads
await page.getByRole('button', { name: 'New…' }).click();
await page.getByRole('button', { name: /Load the sample/ }).click(); await page.getByRole('button', { name: /Load the sample/ }).click(); await page.waitForTimeout(600);
console.log('KPI sample:', (await page.locator('.kpi').innerText()).replace(/\n/g,' | '));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
