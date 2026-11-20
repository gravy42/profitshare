// The budget, taken out of ProfitShare for people who do not use it: an Excel workbook, a CSV of the lines, and a PDF.
// Pure functions: a project in, rows or bytes out. No DOM and no clock (the date is handed in), so they run in tests.
//
// Pass the effective project (after applyDeal), as everywhere in the engine: the export is what the Top sheet tab shows.
// No money is worked out here a second way. Every figure comes from topSheet(), lineSubtotal(), lineFringes() and
// waterfallReport(), and is rounded to the cent only as it is written down.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { LineItem, Participant, PayType, Project, Section } from '../types';
import {
  lineFringes,
  lineSubtotal,
  rollupCashTotal,
  round2,
  topSheet,
  type CategoryRollup,
  type Rollup,
  type TopSheet,
} from '../budget';
import { withDeal } from '../deal';
import { sagReport, sagTier } from '../sag';
import { waterfallReport } from '../waterfall';
import { looksLikeFormula, writeXlsx, type SheetCell, type SheetSpec } from './xlsxWriter';

const SECTION_LABEL: Record<Section, string> = {
  ATL: 'above the line',
  PRODUCTION: 'production',
  POST: 'post production',
  OTHER: 'other',
};
const PAY_LABEL: Record<PayType, string> = { cash: 'up front', deferred: 'deferred', points: 'points' }; // the words the Top sheet tab uses
const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// ---------- file names ----------

/** "SALT_FLAT_Draft_3_budget.xlsx": the project's name and version the way the project file itself is named
 *  (letters, digits, - and _ only), so the files sit together in a folder. */
export function budgetFileName(p: { name?: string; version?: string }, ext: 'xlsx' | 'csv' | 'pdf'): string {
  const part = (s: unknown, max: number) =>
    (typeof s === 'string' ? s : '')
      .replace(/[^\w-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, max);
  const name = part(p.name, 60) || 'project',
    version = part(p.version, 30);
  return `${name}${version ? `_${version}` : ''}_budget.${ext}`;
}

// ---------- the budget as rows ----------

/** One budget line with the money the app works out for it. */
interface ExportLine {
  category: string;
  account: string;
  accountName: string;
  line: LineItem;
  subtotal: number;
  fringes: number;
  total: number;
}

/** The categories of each section in the order the Top sheet tab lists them (by number). */
function sectionsInOrder(ts: TopSheet): { section: Section; rollup: Rollup; categories: CategoryRollup[] }[] {
  return ts.sections.map(s => ({
    section: s.section,
    rollup: s,
    categories: [...s.categories].sort((a, b) => byNumber(a.category.number, b.category.number)),
  }));
}

/** Every line the budget counts, in top sheet order: section, category, account, then the order the lines are in.
 *  A line whose account or category is missing is not in the app's totals, so it is not here either. */
export function budgetLines(p: Project, ts: TopSheet = topSheet(p)): ExportLine[] {
  const out: ExportLine[] = [];
  const byAccount = new Map<string, LineItem[]>();
  for (const l of p.lines) (byAccount.get(l.accountId) ?? byAccount.set(l.accountId, []).get(l.accountId)!).push(l);
  for (const s of sectionsInOrder(ts))
    for (const c of s.categories)
      for (const a of c.accounts) {
        for (const line of byAccount.get(a.account.number) ?? []) {
          // a points line carries no fringes anywhere in the app (it is not payroll): its total is the value traded
          const subtotal = lineSubtotal(line),
            fringes = line.payType === 'points' ? 0 : lineFringes(line, p.fringes);
          out.push({
            category: c.category.number,
            account: a.account.number,
            accountName: a.account.name,
            line,
            subtotal,
            fringes,
            total: round2(subtotal + fringes),
          });
        }
      }
  return out;
}

/** The column headings of the Budget sheet and the CSV. Category, Account, Description, Amount, Units, X, Rate,
 *  Subtotal, Fringes, Fringes $ and Notes are names the app's own importer (importers/genericBudget.ts) reads, so the
 *  file can come back in. Account name, Pay type and Total are for the person reading; the importer passes over them. */
export const BUDGET_COLUMNS = [
  'Category',
  'Account',
  'Account name',
  'Description',
  'Amount',
  'Units',
  'X',
  'Rate',
  'Subtotal',
  'Pay type',
  'Fringes',
  'Fringes $',
  'Total',
  'Notes',
] as const;
const TOTAL_COLUMN = BUDGET_COLUMNS.indexOf('Total');

type Plain = string | number | '';
function lineRow(x: ExportLine): Plain[] {
  const l = x.line;
  return [
    x.category,
    x.account,
    x.accountName,
    l.description,
    l.amount,
    l.unit,
    l.multiplier,
    l.rate,
    x.subtotal,
    PAY_LABEL[l.payType] ?? String(l.payType),
    l.fringes.join(', '),
    x.fringes || '',
    x.total,
    l.notes ?? '',
  ];
}

/** The totals under the lines. The figure sits in the Total column only, and the row has no account number, so the
 *  app's importer reads these as what they are (not budget lines) and a sum of the Subtotal column stays the lines'. */
function summaryRows(p: Project, ts: TopSheet): { label: string; value: number }[] {
  return [
    { label: 'Subtotal up front (before contingency)', value: round2(rollupCashTotal(ts.subtotal)) },
    { label: `Contingency ${p.contingencyPct}%`, value: ts.contingency },
    { label: 'Budget to raise', value: ts.cashBudget },
    { label: 'Deferred (fixed, counts for SAG)', value: ts.deferredTotal },
    { label: 'Total production cost (SAG measures this)', value: ts.totalProductionCost },
    { label: 'Value traded for points', value: ts.pointsValue },
  ];
}

// ---------- CSV ----------

/** One CSV field. Text that would start a formula in a spreadsheet (= + - @) gets an apostrophe in front, which
 *  spreadsheets read as "this is text"; a dash on its own (the app's "no unit") cannot be a formula and is left alone.
 *  Numbers are written plainly, so a negative amount is still a number. */
export function csvField(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
  if (typeof v === 'string' && looksLikeFormula(s) && s !== '-') s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The budget lines as CSV text: a heading row, one row per line, a blank row, then the totals. Commas, CRLF line
 *  ends, and a byte-order mark in front so Excel reads accented letters correctly.
 *
 *  What comes back when this file is imported into a new project: every line (count, account, description, amount,
 *  units, multiplier, rate, notes), each account under its category, and the fringes by name. What does not: pay type
 *  (an import is all up front), account and category names (the importer gives the standard chart's names), fringe
 *  rates other than the built-in California set (those come in at 0% with a note), the contingency percentage, and the
 *  apostrophe guard on text that looked like a formula stays in the text. */
export function budgetCsv(p: Project): string {
  const ts = topSheet(p);
  const rows: (string | number)[][] = [[...BUDGET_COLUMNS], ...budgetLines(p, ts).map(lineRow), []];
  for (const s of summaryRows(p, ts)) {
    const row: (string | number)[] = BUDGET_COLUMNS.map(() => '');
    row[BUDGET_COLUMNS.indexOf('Description')] = s.label;
    row[TOTAL_COLUMN] = s.value;
    rows.push(row);
  }
  return '﻿' + rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

// ---------- the workbook ----------

const money = (value: number, bold = false): SheetCell => ({ value: round2(value), format: 'money', bold });
const moneyOrBlank = (value: number, bold = false): SheetCell => (round2(value) ? money(value, bold) : '');
const bold = (value: string): SheetCell => ({ value, bold: true });

/** The Top sheet tab as rows: every category, a total for each section, then the subtotal, contingency and the
 *  grand totals. Up front and Deferred include their fringes, as on screen; Total is up front plus deferred. */
function topSheetRows(p: Project, ts: TopSheet): SheetCell[][] {
  const rows: SheetCell[][] = [
    ['Account', 'Category', 'Up front', 'Deferred', 'Points', 'Fringes', 'Total (up front + deferred)'],
  ];
  const figures = (r: Rollup, strong = false): SheetCell[] => [
    money(rollupCashTotal(r), strong),
    moneyOrBlank(r.deferred + r.deferredFringes, strong),
    moneyOrBlank(r.points, strong),
    moneyOrBlank(r.cashFringes + r.deferredFringes, strong),
    money(rollupCashTotal(r) + r.deferred + r.deferredFringes, strong),
  ];
  for (const s of sectionsInOrder(ts)) {
    for (const c of s.categories) rows.push([c.category.number, c.category.name, ...figures(c)]);
    rows.push(['', bold(`Total ${SECTION_LABEL[s.section]}`), ...figures(s.rollup, true)]);
  }
  rows.push([]);
  rows.push(['', bold('Subtotal'), ...figures(ts.subtotal, true)]);
  rows.push(['', `Contingency ${p.contingencyPct}%`, money(ts.contingency), '', '', '', money(ts.contingency)]);
  rows.push([
    '',
    bold('Budget to raise'),
    money(ts.cashBudget, true),
    moneyOrBlank(ts.deferredTotal, true),
    moneyOrBlank(ts.pointsValue, true),
    '',
    '',
  ]);
  rows.push([
    '',
    bold('Total production cost (SAG measures this)'),
    '',
    '',
    '',
    '',
    money(ts.totalProductionCost, true),
  ]);
  return rows;
}

function budgetSheetRows(p: Project, ts: TopSheet): SheetCell[][] {
  const moneyCols = new Set(
    ['Rate', 'Subtotal', 'Fringes $', 'Total'].map(h => BUDGET_COLUMNS.indexOf(h as (typeof BUDGET_COLUMNS)[number])),
  );
  const rows: SheetCell[][] = [[...BUDGET_COLUMNS]];
  for (const x of budgetLines(p, ts))
    rows.push(lineRow(x).map((v, i) => (typeof v === 'number' && moneyCols.has(i) ? money(v) : v)));
  rows.push([]);
  for (const s of summaryRows(p, ts)) {
    const row: SheetCell[] = BUDGET_COLUMNS.map(() => '');
    const strong = s.label === 'Budget to raise';
    row[BUDGET_COLUMNS.indexOf('Description')] = strong ? bold(s.label) : s.label;
    row[TOTAL_COLUMN] = money(s.value, strong);
    rows.push(row);
  }
  return rows;
}

const GROUP_LABEL: Record<Participant['group'], string> = {
  producer: 'Above the line',
  cast: 'Cast',
  crew: 'Below the line',
  other: 'Below the line (other)',
};
const GROUP_ORDER: Participant['group'][] = ['producer', 'cast', 'crew', 'other'];

/** The points schedule: one row per person in the order the Points tab lists them (above the line, cast, then below
 *  the line by department), a subtotal under each group, and everyone at the foot. */
function pointsRows(p: Project): SheetCell[][] {
  const r = waterfallReport(p);
  const rows: SheetCell[][] = [
    [
      'Participant',
      'Role',
      'Group',
      'Department',
      'Tier',
      'Days',
      'Bonus x',
      'Points',
      'Share',
      'Wages',
      ...r.scenarios.map(s => `Payout at $${s.toLocaleString('en-US')} revenue`),
    ],
  ];
  // department = the budget category of the person's wage line (or of the account in their id), as on the Points tab
  const catOfAcct = new Map(p.accounts.map(a => [a.number, a.categoryNumber]));
  const catName = new Map(p.categories.map(c => [c.number, c.name]));
  const deptOf = (pt: Participant): { number: string; name: string } => {
    const line = p.lines.find(l => l.participantId === pt.id && (l.unit === 'DAY' || l.unit === 'WEEK'));
    const acct = line?.accountId ?? /^p_(\d{4})_/.exec(pt.id)?.[1];
    const cat = acct ? catOfAcct.get(acct) : undefined;
    return cat ? { number: cat, name: catName.get(cat) ?? cat } : { number: '9999', name: 'Other' };
  };
  const tierName = new Map(p.tiers.map(t => [t.id, `${t.name} x${t.multiplier}`]));
  type Row = (typeof r.rows)[number];
  const totals = (label: string, list: Row[]): SheetCell[] => [
    bold(label),
    '',
    '',
    '',
    '',
    { value: list.reduce((n, x) => n + x.participant.days, 0), bold: true },
    '',
    { value: round2(list.reduce((n, x) => n + x.points, 0)), bold: true },
    { value: list.reduce((n, x) => n + x.share, 0), format: 'percent', bold: true },
    moneyOrBlank(
      list.reduce((n, x) => n + (x.cashPay ?? 0), 0),
      true,
    ),
    ...r.scenarios.map((_, i) =>
      money(
        list.reduce((n, x) => n + x.payouts[i], 0),
        true,
      ),
    ),
  ];
  for (const group of GROUP_ORDER) {
    const list = r.rows
      .filter(x => x.participant.group === group)
      .map(x => ({ x, dept: group === 'crew' || group === 'other' ? deptOf(x.participant) : null }));
    if (!list.length) continue;
    if (group === 'cast') list.sort((a, b) => (a.x.participant.castId ?? 999) - (b.x.participant.castId ?? 999));
    else if (group !== 'producer') list.sort((a, b) => a.dept!.number.localeCompare(b.dept!.number));
    for (const { x, dept } of list) {
      const pt = x.participant;
      rows.push([
        pt.name,
        pt.role,
        GROUP_LABEL[pt.group],
        dept ? `${dept.number !== '9999' ? dept.number + ' ' : ''}${dept.name}` : '',
        tierName.get(pt.tierId) ?? pt.tierId,
        pt.days,
        pt.fixedPoints ? 'fixed points' : pt.bonusMultiplier,
        round2(x.points),
        { value: x.share, format: 'percent' },
        moneyOrBlank(x.cashPay ?? 0),
        ...x.payouts.map(v => money(v)),
      ]);
    }
    rows.push(
      totals(
        `${GROUP_LABEL[group]} subtotal · ${list.length} ${list.length === 1 ? 'person' : 'people'}`,
        list.map(l => l.x),
      ),
    );
  }
  rows.push([]);
  rows.push(totals(`Everyone · ${r.rows.length} ${r.rows.length === 1 ? 'person' : 'people'}`, r.rows));
  return rows;
}

const PREMIUM_LABEL = {
  cash: 'paid up front',
  points: 'traded for points',
  deferred: 'deferred',
  delete: 'left out of the budget',
} as const;

/** The terms that explain the numbers on the other sheets. */
function dealRows(p0: Project, ts: TopSheet, date: Date): SheetCell[][] {
  const p = withDeal(p0);
  const d = p.deal!;
  const w = p.waterfall;
  const sag = sagReport(p);
  const r = waterfallReport(p);
  const rows: SheetCell[][] = [['Term', 'Value', 'Notes']];
  const say = (term: string, value: SheetCell, notes = '') => rows.push([term, value, notes]);
  const head = (title: string) => {
    rows.push([]);
    rows.push([bold(title)]);
  };
  say('Project', p.name);
  say('Version', p.version);
  say('Exported', isoDay(date));
  say('Currency', p.currency);

  head('Budget');
  say('Budget to raise', money(ts.cashBudget, true), 'Up front costs and their fringes, plus contingency');
  say('Contingency %', { value: p.contingencyPct / 100, format: 'percent' }, 'Of the up front subtotal');
  say('Contingency', money(ts.contingency));
  say('Deferred', money(ts.deferredTotal), 'Fixed amounts owed from first proceeds, with their fringes');
  say('Total production cost', money(ts.totalProductionCost), 'Budget to raise plus deferred');
  say('Value traded for points', money(ts.pointsValue), 'Outside the budget: paid only from the back end');
  say('Shoot days', p.shootDays);
  say('Shooting day, hours', p.dayHours ?? 12, 'Hourly lines are paid for this many hours, with overtime');

  head('SAG-AFTRA');
  say(
    'SAG tier',
    sag.target.name,
    `Scale $${sag.target.dayRate} a day, pension and health ${round2(sag.target.phRate * 100)}%`,
  );
  say(
    'Tier ceiling',
    sag.targetCap === null ? 'none' : money(sag.targetCap),
    sag.dic ? 'With the Diversity in Casting incentive' : '',
  );
  say(
    'Total production cost SAG measures',
    money(sag.totalProductionCost),
    p.sag.includeContingency ? 'Contingency counted' : 'Contingency not counted',
  );
  say(
    'Fits the tier',
    sag.fits ? 'yes' : 'no',
    sag.fits ? '' : `The cheapest tier these numbers qualify for is ${sag.qualifying.name}`,
  );

  head('Pay');
  say('Pay model', d.pay.model === 'everyone-at-scale' ? 'Everyone at scale' : 'As budgeted');
  if (d.pay.model === 'everyone-at-scale')
    say(
      'Crew and producer rate, 8 hours',
      money(d.pay.crewBasis === 'custom' ? d.pay.crewCustomRate : sagTier(d.pay.crewBasis).dayRate),
      d.pay.crewBasis === 'custom' ? 'A rate set for this film' : `The ${d.pay.crewBasis} scale day rate`,
    );
  else {
    say('Cast re-rated to the SAG tier', d.pay.rerateCast ? 'yes' : 'no');
    if (d.pay.crewBumpPct) say('Crew rates raised by', { value: d.pay.crewBumpPct / 100, format: 'percent' });
  }
  say('Producer fees', PREMIUM_LABEL[d.pay.premiums.producers]);
  say('Script purchase', PREMIUM_LABEL[d.pay.premiums.script]);
  say('Star and cast allowances', PREMIUM_LABEL[d.pay.premiums.allowances]);
  say(
    'Prep, wrap and post days at a floor',
    d.nonShoot.enabled ? 'yes' : 'no',
    d.nonShoot.enabled
      ? `$${d.nonShoot.cashHourly} an hour up front, the rest ${d.nonShoot.rest === 'points' ? 'as points' : 'deferred'}`
      : '',
  );

  head('Back end');
  say('Waterfall', w.model === 'off-the-gross' ? 'Off the gross' : 'Recoup first');
  say('Investors recoup', { value: w.recoupPct / 100, format: 'percent' }, 'Of what they put in');
  say('What investors put in', money(r.budget), 'Budget to raise less grants and incentives');
  if (w.model === 'off-the-gross')
    say('Pool share until recoupment', { value: w.grossSharePct / 100, format: 'percent' });
  say('Pool share after recoupment', { value: w.poolPct / 100, format: 'percent' });
  say(
    'Total points',
    round2(r.totalPoints),
    `${p.participants.length} ${p.participants.length === 1 ? 'person' : 'people'} on the points schedule`,
  );

  head('Fringe rates');
  rows.push([
    bold('Fringe'),
    bold('Rate'),
    bold('Wage cap per line'),
    bold('Lines'),
    bold('Shown on the Budget sheet as'),
  ]);
  for (const f of p0.fringes)
    rows.push([
      f.name || f.id,
      { value: f.rate, format: 'percent' },
      f.cap ? money(f.cap) : 'none',
      p0.lines.filter(l => l.fringes.includes(f.id)).length,
      f.id,
    ]);
  return rows;
}
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The workbook: Top sheet, Budget (every line), Points (the schedule) and Deal (the terms behind the numbers). */
export function budgetWorkbook(p: Project, opts: { date?: Date } = {}): SheetSpec[] {
  const ts = topSheet(p);
  return [
    { name: 'Top sheet', rows: topSheetRows(p, ts), widths: [10, 40, 16, 16, 16, 16, 26], freezeRows: 1 },
    {
      name: 'Budget',
      rows: budgetSheetRows(p, ts),
      widths: [10, 10, 28, 44, 10, 9, 8, 14, 15, 10, 30, 13, 15, 40],
      freezeRows: 1,
    },
    {
      name: 'Points',
      rows: pointsRows(p),
      widths: [30, 26, 20, 26, 16, 8, 12, 10, 10, 14, ...waterfallReport(p).scenarios.map(() => 22)],
      freezeRows: 1,
    },
    { name: 'Deal', rows: dealRows(p, ts, opts.date ?? new Date()), widths: [38, 24, 64, 10, 30], freezeRows: 1 },
  ];
}

/** The bytes of the .xlsx file. */
export function budgetXlsx(p: Project, opts: { date?: Date } = {}): Uint8Array {
  return writeXlsx(budgetWorkbook(p, opts), opts);
}

// ---------- PDF ----------

const usd = (n: number) =>
  (n < 0 ? '-' : '') +
  '$' +
  Math.abs(round2(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

interface Col {
  w: number;
  right?: boolean;
}
interface CellText {
  text: string;
  bold?: boolean;
  muted?: boolean;
}
type RowCell = string | CellText;

/** Letter paper, portrait, with the project, version and date at the head of every page and the page number at the foot. */
const PAGE = { w: 612, h: 792, margin: 36, top: 62, bottom: 44 };
const INK = rgb(0.1, 0.1, 0.1),
  MUTED = rgb(0.42, 0.42, 0.42),
  RULE = rgb(0.75, 0.75, 0.75),
  BAND = rgb(0.93, 0.93, 0.93);

/** A regular and a bold font file (TrueType or OpenType) for the letters Helvetica lacks. The app passes Noto Sans
 *  (src/assets/fonts/noto-sans/, SIL Open Font License 1.1). */
export type PdfFaces = { regular: Uint8Array; bold: Uint8Array };

/** The budget as a PDF: the top sheet first, then the full budget (every account and line with money on it, as
 *  "Print full budget" lists them), on as many pages as it takes. It is set in the two standard faces every PDF
 *  reader carries (Helvetica and its bold), so nothing is fetched or embedded. When a name or a line has a letter
 *  those faces lack (Greek, Cyrillic, Vietnamese, Polish...) and `wideFaces` is given, the PDF is made again in the
 *  faces it returns, embedded with only the letters used. */
export async function budgetPdf(
  p: Project,
  opts: { date?: Date; wideFaces?: () => Promise<PdfFaces> } = {},
): Promise<Uint8Array> {
  const date = opts.date ?? new Date();
  const first = await drawBudgetPdf(p, date, null);
  if (!first.missed || !opts.wideFaces) return first.bytes;
  return (await drawBudgetPdf(p, date, await opts.wideFaces())).bytes;
}

async function drawBudgetPdf(
  p: Project,
  date: Date,
  wide: PdfFaces | null,
): Promise<{ bytes: Uint8Array; missed: boolean }> {
  const ts = topSheet(p);
  const pdf = await PDFDocument.create();
  let regular: PDFFont, strong: PDFFont;
  if (wide) {
    pdf.registerFontkit((await import('@pdf-lib/fontkit')).default);
    regular = await pdf.embedFont(wide.regular, { subset: true });
    strong = await pdf.embedFont(wide.bold, { subset: true });
  } else {
    regular = await pdf.embedFont(StandardFonts.Helvetica);
    strong = await pdf.embedFont(StandardFonts.HelveticaBold);
  }
  pdf.setTitle(`${p.name} ${p.version} budget`);
  pdf.setProducer('ProfitShare');
  pdf.setCreator('ProfitShare');
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);

  // A letter the faces do not have is written without its accent where that is possible and as a question mark where
  // it is not, so a name in another script cannot stop the file. `missed` says it happened, so the PDF can be made
  // again in wider faces. (The standard faces have the letters of Western European languages; Noto Sans adds the
  // rest of Latin, Greek and Cyrillic. Neither has Chinese, Japanese, Korean, Arabic or Hebrew.)
  const boldHas = new Set(strong.getCharacterSet());
  const known = new Set(regular.getCharacterSet().filter(c => boldHas.has(c)));
  let missed = false;
  const plain = (s: string): string => {
    let out = '';
    for (const ch of String(s ?? '')
      .normalize('NFC')
      .replace(/\s+/g, ' ')) {
      if (known.has(ch.codePointAt(0)!)) {
        out += ch;
        continue;
      }
      missed = true;
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      out += base && [...base].every(b => known.has(b.codePointAt(0)!)) ? base : '?';
    }
    return out;
  };
  const widthOf = (text: string, font: PDFFont, size: number) => font.widthOfTextAtSize(text, size);
  /** Break text into lines no wider than `max`; a word longer than the line is cut. At most `limit` lines, the last ending in "..." when there was more. */
  const wrap = (text: string, font: PDFFont, size: number, max: number, limit = 3): string[] => {
    const lines: string[] = [];
    let line = '';
    const push = (word: string) => {
      while (widthOf(word, font, size) > max && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && widthOf(word.slice(0, n), font, size) > max) n--;
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
      line = word;
    };
    for (const word of text.split(' ').filter(Boolean)) {
      if (!line) push(word);
      else if (widthOf(`${line} ${word}`, font, size) <= max) line += ` ${word}`;
      else {
        lines.push(line);
        line = '';
        push(word);
      }
    }
    if (line) lines.push(line);
    if (lines.length > limit) {
      let last = lines[limit - 1];
      while (last.length > 1 && widthOf(`${last}...`, font, size) > max) last = last.slice(0, -1);
      lines.length = limit;
      lines[limit - 1] = `${last}...`;
    }
    return lines.length ? lines : [''];
  };

  const pages: { page: PDFPage; what: string }[] = [];
  let page!: PDFPage;
  let y = 0;
  let what = '';
  let repeatHead: (() => void) | null = null; // the column headings of the table being drawn, put again at the top of each new page
  const newPage = () => {
    page = pdf.addPage([PAGE.w, PAGE.h]);
    pages.push({ page, what });
    y = PAGE.h - PAGE.top;
    repeatHead?.();
  };
  const room = (h: number) => {
    if (y - h < PAGE.bottom) newPage();
  };
  const contentW = PAGE.w - 2 * PAGE.margin;

  /** One table row. Text in a left column wraps; a figure in a right column is set against the column's right edge. */
  const row = (
    cols: Col[],
    cells: RowCell[],
    o: { size?: number; bold?: boolean; band?: boolean; ruleAbove?: boolean; gap?: number } = {},
  ) => {
    const size = o.size ?? 8,
      lead = size + 2.6,
      pad = 3;
    const drawn = cells.map((c, i) => {
      const cell: CellText = typeof c === 'string' ? { text: c } : c;
      const font = cell.bold || o.bold ? strong : regular;
      const text = plain(cell.text);
      const col = cols[i];
      return { col, font, muted: cell.muted, lines: col.right ? [text] : wrap(text, font, size, col.w - 2 * pad) };
    });
    const h = Math.max(...drawn.map(d => d.lines.length)) * lead + 2.4 + (o.gap ?? 0);
    room(h);
    y -= o.gap ?? 0;
    if (o.band)
      page.drawRectangle({
        x: PAGE.margin,
        y: y - h + (o.gap ?? 0),
        width: contentW,
        height: h - (o.gap ?? 0),
        color: BAND,
      });
    if (o.ruleAbove)
      page.drawLine({
        start: { x: PAGE.margin, y },
        end: { x: PAGE.margin + contentW, y },
        thickness: 0.6,
        color: RULE,
      });
    let x = PAGE.margin;
    for (const d of drawn) {
      d.lines.forEach((text, k) => {
        if (!text) return;
        const tx = d.col.right ? x + d.col.w - pad - widthOf(text, d.font, size) : x + pad;
        page.drawText(text, { x: tx, y: y - size - 1.2 - k * lead, size, font: d.font, color: d.muted ? MUTED : INK });
      });
      x += d.col.w;
    }
    y -= h - (o.gap ?? 0);
  };

  // ---- the top sheet ----
  what = 'Top sheet';
  const TOP: Col[] = [
    { w: 40 },
    { w: 176 },
    { w: 68, right: true },
    { w: 62, right: true },
    { w: 62, right: true },
    { w: 62, right: true },
    { w: 70, right: true },
  ];
  const topHead = () => {
    row(TOP, ['Acct', 'Category', 'Up front', 'Deferred', 'Points', 'Fringes', 'Total'], { bold: true, size: 8 });
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.margin + contentW, y }, thickness: 0.8, color: INK });
    y -= 1.5;
  };
  const blankZero = (n: number) => (round2(n) ? usd(n) : '');
  const figures = (r: Rollup): string[] => [
    usd(rollupCashTotal(r)),
    blankZero(r.deferred + r.deferredFringes),
    blankZero(r.points),
    blankZero(r.cashFringes + r.deferredFringes),
    usd(rollupCashTotal(r) + r.deferred + r.deferredFringes),
  ];
  repeatHead = topHead;
  newPage();
  for (const s of sectionsInOrder(ts)) {
    for (const c of s.categories) row(TOP, [c.category.number, c.category.name, ...figures(c)]);
    row(TOP, ['', `Total ${SECTION_LABEL[s.section]}`, ...figures(s.rollup)], { bold: true, band: true });
    y -= 4;
  }
  repeatHead = null;
  const SUM: Col[] = [{ w: contentW - 120 }, { w: 120, right: true }];
  const totalsBlock = () => {
    room(96);
    row(SUM, ['Above the line', usd(rollupCashTotal(ts.aboveTheLine))], { ruleAbove: true, gap: 6 });
    row(SUM, ['Below the line', usd(rollupCashTotal(ts.belowTheLine))]);
    row(SUM, [`Contingency ${p.contingencyPct}%`, usd(ts.contingency)]);
    row(SUM, ['Budget to raise (up front)', usd(ts.cashBudget)], { bold: true, band: true, size: 10 });
    if (ts.deferredTotal > 0) row(SUM, ['Deferred (fixed, counts for SAG)', usd(ts.deferredTotal)]);
    row(SUM, ['Total production cost (SAG measures this)', usd(ts.totalProductionCost)]);
    row(SUM, ['Value traded for points', usd(ts.pointsValue)]);
  };
  totalsBlock();

  // ---- the full budget ----
  what = 'Full budget';
  const LINES: Col[] = [
    { w: 32 },
    { w: 166 },
    { w: 32, right: true },
    { w: 34 },
    { w: 28, right: true },
    { w: 54, right: true },
    { w: 60, right: true },
    { w: 50, right: true },
    { w: 60, right: true },
    { w: 24 },
  ];
  const linesHead = () => {
    row(LINES, ['Acct', 'Description', 'Amt', 'Unit', 'x', 'Rate', 'Subtotal', 'Fringes', 'Total', 'Pay'], {
      bold: true,
      size: 7.5,
    });
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.margin + contentW, y }, thickness: 0.8, color: INK });
    y -= 1.5;
  };
  const PAY_MARK: Record<PayType, string> = { cash: '', deferred: 'DEF', points: 'PTS' };
  const all = budgetLines(p, ts);
  const rollTotal = (r: Rollup) => rollupCashTotal(r) + r.deferred + r.deferredFringes;
  repeatHead = linesHead;
  newPage();
  for (const s of sectionsInOrder(ts))
    for (const c of s.categories) {
      const accts = c.accounts.filter(a => rollupCashTotal(a) + a.deferred + a.points !== 0);
      if (!accts.length) continue;
      room(48); // a category heading is never the last thing on a page
      row(
        [{ w: contentW - 190 }, { w: 190, right: true }],
        [
          `${c.category.number} ${c.category.name}`,
          `${usd(rollTotal(c))}${c.points ? `  points ${usd(c.points)}` : ''}`,
        ],
        { bold: true, band: true, size: 8.5, gap: 5 },
      );
      for (const a of accts) {
        room(26);
        row(LINES, [a.account.number, a.account.name, '', '', '', '', '', '', usd(rollTotal(a)), ''], {
          bold: true,
          size: 7.5,
        });
        for (const x of all) {
          if (x.account !== a.account.number || x.subtotal === 0) continue;
          const l = x.line;
          row(
            LINES,
            [
              '',
              l.description,
              qty(l.amount),
              l.unit === '-' ? '' : l.unit,
              l.multiplier !== 1 ? qty(l.multiplier) : '',
              l.rate ? usd(l.rate) : '',
              usd(x.subtotal),
              x.fringes ? usd(x.fringes) : '',
              usd(x.total),
              { text: PAY_MARK[l.payType] ?? '', muted: true },
            ],
            { size: 7.5 },
          );
        }
      }
    }
  repeatHead = null;
  y -= 6;
  totalsBlock();
  if (all.some(x => x.line.payType !== 'cash'))
    row(
      [{ w: contentW }],
      [{ text: 'DEF: deferred, owed from first proceeds. PTS: traded for points, outside the budget.', muted: true }],
      { size: 7, gap: 4 },
    );

  // ---- the head and foot of every page ----
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const sub = `${p.shootDays} shoot days · ${p.contingencyPct}% contingency · budget to raise ${usd(ts.cashBudget)}`;
  pages.forEach(({ page: pg, what: section }, i) => {
    const top = PAGE.h - PAGE.margin;
    const title = wrap(plain(`${p.name} · ${p.version}`), strong, 11, contentW - 190, 1)[0];
    pg.drawText(title, { x: PAGE.margin, y: top - 10, size: 11, font: strong, color: INK });
    const right = plain(`${section} · ${day}`);
    pg.drawText(right, {
      x: PAGE.w - PAGE.margin - widthOf(right, regular, 9),
      y: top - 10,
      size: 9,
      font: regular,
      color: INK,
    });
    pg.drawText(plain(sub), { x: PAGE.margin, y: top - 21, size: 7.5, font: regular, color: MUTED });
    pg.drawLine({
      start: { x: PAGE.margin, y: top - 25 },
      end: { x: PAGE.w - PAGE.margin, y: top - 25 },
      thickness: 0.6,
      color: RULE,
    });
    const foot = `Page ${i + 1} of ${pages.length}`;
    pg.drawText(foot, {
      x: PAGE.w - PAGE.margin - widthOf(foot, regular, 8),
      y: 24,
      size: 8,
      font: regular,
      color: MUTED,
    });
    pg.drawText('ProfitShare', { x: PAGE.margin, y: 24, size: 8, font: regular, color: MUTED });
  });
  return { bytes: await pdf.save(), missed };
}
