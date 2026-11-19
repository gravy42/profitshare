// The budget taken out of the app three ways, each held to the app's own figures. The sample film (SALT FLAT) is the
// fixture: its budget to raise is $805,312.06, the figure the README and the other tests quote.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import { blankProject, deriveParticipants, sampleProject, standardChartOfAccounts } from '../../data/seed';
import { applyDeal } from '../deal';
import { foldMemoLines, lineFringes, lineSubtotal, rollupCashTotal, round2, topSheet } from '../budget';
import { weeksToDays } from '../sag';
import { waterfallReport } from '../waterfall';
import { parseBudgetFile } from '../importers/budget';
import { readSpreadsheet, sheetNamed } from '../importers/spreadsheet';
import { parseDelimited } from '../importers/delimited';
import type { Project } from '../types';
import { BUDGET_COLUMNS, budgetCsv, budgetFileName, budgetLines, budgetPdf, budgetWorkbook, budgetXlsx, csvField } from './budgetExport';

const SAMPLE_TOTAL = 805_312.06;
const sample = applyDeal(sampleProject());
const ts = topSheet(sample);
const DATE = new Date(2030, 8, 1);
const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const col = (name: typeof BUDGET_COLUMNS[number]) => BUDGET_COLUMNS.indexOf(name);

/** The sample with some of everything the export has to carry: deferred pay, points, a fringe of its own, awkward text. */
function mixed(): Project {
  const p = sampleProject();
  const lines = p.lines.map((l, i) => i % 7 === 0 ? { ...l, payType: 'deferred' as const } : i % 11 === 0 ? { ...l, payType: 'points' as const } : l);
  lines[1] = { ...lines[1], description: '=SUM(A1:A9)', notes: 'said "maybe", then, no\nsecond line' };
  lines[2] = { ...lines[2], description: '+1 day, pickup', fringes: [...lines[2].fringes, 'UNION X'] };
  lines[3] = { ...lines[3], description: '@home -office' };
  lines[4] = { ...lines[4], description: '-10% discount' };
  return applyDeal({ ...p, lines, contingencyPct: 7.5, fringes: [...p.fringes, { id: 'UNION X', name: 'Union X, pension', rate: 0.0333, cap: 5000 }] });
}

/** Read a file the way the app's Import budget button does, into a new project. */
function imported(buf: ArrayBuffer, filename: string, contingencyPct: number): { project: Project; lineCount: number; warnings: string[] } {
  const imp = parseBudgetFile(buf, filename, standardChartOfAccounts());
  const base = blankProject({ chartOfAccounts: 'empty' });
  const { participants, lines } = deriveParticipants(imp.lines, imp.accounts, base.board, base.shootDays);
  return { project: { ...base, contingencyPct, categories: imp.categories, accounts: imp.accounts, fringes: imp.fringes, lines, participants }, lineCount: imp.lines.length, warnings: imp.warnings };
}

describe('the sample film is what the tests think it is', () => {
  it('has a budget to raise of $805,312.06', () => { expect(ts.cashBudget).toBe(SAMPLE_TOTAL); });
});

describe('file names', () => {
  it('come from the project name and version, with nothing a file system minds', () => {
    expect(budgetFileName(sample, 'xlsx')).toBe('SALT_FLAT_Draft_3_budget.xlsx');
    expect(budgetFileName({ name: '../../etc/passwd', version: 'v1: "final"?' }, 'csv')).toBe('etc_passwd_v1_final_budget.csv');
    expect(budgetFileName({ name: '', version: '' }, 'pdf')).toBe('project_budget.pdf');
    expect(budgetFileName({ name: 'x'.repeat(200), version: 'y'.repeat(200) }, 'pdf')).toBe(`${'x'.repeat(60)}_${'y'.repeat(30)}_budget.pdf`);
    expect(budgetFileName({} as Project, 'pdf')).toBe('project_budget.pdf');
  });
});

describe('budgetLines', () => {
  it('lists every line the budget counts, with the money the app works out for it', () => {
    const lines = budgetLines(sample);
    expect(lines).toHaveLength(sample.lines.length);
    expect(new Set(lines.map(x => x.line.id)).size).toBe(sample.lines.length);
    for (const x of lines) { expect(x.subtotal).toBe(lineSubtotal(x.line)); expect(x.fringes).toBe(lineFringes(x.line, sample.fringes)); }
    expect(round2(lines.reduce((n, x) => n + x.total, 0))).toBe(round2(rollupCashTotal(ts.subtotal)));
  });
  it('a points line carries no fringes: its total is the value traded, so the columns add up to the top sheet', () => {
    const fringed = sample.lines.find(l => lineFringes(l, sample.fringes) > 0)!;
    const p = applyDeal({ ...sample, lines: sample.lines.map(l => l.id === fringed.id ? { ...l, payType: 'points' as const } : l) });
    const rows = budgetLines(p), row = rows.find(r => r.line.id === fringed.id)!, t = topSheet(p);
    expect(row.fringes).toBe(0);
    expect(row.total).toBe(row.subtotal);
    // up front + deferred + points on the top sheet is what the Total column now adds up to
    const st = t.subtotal;
    expect(round2(rows.reduce((a, r) => a + r.total, 0))).toBe(round2(st.cash + st.cashFringes + st.deferred + st.deferredFringes + st.points));
  });
  it('leaves out a line whose account is gone, as the top sheet does', () => {
    const p = { ...sample, lines: [...sample.lines, { ...sample.lines[0], id: 'orphan', accountId: 'nowhere' }] };
    expect(budgetLines(p)).toHaveLength(sample.lines.length);
    expect(topSheet(p).cashBudget).toBe(SAMPLE_TOTAL);
  });
});

describe('the workbook', () => {
  const bytes = budgetXlsx(sample, { date: DATE });
  const wb = readSpreadsheet(bytes, 'b.xlsx');
  const ref = XLSX.read(bytes, { type: 'array' });
  const rows = (name: string) => sheetNamed(wb, name)!;
  const labelled = (sheet: string, labelCol: number, label: string) => rows(sheet).find(r => r[labelCol] === label)!;

  it('has the four sheets, and both readers see the same cells', () => {
    expect(wb.sheets.map(s => s.name)).toEqual(['Top sheet', 'Budget', 'Points', 'Deal']);
    expect(ref.SheetNames).toEqual(['Top sheet', 'Budget', 'Points', 'Deal']);
    for (const s of wb.sheets) expect(XLSX.utils.sheet_to_json(ref.Sheets[s.name], { header: 1, defval: '', raw: true })).toEqual(s.rows);
  });

  it('Top sheet: every category, section totals, contingency and the grand totals, as the tab shows them', () => {
    const top = rows('Top sheet');
    expect(top[0]).toEqual(['Account', 'Category', 'Up front', 'Deferred', 'Points', 'Fringes', 'Total (up front + deferred)']);
    for (const s of ts.sections) for (const c of s.categories) {
      const r = top.find(x => x[0] === c.category.number)!;
      expect(r[1]).toBe(c.category.name);
      expect(r[2]).toBe(round2(c.cash + c.cashFringes));
      expect(r[5] || 0).toBe(round2(c.cashFringes + c.deferredFringes));
    }
    expect(top.filter(r => /^\d+$/.test(String(r[0])))).toHaveLength(sample.categories.length);
    expect(labelled('Top sheet', 1, 'Total above the line')[2]).toBe(round2(rollupCashTotal(ts.aboveTheLine)));
    expect(labelled('Top sheet', 1, 'Subtotal')[2]).toBe(round2(rollupCashTotal(ts.subtotal)));
    expect(labelled('Top sheet', 1, 'Contingency 10%')[2]).toBe(ts.contingency);
    expect(labelled('Top sheet', 1, 'Budget to raise')[2]).toBe(SAMPLE_TOTAL);
    expect(labelled('Top sheet', 1, 'Total production cost (SAG measures this)')[6]).toBe(ts.totalProductionCost);
    // the category rows add up to the subtotal, to the cent
    expect(round2(top.filter(r => /^\d+$/.test(String(r[0]))).reduce((n, r) => n + (r[2] as number), 0))).toBe(round2(rollupCashTotal(ts.subtotal)));
    expect(ref.Sheets['Top sheet'].C2.w).toMatch(/^\$[\d,]+\.\d\d$/);
  });

  it('Budget: every line, and the totals under them', () => {
    const b = rows('Budget');
    expect(b[0]).toEqual([...BUDGET_COLUMNS]);
    const lines = b.slice(1).filter(r => r[col('Account')] !== '');
    expect(lines).toHaveLength(sample.lines.length);
    expect(round2(lines.reduce((n, r) => n + (r[col('Total')] as number), 0))).toBe(round2(rollupCashTotal(ts.subtotal)));
    const first = budgetLines(sample)[0];
    expect(lines[0]).toEqual([first.category, first.account, first.accountName, first.line.description, first.line.amount, first.line.unit, first.line.multiplier, first.line.rate,
      first.subtotal, 'up front', first.line.fringes.join(', '), first.fringes || '', first.total, first.line.notes ?? '']);
    expect(labelled('Budget', col('Description'), 'Budget to raise')[col('Total')]).toBe(SAMPLE_TOTAL);
    expect(labelled('Budget', col('Description'), 'Contingency 10%')[col('Total')]).toBe(ts.contingency);
  });

  it('Points: the schedule, one row per person, shares adding to the whole', () => {
    const pts = rows('Points'); const r = waterfallReport(sample);
    expect(pts[0].slice(0, 10)).toEqual(['Participant', 'Role', 'Group', 'Department', 'Tier', 'Days', 'Bonus x', 'Points', 'Share', 'Wages']);
    expect(pts[0].slice(10)).toEqual(r.scenarios.map(s => `Payout at $${s.toLocaleString('en-US')} revenue`));
    const people = pts.slice(1).filter(x => x[2] !== '');
    expect(people).toHaveLength(sample.participants.length);
    expect(people.map(x => x[0]).sort()).toEqual(sample.participants.map(x => x.name).sort());
    const everyone = pts.find(x => String(x[0]).startsWith('Everyone'))!;
    expect(everyone[7]).toBe(round2(r.totalPoints));
    expect(everyone[8]).toBeCloseTo(1, 9);
    expect(everyone[10]).toBe(round2(r.pools[0]));
    for (const row of r.rows.slice(0, 5)) { const x = people.find(y => y[0] === row.participant.name)!; expect(x[7]).toBe(round2(row.points)); expect(x[10]).toBe(round2(row.payouts[0])); }
  });

  it('Deal: the terms that explain the numbers', () => {
    const term = (t: string) => labelled('Deal', 0, t);
    expect(term('Project')[1]).toBe('SALT FLAT'); expect(term('Version')[1]).toBe('Draft 3'); expect(term('Exported')[1]).toBe('2030-09-01');
    expect(term('Budget to raise')[1]).toBe(SAMPLE_TOTAL);
    expect(term('Contingency %')[1]).toBe(0.1);
    expect(term('Shoot days')[1]).toBe(12);
    expect(term('SAG tier')[1]).toBe('Moderate Low Budget');
    expect(term('Pay model')[1]).toBe('As budgeted');
    for (const f of sample.fringes) { const r = term(f.name); expect(r[1]).toBe(f.rate); expect(r[2]).toBe(f.cap ?? 'none'); }
    expect(ref.Sheets.Deal[`B${rows('Deal').findIndex(r => r[0] === 'Contingency %') + 1}`].w).toBe('10.00%');
  });

  it('carries deferred pay, points and awkward text without changing a figure or writing a formula', () => {
    const p = mixed(); const t = topSheet(p);
    const out = budgetXlsx(p, { date: DATE }); const back = readSpreadsheet(out);
    const top = sheetNamed(back, 'Top sheet')!; const find = (label: string) => top.find(r => r[1] === label)!;
    expect(find('Budget to raise').slice(2, 5)).toEqual([t.cashBudget, t.deferredTotal, t.pointsValue]);
    expect(find('Contingency 7.5%')[2]).toBe(t.contingency);
    expect(find('Subtotal')[6]).toBe(round2(rollupCashTotal(t.subtotal) + t.deferredTotal));
    expect(find('Total production cost (SAG measures this)')[6]).toBe(t.totalProductionCost);
    const b = sheetNamed(back, 'Budget')!;
    expect(new Set(b.slice(1).map(r => r[col('Pay type')]))).toEqual(new Set(['up front', 'deferred', 'points', '']));
    for (const d of ['=SUM(A1:A9)', '+1 day, pickup', '@home -office', '-10% discount']) expect(b.some(r => r[col('Description')] === d)).toBe(true);
    const sheet = XLSX.read(out, { type: 'array' }).Sheets.Budget;
    for (const k of Object.keys(sheet)) if (k[0] !== '!') expect(sheet[k].f).toBeUndefined();
  });

  it('an empty project still gives a workbook that opens', () => {
    const empty = applyDeal(blankProject({ chartOfAccounts: 'empty' }));
    const back = readSpreadsheet(budgetXlsx(empty, { date: DATE }));
    expect(back.sheets.map(s => s.name)).toEqual(['Top sheet', 'Budget', 'Points', 'Deal']);
    expect(sheetNamed(back, 'Top sheet')!.find(r => r[1] === 'Budget to raise')![2]).toBe(0);
  });

  it('gives a list of sheets with a frozen header each', () => {
    for (const s of budgetWorkbook(sample, { date: DATE })) { expect(s.freezeRows).toBe(1); expect(s.name.length).toBeLessThanOrEqual(31); }
  });
});

describe('the CSV', () => {
  const csv = budgetCsv(sample);
  const grid = parseDelimited(csv);

  it('has a heading row the importer reads, one row per line, and the totals', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(grid[0]).toEqual([...BUDGET_COLUMNS]);
    expect(grid.slice(1).filter(r => r[col('Account')] !== '')).toHaveLength(sample.lines.length);
    expect(grid.find(r => r[col('Description')] === 'Budget to raise')![col('Total')]).toBe('805312.06');
    expect(csv).toContain(',Budget to raise,,,,,,,,,805312.06,');
  });

  it('round trip: the sample exported and imported into a new project has the same lines and the same total', () => {
    const { project, lineCount, warnings } = imported(bytesOf(csv), 'SALT_FLAT_Draft_3_budget.csv', sample.contingencyPct);
    expect(lineCount).toBe(sample.lines.length);
    expect(warnings).toEqual([]);
    const back = topSheet(applyDeal(project));
    expect(back.cashBudget).toBe(SAMPLE_TOTAL);
    expect(back.contingency).toBe(ts.contingency);
    expect(back.totalProductionCost).toBe(ts.totalProductionCost);
    // line by line: the same account, words, quantities and money, in the same order
    const want = budgetLines(sample), got = budgetLines(project);
    expect(got.map(x => [x.account, x.line.description, x.line.amount, x.line.unit, x.line.multiplier, x.line.rate, x.line.fringes, x.subtotal, x.fringes, x.total]))
      .toEqual(want.map(x => [x.account, x.line.description, x.line.amount, x.line.unit, x.line.multiplier, x.line.rate, x.line.fringes, x.subtotal, x.fringes, x.total]));
    // every account sits under the category it had
    expect(new Map(project.accounts.map(a => [a.number, a.categoryNumber]))).toEqual(new Map([...new Set(want.map(x => x.account))].map(a => [a, want.find(x => x.account === a)!.category])));
    // and the rest of what the Import button does (weeks to days, memo rows folded) keeps the money where it was
    expect(topSheet(applyDeal(foldMemoLines(weeksToDays(project)))).cashBudget).toBe(SAMPLE_TOTAL);
  });

  it('round trip: the workbook imports the same way (the importer picks its Budget sheet)', () => {
    const bytes = budgetXlsx(sample, { date: DATE });
    const { project, lineCount } = imported(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 'SALT_FLAT_Draft_3_budget.xlsx', sample.contingencyPct);
    expect(lineCount).toBe(sample.lines.length);
    expect(topSheet(applyDeal(project)).cashBudget).toBe(SAMPLE_TOTAL);
    // even a one-line budget is read from the Budget sheet, never from the Top sheet's rows
    const tiny = applyDeal({ ...sampleProject(), lines: sampleProject().lines.slice(0, 1) });
    const small = budgetXlsx(tiny, { date: DATE });
    expect(imported(small.buffer.slice(small.byteOffset, small.byteOffset + small.byteLength) as ArrayBuffer, 't.xlsx', 10).lineCount).toBe(1);
  });

  it('round trip, what does not survive: pay type, a fringe rate of your own, the contingency percentage', () => {
    const p = mixed(); const t = topSheet(p);
    const { project, lineCount, warnings } = imported(bytesOf(budgetCsv(p)), 'mixed.csv', p.contingencyPct);
    // survives: every line, and what each line costs before fringes
    expect(lineCount).toBe(budgetLines(p).length);
    expect(budgetLines(project).map(x => x.subtotal)).toEqual(budgetLines(p).map(x => x.subtotal));
    // does not: an import is all up front, so deferred and points lines come back as money to raise
    expect(new Set(project.lines.map(l => l.payType))).toEqual(new Set(['cash']));
    expect(topSheet(project).cashBudget).toBeGreaterThan(t.cashBudget);
    // does not: a fringe that is not in the built-in set keeps its name on the line but comes in at 0%, and the import says so
    expect(project.fringes.find(f => f.id === 'UNION X')).toMatchObject({ rate: 0, cap: null });
    expect(warnings.some(w => /UNION X/.test(w))).toBe(true);
    // does not: text that looked like a formula keeps the apostrophe put in front of it
    expect(project.lines.map(l => l.description)).toEqual(expect.arrayContaining(["'=SUM(A1:A9)", "'+1 day, pickup", "'@home -office", "'-10% discount"]));
    // survives: a note with quotes, commas and a line break in it
    expect(project.lines.find(l => l.description === "'=SUM(A1:A9)")!.notes).toBe('said "maybe", then, no\nsecond line');
    // the contingency percentage is not a column: a new project starts at its own 10%
    expect(blankProject().contingencyPct).toBe(10);
  });

  it('quotes what needs quoting and guards what could run as a formula', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(' padded ')).toBe('" padded "');
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvField('-2+3')).toBe("'-2+3");
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('=cmd|"/c calc"!A1,x')).toBe('"\'=cmd|""/c calc""!A1,x"');
    expect(csvField('\t=1')).toBe("'\t=1");
    expect(csvField('-')).toBe('-');                       // the app's "no unit": a dash alone is not a formula
    expect(csvField(-12.5)).toBe('-12.5');                  // a negative number stays a number
    expect(csvField(NaN)).toBe(''); expect(csvField(null)).toBe(''); expect(csvField(undefined)).toBe('');
    const text = budgetCsv(mixed());
    const cells = parseDelimited(text).slice(1).flat().filter(c => typeof c === 'string' && c !== '-' && !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(c)) as string[];
    expect(cells.filter(c => /^[=+\-@]/.test(c))).toEqual([]);
  });
});

describe('the PDF', () => {
  /** The words on each page, in the order they were drawn, read back with the PDF reader the app already carries. */
  async function pagesText(bytes: Uint8Array): Promise<string[]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/` }).promise;
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      out.push(content.items.map(it => ('str' in it ? it.str : '')).filter(t => t.trim()).join(' | '));
    }
    return out;
  }

  it('is a top sheet page followed by the full budget, with the app\'s totals to the cent', async () => {
    const bytes = await budgetPdf(sample, { date: DATE });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(doc.getTitle()).toBe('SALT FLAT Draft 3 budget');
    const pages = await pagesText(bytes);
    // the head and foot of every page
    pages.forEach((text, i) => {
      expect(text).toContain('SALT FLAT · Draft 3');
      expect(text).toContain(`${i === 0 ? 'Top sheet' : 'Full budget'} · Sep 1, 2030`);
      expect(text).toContain(`Page ${i + 1} of ${pages.length}`);
    });
    // the top sheet page: every category and the grand totals
    const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const s of ts.sections) for (const c of s.categories) { expect(pages[0]).toContain(c.category.name); expect(pages[0]).toContain(usd(round2(c.cash + c.cashFringes))); }
    expect(pages[0]).toContain('Budget to raise (up front) | $805,312.06');
    expect(pages[0]).toContain(`Contingency 10% | ${usd(ts.contingency)}`);
    expect(pages[0]).toContain(`Total production cost (SAG measures this) | ${usd(ts.totalProductionCost)}`);
    // the full budget: every line with money on it, and the totals again at the end
    const rest = pages.slice(1).join(' | ');
    const withMoney = budgetLines(sample).filter(x => x.subtotal !== 0);
    for (const x of withMoney) expect(rest).toContain(usd(x.total));
    expect(rest.split(' | ').filter(t => t === 'Acct')).toHaveLength(pages.length - 1);      // the column headings on every budget page
    expect(pages[pages.length - 1]).toContain('Budget to raise (up front) | $805,312.06');
  }, 30000);

  it('does not stop at letters the standard faces lack, or at very long words', async () => {
    const p = sampleProject();
    const odd = applyDeal({ ...p, name: 'Соль 塩 Flat “quoted” — Žofka', version: 'v2 ✓',
      lines: p.lines.map((l, i) => i === 0 ? { ...l, description: 'Ł ǎ '.repeat(3) + ' ' + 'W'.repeat(400) + ' naïve café' } : l) });
    const bytes = await budgetPdf(odd, { date: DATE });
    const pages = await pagesText(bytes);
    expect(pages[0]).toContain('???? ? Flat “quoted” — Žofka · v2 ?');   // Cyrillic and Japanese have no stand-in; the rest is in the face
    expect(pages.join(' ')).toContain('$805,312.06');
  }, 30000);

  it('an empty project gives a PDF too', async () => {
    const bytes = await budgetPdf(applyDeal(blankProject({ chartOfAccounts: 'empty' })), { date: DATE });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});
