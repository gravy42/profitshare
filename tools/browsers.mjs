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
if (!engine) {
  console.error(`BROWSER must be one of ${Object.keys(engines).join(', ')}`);
  process.exit(2);
}
const out = `browsers-out/${name}`;
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT) || 4300 + Object.keys(engines).indexOf(name); // PORT: another port, when something else on this machine has the usual one
const origin = `http://127.0.0.1:${port}`;

const rows = [];
const note = (step, ok, detail = '') => {
  rows.push({ step, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? `: ${detail}` : ''}`);
};
const step = async (label, fn) => {
  try {
    const detail = await fn();
    note(label, true, detail ?? '');
    return true;
  } catch (e) {
    note(
      label,
      false,
      String(e?.message ?? e)
        .split('\n')[0]
        .slice(0, 300),
    );
    return false;
  }
};
const need = (cond, message) => {
  if (!cond) throw new Error(message);
};

// The built page carries a Content-Security-Policy (tools/csp.mjs). Whatever it stops is heard two ways: the page's own
// `securitypolicyviolation` event (heard from the first script on, in every document of the context), and the
// browser's console, which is also where a worker's refusals are said. Returns the list, filled as the page runs.
const POLICY_WORDS = /content[ -]security[ -]policy/i;
async function watchPolicy(context, page) {
  const refused = [];
  await context.exposeBinding('__policyRefused', (_source, what) => {
    refused.push(String(what));
  });
  await context.addInitScript(() => {
    addEventListener('securitypolicyviolation', e => {
      const from = e.sourceFile
        ? ` (from ${e.sourceFile.split('/').pop()}${e.lineNumber ? `:${e.lineNumber}` : ''})`
        : '';
      window.__policyRefused?.(
        `${e.effectiveDirective || e.violatedDirective} refused ${e.blockedURI || 'inline'}${from}`,
      );
    });
  });
  page.on('console', m => {
    if (POLICY_WORDS.test(m.text())) refused.push(`console: ${m.text().slice(0, 240)}`);
  });
  return refused;
}

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore',
});
const up = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('the preview server did not start');
};

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
  page.on('console', m => {
    if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  const outside = [];
  page.on('request', r => {
    if (!r.url().startsWith(origin) && !/^(data|blob|about):/.test(r.url())) outside.push(r.url());
  });
  const refused = await watchPolicy(context, page); // everything the page's Content-Security-Policy stopped
  const shot = (file, target = page) => target.screenshot({ path: `${out}/${file}.png` }).catch(() => undefined);
  const deckSlides = () =>
    page.evaluate(
      () =>
        document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide').length ?? 0,
    );
  const download = async (click, file) => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), click()]);
    const path = `${out}/${file}`;
    await d.saveAs(path);
    saved[file] = path;
    return { path, name: d.suggestedFilename() };
  };

  await step('the app opens', async () => {
    await page.goto(origin);
    await page.getByRole('button', { name: 'Load the sample' }).waitFor({ timeout: 20000 });
  });
  await step('the page carries its policy', async () => {
    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content', { timeout: 5000 });
    const scripts = /(?:^|;)\s*script-src ([^;]*)/.exec(policy)?.[1] ?? '';
    need(/^default-src 'none'/.test(policy), `the policy does not start from nothing: ${policy.slice(0, 80)}`);
    need(
      scripts && !scripts.split(/\s+/).some(src => src === "'unsafe-inline'" || src === "'unsafe-eval'"),
      `script-src is "${scripts}"`,
    );
    need(
      (await page.locator('head script:not([src])').count()) > 0 && refused.length === 0,
      `the page's own inline script was refused: ${refused[0]}`,
    );
    return policy;
  });
  await step('the sample loads', async () => {
    await page.getByRole('button', { name: 'Load the sample' }).click();
    await page.waitForTimeout(600);
    await shot('01-sample');
  });
  const TABS = [
    'Top sheet & budget',
    'Deal',
    'Stripboard',
    'Calendar',
    'Call sheets',
    'Breakdowns',
    'Points & waterfall',
    'SAG tier',
    'Incentives',
    'About',
    'Start',
    'Pitch',
  ];
  for (const label of TABS) {
    await step(`tab: ${label}`, async () => {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(500);
      await shot(`02-tab-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    });
  }
  // The budget, taken out of the app for people who do not use it: each file must download under the page's policy,
  // be the kind of file its name says, and carry the sample's budget to raise.
  await step('export: the budget as Excel, CSV and PDF', async () => {
    await page.getByRole('button', { name: 'Top sheet & budget', exact: true }).click();
    await page.waitForTimeout(400);
    const group = page.getByRole('group', { name: 'Export the budget' });
    const said = [];
    for (const [label, ext, starts] of [
      ['Excel', 'xlsx', 'PK'],
      ['CSV', 'csv', ''],
      ['PDF', 'pdf', '%PDF'],
    ]) {
      const d = await download(
        () => group.getByRole('button', { name: new RegExp(`as an? ${label}`) }).click(),
        `budget.${ext}`,
      );
      const bytes = readFileSync(d.path);
      need(d.name === `SALT_FLAT_Draft_3_budget.${ext}`, `the ${label} file is called ${d.name}`);
      need(bytes.length > 0, `the ${label} file is empty`);
      need(
        bytes.subarray(0, starts.length).toString('latin1') === starts,
        `the ${label} file does not start with ${starts}`,
      );
      if (ext === 'csv')
        need(bytes.toString('utf8').includes('805312.06'), 'the CSV does not carry the budget to raise, 805312.06');
      if (ext === 'pdf')
        need(
          (await (await PDFDocument.load(bytes)).getPageCount()) > 1,
          'the PDF has one page: the full budget is missing',
        );
      await page.getByText(`Downloaded ${d.name}.`).waitFor({ timeout: 5000 });
      said.push(`${d.name} ${(bytes.length / 1000).toFixed(0)} kB`);
    }
    await shot('02b-budget-export');
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();
    await page.waitForTimeout(500);
    return said.join(', ');
  });
  await step('the pitch deck preview draws 14 slides', async () => {
    await page.locator('#pitch-deck').scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        document.querySelector('#pitch-deck .pd-host')?.shadowRoot?.querySelectorAll('section.psd-slide').length === 14,
      null,
      { timeout: 20000 },
    );
    await page.locator('#pitch-deck .pd-preview').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await shot('03-pitch-deck');
  });
  await step('no slide overflows in the preview', async () => {
    const over = await page.evaluate(() =>
      [
        ...(document
          .querySelector('#pitch-deck .pd-host')
          ?.shadowRoot?.querySelectorAll('section.psd-slide[data-overflow="true"]') ?? []),
      ].map(s => s.id || s.getAttribute('aria-label')),
    );
    need(over.length === 0, `overflowing: ${over.join(', ')}`);
  });
  await step('the preview pages with its buttons', async () => {
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Next slide' }).click();
      await page.waitForTimeout(700);
    }
    const at = (await page.locator('#pitch-deck .pd-count').innerText()).replace(/\s+/g, ' ').trim();
    need(/5 \/ 14$/.test(at), `the counter says "${at}"`);
    await shot('04-pitch-slide-5');
  });
  await step('a slide opens in the editor', async () => {
    await page.locator('#pitch-deck .pd-row .pd-pick').nth(1).click();
    await page.locator('#pitch-deck .pd-editor').waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    await shot('04-slide-editor');
  });
  await step('Play replays a slide', async () => {
    await page.getByRole('button', { name: /^Play/ }).first().click();
    await page.waitForTimeout(1500);
    await shot('05-play');
  });
  await step('the design builder proposes looks from pictures', async () => {
    const open = page.getByRole('button', { name: 'Build one from my pictures' });
    await open.scrollIntoViewIfNeeded();
    await open.click();
    await page.waitForTimeout(800);
    await shot('06-design-builder');
  });
  // The font picker, as far as its question: CI must not depend on Google, so the answer given here is "Not now".
  await step('the font picker asks before it asks Google for anything', async () => {
    const open = page.getByRole('button', { name: 'Pick the title font from Google Fonts' });
    await open.scrollIntoViewIfNeeded();
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Pick a title font from Google Fonts' });
    await dialog
      .getByText('Browsing fonts loads previews from Google Fonts (fonts.googleapis.com and fonts.gstatic.com).', {
        exact: false,
      })
      .waitFor({ timeout: 15000 });
    await dialog.getByText('Nothing about your project is sent.', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Show the fonts' }).waitFor();
    await page.waitForTimeout(400);
    await shot('07-font-picker');
    need(outside.length === 0, `asked for ${outside[0]} before any answer`);
    await dialog.getByRole('button', { name: 'Not now' }).click();
    await dialog.locator('[role="listbox"] [role="option"]').first().waitFor({ timeout: 15000 });
    const rows = await dialog.locator('[role="listbox"] [role="option"]').count();
    const count = (await dialog.locator('.gf-count').innerText()).trim();
    need(/^[\d,]+ fonts$/.test(count) && rows > 3, `the list says "${count}" and shows ${rows} rows`);
    await page.waitForTimeout(600);
    await shot('07-font-picker-names');
    need(outside.length === 0, `asked for ${outside[0]} after "Not now"`);
    need(
      (await page.locator('link[href*="google"], link[href*="gstatic"]').count()) === 0,
      'a link to Google is in the page',
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 5000 });
    return `${count}, listed by name; nothing asked of Google`;
  });
  await step('download: web deck', async () => {
    await page.locator('#pitch-send').scrollIntoViewIfNeeded();
    const d = await download(
      () => page.locator('#pitch-send button', { hasText: 'Download web deck' }).first().click(),
      'deck.html',
    );
    const html = readFileSync(d.path, 'utf8');
    need(/^<!doctype html>/i.test(html) && html.includes('id="deck-data"'), 'the file is not the deck page');
    need(!/https?:/i.test(html), 'the file names an address');
    return `${d.name}, ${(html.length / 1000).toFixed(0)} kB`;
  });
  const pdfPages = async file => (await PDFDocument.load(readFileSync(file))).getPageCount();
  await step('download: deck PDF', async () => {
    const d = await download(() => page.locator('#pitch-send button', { hasText: /^PDF/ }).first().click(), 'deck.pdf');
    const n = await pdfPages(d.path);
    const kb = readFileSync(d.path).length / 1000;
    need(n === 14, `the PDF has ${n} pages, not 14`);
    need(kb > 300, `the PDF is only ${kb.toFixed(0)} kB, so its pages are probably blank`);
    return `${d.name}, ${n} pages, ${kb.toFixed(0)} kB`;
  });
  await step('download: everything as a zip', async () => {
    await page.locator('#pitch-send').scrollIntoViewIfNeeded();
    const d = await download(async () => {
      await page.locator('#pitch-send button', { hasText: 'Download everything' }).click();
      const go = page.locator('#pitch-send button', { hasText: /^(Download anyway|Go ahead|Yes)/ });
      await page.waitForTimeout(500);
      if (await go.count()) await go.first().click();
    }, 'all.zip');
    const bytes = readFileSync(d.path);
    need(bytes[0] === 0x50 && bytes[1] === 0x4b, 'not a zip');
    return `${(bytes.length / 1e6).toFixed(1)} MB`;
  });
  // Files brought in from outside, each read by its own importer (a PDF by pdf.js, in a worker made from a blob:).
  const bring = async (button, file, said) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.getByRole('button', { name: button, exact: true }).click(),
    ]);
    await chooser.setFiles(`tools/fixtures/${file}`);
    const status = page.locator('main [role="status"]').first();
    await page
      .waitForFunction(
        re => new RegExp(re, 'i').test(document.querySelector('main [role="status"]')?.textContent ?? ''),
        said,
        { timeout: 30000 },
      )
      .catch(() => undefined);
    const text = (await status.innerText()).replace(/\s+/g, ' ').trim();
    need(new RegExp(said, 'i').test(text), `after ${file} the page says "${text.slice(0, 160)}"`);
    const dismiss = page.getByRole('button', { name: 'Dismiss this message' });
    if (await dismiss.count()) await dismiss.first().click();
    return text.slice(0, 120);
  };
  await step('look book: the pages of a PDF, drawn as pictures', async () => {
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();
    const book = page.locator('#pitch-lookbook');
    await book.scrollIntoViewIfNeeded();
    const had = await book.locator('figure').count();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      book.getByRole('button', { name: 'Add the pages of a PDF' }).click(),
    ]);
    await chooser.setFiles('tools/fixtures/SaltFlat_Script.pdf');
    await page.waitForFunction(n => document.querySelectorAll('#pitch-lookbook figure img').length > n, had, {
      timeout: 60000,
    });
    return `${(await book.locator('figure').count()) - had} pages added`;
  });
  // A PDF whose picture is a JPEG 2000: pdf.js decodes those in WebAssembly, which the policy has to allow by name.
  await step('look book: a PDF with a JPEG 2000 picture in it', async () => {
    const book = page.locator('#pitch-lookbook');
    await book.scrollIntoViewIfNeeded();
    const had = await book.locator('figure').count(),
      said = refused.length;
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      book.getByRole('button', { name: 'Add the pages of a PDF' }).click(),
    ]);
    await chooser.setFiles('tools/fixtures/jpx-picture.pdf');
    await page.waitForFunction(n => document.querySelectorAll('#pitch-lookbook figure img').length > n, had, {
      timeout: 60000,
    });
    need(refused.length === said, `the picture was not decoded: ${refused[said]}`);
    // the page is the picture, edge to edge: a page left white means the decoder did not run
    const dark = await page.evaluate(async () => {
      const img = [...document.querySelectorAll('#pitch-lookbook figure img')].pop();
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 720) n++;
      return n;
    });
    need(dark > 32, `only ${dark} of 64 sampled points of the page are not white`);
  });
  const BUDGET = 'Import budget (.xlsx / .csv)',
    BOARD = 'Import board or script (.sex / .fdx / .pdf)';
  await step('import: a budget (.xlsx)', () => bring(BUDGET, 'Budget_SaltFlat_Draft3.xlsx', 'Budget_SaltFlat_Draft3'));
  await step('import: a budget (.csv)', () => bring(BUDGET, 'mmb-export.csv', 'mmb-export'));
  await step('import: a board (.sex)', () => bring(BOARD, 'SaltFlat_Board.sex', 'SaltFlat_Board'));
  await step('import: a script (.fdx)', () => bring(BOARD, 'sample.fdx', 'sample\\.fdx'));
  await step('import: that script merged into the board', async () => {
    await page.getByRole('button', { name: 'Merge into the board' }).click();
    await page.waitForFunction(
      () => /merged into the board/i.test(document.querySelector('main [role="status"]')?.textContent ?? ''),
      null,
      { timeout: 15000 },
    );
    const dismiss = page.getByRole('button', { name: 'Dismiss this message' });
    if (await dismiss.count()) await dismiss.first().click();
  });
  await step('import: a script (.fountain)', () => bring(BOARD, 'SaltFlat_Script.fountain', 'SaltFlat_Script'));
  await step('import: a script (.pdf)', () => bring(BOARD, 'SaltFlat_Script.pdf', 'SaltFlat_Script'));
  // ---- the start screen's ways in, and the budget built by hand --------------------------------------------------
  // (From scratch, the drop target and the Deal tab's pay choices were once walked by tools/smoke.mjs and
  // smoke-start.mjs; they are here now so that one walk, the one CI runs in three engines, covers them.)
  const says = async (re, what) => {
    const read = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('main [role="status"]')]
          .map(e => e.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    await page
      .waitForFunction(
        src =>
          new RegExp(src, 'i').test(
            [...document.querySelectorAll('main [role="status"]')].map(e => e.textContent ?? '').join(' '),
          ),
        re,
        { timeout: 30000 },
      )
      .catch(() => undefined);
    const text = await read();
    need(new RegExp(re, 'i').test(text), `${what}: the page says "${text.slice(0, 200)}"`);
    return text.slice(0, 110);
  };
  const startScreen = async () => {
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByRole('button', { name: 'Start from scratch' }).waitFor({ timeout: 10000 });
  };
  // files handed to the page the way a drag from the desktop hands them: a DataTransfer with the files on it
  const dragged = async (type, files) => {
    const sent = files.map(f => ({ name: f.split('/').pop(), b64: readFileSync(f).toString('base64') }));
    await page.evaluate(
      ({ type, sent }) => {
        const dt = new DataTransfer();
        for (const f of sent) dt.items.add(new File([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], f.name));
        window.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      },
      { type, sent },
    );
  };
  const choose = async (button, files) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), button.click()]);
    await chooser.setFiles(files);
  };
  const raise = async () => (await page.locator('header .kpi span').first().innerText()).replace(/\s+/g, ' ').trim();
  await step('budget: a deal-set line shows its pay as fixed and leads to the Deal tab', async () => {
    await page.locator('header').getByRole('button', { name: 'Open', exact: true }).waitFor({ timeout: 5000 });
    await startScreen();
    await page.getByRole('button', { name: 'Load the sample' }).click();
    await page.getByRole('button', { name: 'Top sheet & budget', exact: true }).click();
    await page.getByPlaceholder('filter lines…').fill('fee');
    const row = page.locator('tr.line', { has: page.locator('.dealpay') }).first();
    await row.waitFor({ timeout: 10000 });
    need((await row.locator('select.tag').count()) === 0, 'the line still has a pay menu');
    const before = await raise();
    await shot('08a-deal-set-pay');
    await row.getByRole('button', { name: 'Set on the Deal tab' }).click();
    const group = await page.waitForFunction(
      () => /^deal-pay-/.test(document.activeElement?.id ?? '') && document.activeElement.id,
      null,
      { timeout: 5000 },
    );
    // the Deal tab's choice is the one that counts: producer fees to points takes them off the budget to raise
    await page.locator('#deal-pay-producers').selectOption('points');
    await page.waitForTimeout(300);
    const after = await raise();
    need(after !== before, `the budget to raise did not move (${before})`);
    await page.locator('#deal-pay-producers').selectOption('cash');
    await page.waitForTimeout(300);
    need((await raise()) === before, `back up front, the budget to raise is ${await raise()}, not ${before}`);
    return `focus on #${await group.jsonValue()}; ${before} -> ${after} -> back`;
  });
  await step('start: from scratch, then a line typed on the budget', async () => {
    await startScreen();
    await page.getByPlaceholder('Working title').fill('Walk Film');
    await page.getByRole('button', { name: 'Start from scratch' }).click();
    await page.getByRole('button', { name: 'Top sheet & budget', exact: true }).click();
    const before = await raise();
    await page.getByRole('button', { name: /^2600 / }).click();
    await page.getByRole('button', { name: /^2601 / }).click();
    await page.getByRole('button', { name: '+ line' }).first().click();
    const row = page.locator('tr.line').first();
    await row.getByPlaceholder('description').fill('Director of photography');
    await row.locator('input[type=number]').nth(0).fill('20');
    await row.locator('input[type=number]').nth(2).fill('500');
    await page.waitForTimeout(300);
    const after = await raise();
    need(/\$0\b/.test(before) && !/\$0\b/.test(after), `the budget to raise went from "${before}" to "${after}"`);
    await shot('08b-from-scratch');
    return after;
  });
  await step('start: a file dragged over the page shows where to drop it', async () => {
    await dragged('dragenter', ['tools/fixtures/mmb-export.csv']);
    await page.locator('.dropzone').waitFor({ timeout: 5000 });
    await shot('08c-drop-target');
    await dragged('dragleave', ['tools/fixtures/mmb-export.csv']);
    await page.locator('.dropzone').waitFor({ state: 'detached', timeout: 5000 });
  });
  await step('start: a budget and a board dropped together', async () => {
    await dragged('drop', ['tools/fixtures/SaltFlat_Board.sex', 'tools/fixtures/Budget_SaltFlat_Draft3.xlsx']);
    return says('budget lines from Budget_SaltFlat_Draft3.*scenes from SaltFlat_Board', 'after the drop');
  });
  await step('start: a script dropped on the start screen becomes a first budget', async () => {
    await startScreen();
    await dragged('drop', ['tools/fixtures/SaltFlat_Script.fountain']);
    return says('broken down and scheduled', 'after the drop');
  });
  await step('start: a script picked on the start screen', async () => {
    await startScreen();
    await choose(page.getByRole('button', { name: /^Pick a script/ }), 'tools/fixtures/sample.fdx');
    return says('broken down and scheduled', 'after the pick');
  });
  await step('start: a budget picked on the start screen', async () => {
    await startScreen();
    await choose(
      page.getByRole('button', { name: 'Import .xlsx / .csv', exact: true }),
      'tools/fixtures/mmb-export.csv',
    );
    return says('budget lines from mmb-export', 'after the pick');
  });
  await step('start: a saved project (.json) opens, and several at once', async () => {
    await startScreen();
    await page.getByRole('button', { name: 'Load the sample' }).click();
    await page.waitForTimeout(400);
    const one = await download(() => page.getByRole('button', { name: 'Save', exact: true }).click(), 'project.json');
    need(JSON.parse(readFileSync(one.path, 'utf8')).name, 'the saved file has no project name in it');
    await startScreen();
    await choose(page.getByRole('button', { name: 'Open .json', exact: true }), one.path);
    const first = await says('Opened project\\.json as its own project', 'after one file');
    writeFileSync(`${out}/project-2.json`, readFileSync(one.path));
    await choose(page.locator('header').getByRole('button', { name: 'Open', exact: true }), [
      one.path,
      `${out}/project-2.json`,
    ]);
    await says(
      'Opened project\\.json as its own project.*Opened project-2\\.json as its own project',
      'after two files',
    );
    return first;
  });
  await step('start: the .zip of every project opens', async () => {
    await page.getByRole('button', { name: /^Projects/ }).click();
    const zip = await download(
      () => page.getByRole('button', { name: 'Download all my projects' }).click(),
      'projects.zip',
    );
    const bytes = readFileSync(zip.path);
    need(bytes[0] === 0x50 && bytes[1] === 0x4b, `${zip.name} is not a zip`);
    await choose(page.locator('header').getByRole('button', { name: 'Open', exact: true }), zip.path);
    return says('projects opened from projects\\.zip', 'after the zip');
  });
  // ---- switching project leaves nothing of the last one behind, and the tour reuses the sample ------------------
  const openRow = async name => {
    const title = page.getByLabel('Project title');
    if ((await title.count()) && (await title.inputValue()) === name) return; // already the one open
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.evaluate(() => {
      const d = document.querySelector('details.projects');
      if (d) d.open = true;
    });
    await page
      .locator('table.projlist tr', { hasText: name })
      .first()
      .getByRole('button', { name: 'Open', exact: true })
      .click();
    await page.waitForTimeout(300);
  };
  const openTitle = () => page.getByLabel('Project title').inputValue();
  await step('a script waiting on merge or replace goes when another project opens', async () => {
    await startScreen();
    await page.getByPlaceholder('Working title').fill('Walk Film Two');
    await page.getByRole('button', { name: 'Start from scratch' }).click();
    await startScreen();
    await page.getByRole('button', { name: 'Load the sample' }).click();
    await dragged('drop', ['tools/fixtures/sample.fdx']);
    const merge = page.getByRole('button', { name: 'Merge into the board' });
    await merge.waitFor({ timeout: 15000 });
    await openRow('Walk Film Two');
    need((await openTitle()) === 'Walk Film Two', `the open project is "${await openTitle()}"`);
    need((await merge.count()) === 0, 'the merge or replace question is still showing on Walk Film Two');
    await startScreen();
    need((await merge.count()) === 0, 'the merge or replace question is still showing on the start screen');
  });
  await step('tour: step 1 opens the sample already here, and adds no copy', async () => {
    const samples = () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('profitshare.projects') ?? '[]').filter(
            m =>
              String(m?.name ?? '')
                .trim()
                .toUpperCase() === 'SALT FLAT',
          ).length,
      );
    await openRow('Walk Film Two');
    const before = await samples();
    need(before > 0, 'there is no sample in this browser to open');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByRole('button', { name: 'Take the tour' }).click();
    const go = page.getByRole('button', { name: 'Open Salt Flat, the invented film' });
    await go.click();
    await page.waitForTimeout(300);
    need((await openTitle()) === 'SALT FLAT', `step 1 opened "${await openTitle()}"`);
    await openRow('Walk Film Two');
    await go.click();
    await page.waitForTimeout(300);
    need((await openTitle()) === 'SALT FLAT', `step 1, pressed again, opened "${await openTitle()}"`);
    const after = await samples();
    need(after === before, `${before} SALT FLAT projects before, ${after} after pressing step 1 twice`);
    await page.getByRole('button', { name: 'Close the tour' }).click();
    return `${after} SALT FLAT, before and after`;
  });
  // ---- the keyboard alone: the two things that needed a mouse -------------------------------------------------------
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return {
        tag: el?.tagName ?? '',
        grip: el?.dataset?.grip ?? '',
        date: el?.dataset?.date ?? '',
        label: el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? '',
        expanded: el?.getAttribute('aria-expanded') ?? '',
      };
    });
  const press = async key => {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    return focused();
  };
  await step('keyboard: a calendar day opens, takes a shoot day and closes, from the keys alone', async () => {
    await startScreen();
    await page.getByRole('button', { name: 'Load the sample' }).click();
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const y = String(new Date().getFullYear());
    const from = page.locator('.ctl').nth(0).locator('select');
    const to = page.locator('.ctl').nth(1).locator('select');
    await from.nth(0).selectOption('03');
    await from.nth(1).selectOption(y);
    await to.nth(0).selectOption('04');
    await to.nth(1).selectOption(y);
    await page.getByRole('button', { name: /^(Show|Update) calendar$/ }).click();
    await page.locator('.cal button.daynum').first().waitFor({ timeout: 5000 });
    const stops = await page.locator('.cal button.daynum[tabindex="0"]').count();
    need(stops === 1, `${stops} days are Tab stops; the calendar should be one`);
    // Tab from the fold above the calendar lands on its one day
    await page.locator('summary', { hasText: 'auto-place the shoot days' }).focus();
    let f = await press('Tab');
    need(f.date === `${y}-03-01`, `Tab into the calendar landed on "${f.date || f.label}"`);
    const walk = [
      ['ArrowRight', '03-02'],
      ['ArrowDown', '03-09'],
      ['ArrowUp', '03-02'],
      ['End', '03-07'],
      ['Home', '03-01'],
      ['PageDown', '04-01'],
      ['PageUp', '03-01'],
      ['ArrowRight', '03-02'],
    ];
    for (const [key, want] of walk) {
      f = await press(key);
      need(f.date === `${y}-${want}`, `${key} went to ${f.date}, not ${y}-${want}`);
    }
    f = await press('Enter');
    need(f.tag === 'SELECT', `Enter on the day put focus on ${f.tag} "${f.label}", not the day's first menu`);
    need(
      (await page.locator(`.cal button.daynum[data-date="${y}-03-02"]`).getAttribute('aria-expanded')) === 'true',
      'the day does not say it is open',
    );
    f = await press('Tab');
    need(f.tag === 'SELECT', `Tab from the kind menu went to ${f.tag} "${f.label}"`);
    const which = page.locator('.cal .adder select').nth(1);
    await which.selectOption('1');
    await which.focus(); // Safari's engine on a Mac lets go of a menu chosen from a script; a person's keys stay on it
    f = await press('Tab');
    need(f.label === 'Add', `Tab from the day menu went to "${f.label}"`);
    f = await press('Enter');
    need(f.date === `${y}-03-02`, `after Add, focus went to "${f.date || f.label}", not back to the day`);
    need(/Shoot Day 1/.test(f.label), `the day's name does not say Shoot Day 1: "${f.label}"`);
    need(f.expanded === 'false', 'the day still says it is open');
    f = await press('Enter');
    need(f.tag === 'SELECT', 'Enter did not open the day a second time');
    f = await press('Escape');
    need(f.date === `${y}-03-02` && f.expanded === 'false', `Escape left focus on "${f.date || f.label}"`);
    need((await page.locator('.cal .adder').count()) === 0, 'Escape did not close the day');
    await shot('09a-calendar-keyboard');
    return `one Tab stop; arrows, Home, End, Page Up and Down; Shoot Day 1 placed on ${y}-03-02 and Escape closes`;
  });
  // the stripboard as the walk reads it: each scene strip as "day:scene", in board order
  const order = () =>
    page.evaluate(() => {
      let day = 1;
      const out = [];
      for (const el of document.querySelectorAll('.strips [data-grip^="s"], .strips [data-grip^="d"]')) {
        if (el.dataset.grip.startsWith('d')) day++;
        else out.push(`${day}:${el.closest('[draggable]').querySelector('.num').firstChild.textContent.trim()}`);
      }
      return out;
    });
  const sceneOf = x => x.split(':')[1];
  const onDay = (o, d) =>
    o
      .filter(x => x.startsWith(`${d}:`))
      .map(sceneOf)
      .join(',');
  await step('keyboard: strips, picked strips and whole days move with the arrow keys', async () => {
    await page.getByRole('button', { name: 'Stripboard', exact: true }).click();
    await page.waitForTimeout(400);
    const start = await order();
    need(start.length > 3, `the board has ${start.length} strips`);
    const same = async () => (await order()).join(' ') === start.join(' ');
    // one strip down a place and back
    await page.locator('[data-grip="s0"]').focus();
    let f = await press('ArrowDown');
    let now = await order();
    need(f.grip === 's1', `after ↓ focus is on "${f.grip}", not the strip that moved`);
    need(sceneOf(now[1]) === sceneOf(start[0]), `scene ${sceneOf(start[0])} did not move down: ${now.slice(0, 3)}`);
    f = await press('ArrowUp');
    need(f.grip === 's0' && (await same()), 'after ↑ the board is not back as it was');
    // Enter on a grip says how it works
    await press('Enter');
    await page.getByText('The up and down arrow keys move scene').first().waitFor({ timeout: 3000 });
    // two strips picked with Space move as one block
    for (const k of [0, 1]) {
      await page.locator('.strips input.pick').nth(k).focus();
      await press('Space');
    }
    await page.getByText('2 picked').waitFor({ timeout: 3000 });
    await page.locator('[data-grip="s1"]').focus();
    f = await press('ArrowDown');
    now = await order();
    need(
      [now[0], now[1], now[2]].map(sceneOf).join(',') === [start[2], start[0], start[1]].map(sceneOf).join(','),
      `the picked block did not move down together: ${now.slice(0, 3)}`,
    );
    need(f.grip === 's2', `after ↓ focus is on "${f.grip}"`);
    need((await page.getByText('2 picked').count()) === 1, 'the two strips are no longer picked after the move');
    f = await press('ArrowUp');
    need(await same(), 'the picked block did not come back up');
    await page.getByRole('button', { name: 'clear', exact: true }).focus();
    await press('Enter');
    // a whole day, from its day bar
    await page.locator('[data-grip="d1"]').focus();
    f = await press('ArrowDown');
    now = await order();
    need(onDay(now, 2) === onDay(start, 1), `Day 1 (${onDay(start, 1)}) is not Day 2 now (${onDay(now, 2)})`);
    need(f.grip === 'd2', `after ↓ focus is on "${f.grip}", not Day 2's bar`);
    f = await press('ArrowUp');
    need(f.grip === 'd1' && (await same()), 'Day 1 did not come back');
    // a whole day, from the Days table
    await page.locator('[data-grip="r2"]').focus();
    f = await press('ArrowUp');
    now = await order();
    need(onDay(now, 1) === onDay(start, 2), `Day 2 (${onDay(start, 2)}) is not Day 1 now (${onDay(now, 1)})`);
    need(f.grip === 'r1', `after ↑ focus is on "${f.grip}", not the Days table's first row`);
    f = await press('ArrowDown');
    need(f.grip === 'r2' && (await same()), 'Day 2 did not go back');
    await shot('09b-stripboard-keyboard');
    return `${start.length} strips; one strip, two picked, a day from its bar and from the Days table, each there and back`;
  });
  await step('keyboard: the popped-out day out of days renumbers with the arrow keys', async () => {
    await page.getByRole('button', { name: '⤢ pop out' }).focus();
    await press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Day out of days' });
    await dlg.waitFor({ timeout: 5000 });
    const first = (await dlg.locator('[data-grip="c0"]').getAttribute('aria-label')) ?? '';
    const who = /^Move (.+), number 1 /.exec(first)?.[1];
    need(who, `the first row's grip is called "${first}"`);
    await dlg.locator('[data-grip="c0"]').focus();
    let f = await press('ArrowDown');
    need(f.grip === 'c1' && f.label.startsWith(`Move ${who}, number 2 `), `after ↓ focus is on "${f.label}"`);
    f = await press('ArrowUp');
    need(f.grip === 'c0' && f.label.startsWith(`Move ${who}, number 1 `), `after ↑ focus is on "${f.label}"`);
    f = await press('Escape');
    need((await dlg.count()) === 0, 'Escape did not close the day out of days');
    need(f.label === '⤢ pop out', `focus went back to "${f.label}", not the pop out button`);
    return `${who} to number 2 and back`;
  });
  await step('the policy refused nothing the app does', async () => {
    need(refused.length === 0, `${refused.length} refused: ${[...new Set(refused)].slice(0, 4).join(' | ')}`);
  });
  await step('the app logged no errors', async () => {
    need(errors.length === 0, errors.slice(0, 4).join(' | '));
  });
  await step('the app asked for nothing outside itself', async () => {
    need(outside.length === 0, outside.slice(0, 3).join(' | '));
  });
  await context.close();

  // ---- names: every field and button on every tab has one a screen reader can say --------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const named = await ctx.newPage();
    await named.goto(origin);
    await named.getByRole('button', { name: 'Load the sample' }).click();
    await named.waitForTimeout(600);
    await step('every field and button has a name', async () => {
      const bare = [];
      let seen = 0;
      for (const label of TABS) {
        await named.getByRole('button', { name: label, exact: true }).click();
        await named.waitForTimeout(500);
        const r = await named.evaluate(() => {
          const shown = el => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0;
          };
          const has = el =>
            !!(
              el.getAttribute('aria-label')?.trim() ||
              el.getAttribute('aria-labelledby') ||
              el.title?.trim() ||
              el.closest('label') ||
              (el.id && [...document.querySelectorAll('label[for]')].some(l => l.getAttribute('for') === el.id))
            );
          const fields = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter(shown);
          const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(shown);
          const none = [...fields.filter(f => !has(f)), ...buttons.filter(b => !has(b) && !b.textContent.trim())];
          return {
            count: fields.length + buttons.length,
            none: none.slice(0, 3).map(e => e.outerHTML.slice(0, 90)),
            n: none.length,
          };
        });
        seen += r.count;
        if (r.n) bare.push(`${label}: ${r.n} (${r.none.join(' ')})`);
      }
      need(bare.length === 0, bare.join('; '));
      return `${seen} fields and buttons`;
    });
    await ctx.close();
  }

  // ---- a phone: no tab may push the page wider than the screen -------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await ctx.newPage();
    await phone.goto(origin);
    await phone.getByRole('button', { name: 'Load the sample' }).click();
    await phone.waitForTimeout(600);
    // which elements stick out past the screen without a scrolling box around them, widest first: says what to fix
    const widest = () => {
      const vw = document.documentElement.clientWidth,
        out = [];
      const all = root => {
        for (const el of root.querySelectorAll('*')) {
          see(el);
          if (el.shadowRoot) all(el.shadowRoot);
        }
      };
      const say = el =>
        `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className?.baseVal ?? el.className)
          .split(' ')
          .slice(0, 2)
          .join('.')}`;
      const see = el => {
        // an element's box can end inside the screen while its words or pictures spill out of it: count the spill too
        const r = el.getBoundingClientRect();
        const cs0 = getComputedStyle(el);
        const spills = cs0.overflowX === 'visible' && cs0.display !== 'inline' && el.scrollWidth > el.clientWidth + 1;
        const far = Math.max(r.right, spills ? r.left + el.scrollWidth : 0);
        if (far <= vw + 1) return;
        // held in by a box that clips sideways and itself ends inside the screen?
        let p = el.parentElement ?? el.getRootNode().host,
          held = false;
        while (p && p !== document.documentElement) {
          const cs = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && p.getBoundingClientRect().right <= vw + 1) {
            held = true;
            break;
          }
          p = p.parentElement ?? p.getRootNode().host;
        }
        if (!held) {
          const cs = getComputedStyle(el);
          out.push([
            Math.round(far - vw),
            `${say(el)} ${cs.display}/${cs.position} w${Math.round(r.width)} sw${el.scrollWidth} "${(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)}" in ${el.parentElement ? say(el.parentElement) : 'shadow'}`,
          ]);
        }
      };
      all(document);
      const d = document.documentElement,
        b = document.body;
      // whatever the cause, hiding the culprit removes the overflow: walk down to the smallest element that does
      const trail = [];
      let node = b;
      for (let depth = 0; depth < 14; depth++) {
        let found = null;
        for (const kid of node.children) {
          const was = kid.style.display;
          kid.style.display = 'none';
          const ok = d.scrollWidth <= vw + 1;
          kid.style.display = was;
          if (ok) {
            found = kid;
            break;
          }
        }
        if (!found) break;
        const r = found.getBoundingClientRect(),
          cs = getComputedStyle(found);
        trail.push(
          `${say(found)}[${cs.display} ${Math.round(r.left)}..${Math.round(r.right)} sw${found.scrollWidth} ox:${cs.overflowX}]`,
        );
        node = found;
      }
      out.unshift([
        d.scrollWidth - vw,
        `CULPRIT ${trail.join(' > ') || 'none found by hiding'} "${(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`,
      ]);
      return (
        `html ${d.scrollWidth}/${d.clientWidth} body ${b.scrollWidth}/${b.clientWidth}: ` +
        (out
          .slice(0, 9)
          .map(([n, t]) => `${t} +${n}`)
          .join(' | ') || 'no element past the edge')
      );
    };
    await step('at phone width no tab scrolls the page sideways', async () => {
      const wide = [];
      for (const label of TABS) {
        await phone.getByRole('button', { name: label, exact: true }).click();
        await phone.waitForTimeout(400);
        const over = await phone.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (over > 1) {
          wide.push(`${label} +${over}px`);
          console.log(`     ${label} is ${over}px too wide: ${await phone.evaluate(widest)}`);
        }
      }
      need(wide.length === 0, wide.join(', '));
      return `${TABS.length} tabs`;
    });
    // A table too wide for a phone must scroll inside its own box, never squeeze: a sum of money drawn on two lines
    // ("$3" over "00" over ",0" over "00") means a column was crushed. Folds are opened, and a budget account, so the
    // tables inside them are looked at too. (tools/phone-tables.py measures more, and says where.)
    await step('at phone width no sum of money in a table is broken over lines', async () => {
      const split = [];
      let sums = 0;
      for (const label of TABS) {
        await phone.getByRole('button', { name: label, exact: true }).click();
        await phone.waitForTimeout(400);
        await phone.evaluate(() => {
          for (const d of document.querySelectorAll('main details')) d.open = true;
        });
        if (label === 'Top sheet & budget') {
          await phone.locator('tr.cat td:first-child').first().click();
          await phone.locator('tr.acct td:first-child').first().click();
        }
        await phone.waitForTimeout(300);
        const r = await phone.evaluate(() => {
          const bad = [];
          let n = 0;
          for (const cell of document.querySelectorAll('table th, table td')) {
            const b = cell.getBoundingClientRect();
            if (!b.width || !b.height) continue;
            const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
            for (let node = walk.nextNode(); node; node = walk.nextNode()) {
              if (node.parentElement.closest('th, td') !== cell) continue; // a table inside this cell is looked at on its own
              for (const m of node.data.matchAll(/\S+/g)) {
                if (!/^\$[\d,]+/.test(m[0])) continue;
                const range = document.createRange();
                range.setStart(node, m.index);
                range.setEnd(node, m.index + m[0].length);
                const lines = new Set([...range.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top)));
                if (lines.size) n++;
                if (lines.size > 1) bad.push(`${m[0]} on ${lines.size} lines in a cell ${Math.round(b.width)}px wide`);
              }
            }
          }
          return { n, bad };
        });
        sums += r.n;
        if (r.bad.length) split.push(`${label}: ${r.bad.length} (${r.bad.slice(0, 2).join('; ')})`);
      }
      need(split.length === 0, split.join(' | '));
      need(sums > 50, `only ${sums} sums of money were found in tables, so the check is not looking at the tables`);
      return `${sums} sums of money in tables, each on one line`;
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
    await ctx.route(
      u => !String(u).startsWith(origin) && !/^(data|blob|about):/.test(String(u)),
      r => {
        asked.push(r.request().url());
        return r.abort();
      },
    );
    const p = await ctx.newPage();
    const stopped = await watchPolicy(ctx, p);
    await step('policy: the font picker may ask Google Fonts', async () => {
      await p.goto(origin);
      await p.getByRole('button', { name: 'Load the sample' }).click({ timeout: 20000 });
      await p.waitForTimeout(500);
      await p.getByRole('button', { name: 'Pitch', exact: true }).click();
      const open = p.getByRole('button', { name: 'Pick the title font from Google Fonts' });
      await open.scrollIntoViewIfNeeded();
      await open.click();
      await p.getByRole('dialog').getByRole('button', { name: 'Show the fonts' }).click();
      for (let i = 0; i < 40 && !asked.some(u => u.startsWith('https://fonts.googleapis.com/')); i++)
        await p.waitForTimeout(250);
      need(
        asked.some(u => u.startsWith('https://fonts.googleapis.com/')),
        'no request for fonts.googleapis.com left the page',
      );
      need(stopped.length === 0, `the policy refused: ${stopped[0]}`);
      await p.keyboard.press('Escape');
      return `${asked.length} request${asked.length === 1 ? '' : 's'} left for Google Fonts (cut off at the wire here); none refused by the policy`;
    });
    const tried = async (label, directive, attempt) =>
      step(label, async () => {
        const before = stopped.length,
          left = asked.length;
        const result = await p.evaluate(attempt);
        await p.waitForTimeout(400);
        const mine = stopped.slice(before);
        need(result === 'stopped', `it was not stopped: ${result}`);
        need(mine.length > 0, 'it did not happen, but the policy reported no refusal');
        need(asked.length === left, `a request left the page: ${asked[left]}`);
        return mine.find(v => v.startsWith(directive)) ?? mine[0];
      });
    await tried('policy: fetch() to another site is stopped', 'connect-src', () =>
      fetch('https://example.com/').then(
        () => 'answered',
        () => 'stopped',
      ),
    );
    await tried(
      'policy: a picture from another site is stopped',
      'img-src',
      () =>
        new Promise(done => {
          const img = new Image();
          img.onload = () => done('loaded');
          img.onerror = () => done('stopped');
          img.src = 'https://example.com/x.png';
          document.body.appendChild(img);
        }),
    );
    await tried('policy: an injected inline script does not run', 'script-src', () => {
      const s = document.createElement('script');
      s.textContent = 'window.__injected = true';
      document.head.appendChild(s);
      return window.__injected ? 'it ran' : 'stopped';
    });
    await tried(
      'policy: a script from another site is stopped',
      'script-src',
      () =>
        new Promise(done => {
          const s = document.createElement('script');
          s.onload = () => done('loaded');
          s.onerror = () => done('stopped');
          s.src = 'https://example.com/x.js';
          document.head.appendChild(s);
        }),
    );
    await tried(
      'policy: a frame is stopped',
      'frame-src',
      () =>
        new Promise(done => {
          const f = document.createElement('iframe');
          f.src = 'https://example.com/';
          document.body.appendChild(f);
          setTimeout(() => done('stopped'), 300);
        }),
    );
    await ctx.close();
  }

  // ---- the file a reader opens, with no network -------------------------------------------------------------------
  if (saved['deck.html']) {
    const url = pathToFileURL(saved['deck.html']).href;
    // No network for the reader: everything that is not the file itself is refused. (WebKit will not open a file at all
    // in a context set offline, so the wall is a route instead; a request that hits it is still counted below.)
    const sealed = async options => {
      const ctx = await browser.newContext(options);
      await ctx.route(
        u => !/^(file|data|blob|about):/.test(String(u)),
        r => r.abort(),
      );
      return ctx;
    };
    const reader = async (label, viewport, hash = '') => {
      const ctx = await sealed({ viewport });
      const p = await ctx.newPage();
      const errs = [];
      const asked = [];
      p.on('pageerror', e => errs.push(`pageerror: ${e.message}`));
      p.on('console', m => {
        if (m.type() === 'error') errs.push(`console: ${m.text()}`);
      });
      p.on('request', r => {
        if (!/^(file|data|blob|about):/.test(r.url())) asked.push(r.url());
      });
      await p.goto(url + hash);
      await p.waitForTimeout(2500);
      const info = await p.evaluate(async () => {
        const root =
          document.querySelector('.psd-host, #deck, body > div')?.shadowRoot ??
          [...document.querySelectorAll('*')].find(e => e.shadowRoot)?.shadowRoot;
        const slides = root ? [...root.querySelectorAll('section.psd-slide')] : [];
        await document.fonts.ready;
        return {
          slides: slides.length,
          over: slides.filter(s => s.getAttribute('data-overflow') === 'true').length,
          ask:
            (slides.map(s => s.textContent).find(t => /We are raising/.test(t)) || '')
              .replace(/\s+/g, ' ')
              .match(/We are raising\s*\$[\d,]+/)?.[0] ?? '',
          wide: document.documentElement.scrollWidth > window.innerWidth + 1,
          fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')),
          failed: [...document.fonts].filter(f => f.status === 'error').map(f => f.family),
          stacked:
            !!root?.querySelector('.psd-stacked, [data-stacked="true"]') ||
            root?.host?.classList?.contains('psd-stacked') ||
            false,
        };
      });
      await p.screenshot({ path: `${out}/10-file-${label}.png` });
      await ctx.close();
      return { ...info, errs, asked };
    };
    let withGrants = '';
    await step('sent file, offline, 1600x900', async () => {
      const r = await reader('1600', { width: 1600, height: 900 });
      need(r.slides === 14, `${r.slides} slides`);
      need(r.errs.length === 0, r.errs.slice(0, 3).join(' | '));
      need(r.asked.length === 0, `asked for ${r.asked[0]}`);
      need(r.over === 0, `${r.over} slides overflow`);
      need(r.failed.length === 0, `fonts failed: ${r.failed.join(', ')}`);
      withGrants = r.ask;
      return `${r.ask}; fonts ${[...new Set(r.fonts)].join(', ') || 'none loaded'}`;
    });
    await step('sent file: #without opens the larger ask', async () => {
      const r = await reader('without', { width: 1600, height: 900 }, '#without');
      need(r.ask && r.ask !== withGrants, `the ask reads "${r.ask}" both ways`);
      return r.ask;
    });
    await step('sent file, 1024x768', async () => {
      const r = await reader('1024', { width: 1024, height: 768 });
      need(
        r.slides === 14 && r.over === 0 && r.errs.length === 0,
        `${r.slides} slides, ${r.over} overflow, ${r.errs[0] ?? ''}`,
      );
    });
    await step('sent file on a phone, 390x844', async () => {
      const r = await reader('phone', { width: 390, height: 844 });
      need(r.slides === 14, `${r.slides} slides`);
      need(!r.wide, 'the page scrolls sideways');
      need(r.errs.length === 0, r.errs.slice(0, 2).join(' | '));
    });
    await step('sent file: every slide, one by one', async () => {
      const ctx = await sealed({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
      const p = await ctx.newPage();
      await p.goto(url);
      await p.waitForTimeout(1500);
      for (let i = 0; i < 14; i++) {
        await p.evaluate(n => {
          const root = [...document.querySelectorAll('*')].find(e => e.shadowRoot)?.shadowRoot;
          root?.querySelectorAll('section.psd-slide')[n]?.scrollIntoView({ behavior: 'instant' });
        }, i);
        await p.waitForTimeout(350);
        await p.screenshot({ path: `${out}/20-slide-${String(i + 1).padStart(2, '0')}.png` });
      }
      // One small sheet of all fourteen, printed into the log when asked (BROWSER_SHEET=1), so a run on a machine nobody
      // can open still shows what the browser drew.
      if (process.env.BROWSER_SHEET) {
        const imgs = Array.from(
          { length: 14 },
          (_, i) =>
            `<img src="data:image/png;base64,${readFileSync(`${out}/20-slide-${String(i + 1).padStart(2, '0')}.png`).toString('base64')}">`,
        ).join('');
        const sheet = await ctx.newPage();
        await sheet.setViewportSize({ width: 1640, height: 1200 });
        await sheet.setContent(
          `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(4,400px);gap:8px;padding:8px">${imgs}<style>img{width:400px;display:block}</style></body>`,
        );
        await sheet.waitForTimeout(800);
        const jpg = await sheet.screenshot({ type: 'jpeg', quality: 62, fullPage: true });
        writeFileSync(`${out}/sheet.jpg`, jpg);
        const b64 = jpg.toString('base64');
        console.log('SHEET-BEGIN');
        for (let i = 0; i < b64.length; i += 4000) console.log('SHEET ' + b64.slice(i, i + 4000));
        console.log('SHEET-END');
      }
      await ctx.close();
    });
    await step('sent file: arrow keys page it', async () => {
      const ctx = await sealed({ viewport: { width: 1600, height: 900 } });
      const p = await ctx.newPage();
      await p.goto(url);
      await p.waitForTimeout(1500);
      await p.mouse.click(800, 450);
      for (let i = 0; i < 3; i++) {
        await p.keyboard.press('ArrowRight');
        await p.waitForTimeout(900);
      }
      const at = await p.evaluate(() => {
        const root = [...document.querySelectorAll('*')].find(e => e.shadowRoot)?.shadowRoot;
        const s = [...(root?.querySelectorAll('section.psd-slide') ?? [])];
        return s.findIndex(x => {
          const r = x.getBoundingClientRect();
          return r.top > -10 && r.top < 10 && r.left > -10 && r.left < 10;
        });
      });
      await ctx.close();
      need(at === 3, `after three presses the deck is on slide ${at + 1}`);
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
const md = [
  `### ${name}: ${failed.length ? `${failed.length} of ${rows.length} steps failed` : `all ${rows.length} steps passed`}`,
  '',
  '| | Step | Detail |',
  '|---|---|---|',
  ...rows.map(r => `| ${r.ok ? '✅' : '❌'} | ${esc(r.step)} | ${esc(r.detail)} |`),
  '',
].join('\n');
writeFileSync(`${out}/report.md`, md);
writeFileSync(`${out}/report.json`, JSON.stringify({ browser: name, rows }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
process.exit(failed.length ? 1 : 0);
