import * as XLSX from 'xlsx';
import type { Account, Category, FringeDef, LineItem } from '../types';
import { CA_FRINGES_2026 } from './shamelXlsx';
import { round2 } from '../budget';

/** Import a budget from any spreadsheet or CSV that has one row per line item and a header row:
 *  Movie Magic Budgeting's Excel/CSV export, a Shamel "Details" sheet on its own, Gorilla, Showbiz Budgeting,
 *  or a budget someone typed into Excel. Columns are matched by header name, so order does not matter.
 *
 *  Recognised headers (case-insensitive):
 *    account      Acct, Acct#, Account, Account #, No.
 *    description  Description, Desc, Item, Name, Line
 *    amount       Amount, Amt, Qty, Quantity, Units (when a separate unit-type column exists)
 *    unit         Units, Unit, Unit type, Per
 *    multiplier   X, Mult, Multiplier, Times
 *    rate         Rate, Price, Unit cost
 *    subtotal     Subtotal, Sub total, Total, Estimate, Est, Budget
 *    fringes      Fringes, Fringe (names, comma separated) — or a Fringe $ column (a dollar amount)
 *    category     Category, Cat, Dept, Department
 *
 *  Rows that carry an account number and a name but no money become account headers; rows whose number ends in 00
 *  become categories. Lines with only a Total get amount 1 × rate total. Lines with a fringe dollar amount but no
 *  fringe names get a synthetic fringe at the rate that reproduces that amount, so the totals still reconcile. */

export interface GenericImport {
  name: string;
  sheet: string;
  columns: Partial<Record<Col, number>>;
  categories: Category[]; accounts: Account[]; fringes: FringeDef[]; lines: LineItem[];
  warnings: string[];
  reportedTotal: number;    // sum of the file's own subtotal column, when it has one
}

type Col = 'account' | 'description' | 'amount' | 'unit' | 'multiplier' | 'rate' | 'subtotal' | 'fringeNames' | 'fringeAmount' | 'category' | 'notes';

const HEADERS: [Col, RegExp][] = [
  ['account', /^(acct\.?|acct ?#|account( ?(#|no\.?|number))?|no\.?|#|code)$/i],
  ['description', /^(description|desc\.?|item|name|line( item)?|detail)$/i],
  ['amount', /^(amount|amt\.?|qty\.?|quantity|number of units|count)$/i],
  ['unit', /^(units?|unit type|per|uom)$/i],
  ['multiplier', /^(x|mult\.?|multiplier|times|factor)$/i],
  ['rate', /^(rate|price|unit cost|cost)$/i],
  ['subtotal', /^(subtotal|sub total|sub-total|total|estimate|estimated|est\.?|budget|amount \$)$/i],
  ['fringeNames', /^(fringes?( names)?|fringe codes?)$/i],
  ['fringeAmount', /^(fringes? ?\$|fringe amount|fringe total|fringes ?\(\$\))$/i],
  ['category', /^(category|cat\.?|dept\.?|department|group)$/i],
  ['notes', /^(notes?|comments?|memo)$/i],
];

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
};
const str = (v: any) => (v === null || v === undefined) ? '' : String(v).trim();

const sectionOf = (n: string) => { const x = parseInt(n, 10); return x < 2000 ? 'ATL' : x < 4000 ? 'PRODUCTION' : x < 5000 ? 'POST' : 'OTHER'; };

function findHeader(rows: any[][]): { row: number; columns: Partial<Record<Col, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cols: Partial<Record<Col, number>> = {};
    rows[r].forEach((cell, c) => {
      const h = str(cell);
      if (!h) return;
      for (const [col, re] of HEADERS) if (re.test(h) && cols[col] === undefined) { cols[col] = c; break; }
    });
    // "Units" is ambiguous: MMB uses Amount + Units (unit type); some sheets use Units as the count.
    if (cols.unit !== undefined && cols.amount === undefined) {
      const sample = rows.slice(r + 1, r + 40).map(x => x[cols.unit!]).filter(v => v !== '' && v !== undefined);
      const numeric = sample.filter(v => num(v) !== null).length;
      if (sample.length && numeric / sample.length > 0.8) { cols.amount = cols.unit; delete cols.unit; }
    }
    // "Fringes" can be names (Shamel) or dollars (Movie Magic): look at the values
    if (cols.fringeNames !== undefined && cols.fringeAmount === undefined) {
      const sample = rows.slice(r + 1, r + 60).map(x => x[cols.fringeNames!]).filter(v => v !== '' && v !== undefined);
      const numeric = sample.filter(v => num(v) !== null).length;
      if (sample.length && numeric / sample.length > 0.8) { cols.fringeAmount = cols.fringeNames; delete cols.fringeNames; }
    }
    const score = ['account', 'description', 'amount', 'rate', 'subtotal'].filter(k => cols[k as Col] !== undefined).length;
    if (cols.description !== undefined && score >= 3) return { row: r, columns: cols };
  }
  return null;
}

export function parseGenericRows(rows: any[][], opts: { name?: string; sheet?: string; standard?: { categories: Category[]; accounts: Account[] } } = {}): GenericImport {
  const hdr = findHeader(rows);
  if (!hdr) throw new Error('Could not find a header row with Account / Description / Amount / Rate / Total columns. Export the budget with column headers, or open an issue with the file attached.');
  const C = hdr.columns;
  const cell = (r: any[], k: Col) => C[k] === undefined ? undefined : r[C[k]!];
  const warnings: string[] = [];
  const stdCat = new Map((opts.standard?.categories ?? []).map(c => [c.number, c.name]));
  const stdAcc = new Map((opts.standard?.accounts ?? []).map(a => [a.number, a.name]));

  const categories = new Map<string, Category>();
  const accounts = new Map<string, Account>();
  const fringes: FringeDef[] = CA_FRINGES_2026.map(f => ({ ...f }));
  const knownFringe = new Set(fringes.map(f => f.id));
  const synthetic = new Map<number, string>(); // rate → fringe id
  const lines: LineItem[] = [];
  let reportedTotal = 0;

  const ensureCategory = (n: string, name?: string) => {
    if (!categories.has(n)) categories.set(n, { number: n, name: name || stdCat.get(n) || `Category ${n}`, section: sectionOf(n) as Category['section'] });
    else if (name && /^Category /.test(categories.get(n)!.name)) categories.get(n)!.name = name;
  };
  const ensureAccount = (n: string, name?: string, cat?: string) => {
    const categoryNumber = cat || (n.length >= 4 ? n.slice(0, n.length - 2) + '00' : n);
    ensureCategory(categoryNumber);
    if (!accounts.has(n)) accounts.set(n, { number: n, name: name || stdAcc.get(n) || `Account ${n}`, categoryNumber });
    else if (name && /^Account /.test(accounts.get(n)!.name)) accounts.get(n)!.name = name;
  };

  let lastAccount = '';
  let lastCategory = '';
  for (let r = hdr.row + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(v => str(v) === '')) continue;
    const acctRaw = str(cell(row, 'account'));
    const desc = str(cell(row, 'description'));
    const amount = num(cell(row, 'amount'));
    const rate = num(cell(row, 'rate'));
    const mult = num(cell(row, 'multiplier'));
    const sub = num(cell(row, 'subtotal'));
    const unit = str(cell(row, 'unit')).toUpperCase();
    const catCol = str(cell(row, 'category'));
    const hasMoney = (amount !== null && rate !== null) || (sub !== null && sub !== 0);

    if (/^(grand )?total/i.test(desc) && !acctRaw) continue;                    // total rows
    if (/^(sub ?total|contingency)/i.test(desc) && !hasMoney) continue;

    // account / category header rows: a number and a name, no money
    const acctNum = acctRaw.replace(/[^\w.-]/g, '');
    if (acctNum && !hasMoney) {
      if (/^\d{2,}00$/.test(acctNum) || catCol.toLowerCase() === desc.toLowerCase()) { ensureCategory(acctNum, desc || undefined); lastCategory = acctNum; }
      else { ensureAccount(acctNum, desc || undefined, lastCategory && acctNum.startsWith(lastCategory.slice(0, 2)) ? lastCategory : undefined); lastAccount = acctNum; }
      continue;
    }
    if (!hasMoney && !desc) continue;
    if (!hasMoney) { // description-only row: treat as an account header if it looks like one, else skip
      continue;
    }

    // a detail line
    let accountId = acctNum || lastAccount;
    if (acctNum && acctNum !== lastAccount) { lastAccount = acctNum; }
    if (!accountId) { accountId = '9999'; warnings.push(`Row ${r + 1}: no account number; filed under 9999 UNASSIGNED`); }
    ensureAccount(accountId, undefined, catCol && /^\d+$/.test(catCol) ? catCol : undefined);
    if (accountId === '9999') accounts.get('9999')!.name = 'UNASSIGNED';

    let a = amount ?? 1, rt = rate ?? 0, m = mult ?? 1;
    if (rate === null && sub !== null) { a = amount ?? 1; rt = a ? round2(sub / a / (m || 1)) : sub; if (!a) { a = 1; rt = sub; } }
    if (sub !== null && a * rt * m !== 0) {
      const calc = a * rt * m;
      if (Math.abs(calc - sub) > 0.05 && mult === null && a * rt !== 0) m = round2(sub / (a * rt) * 1000) / 1000; // implied multiplier (e.g. hours)
    }
    if (sub !== null) reportedTotal += sub;

    let fr = str(cell(row, 'fringeNames')).split(/[,;]/).map(s => s.trim()).filter(Boolean);
    for (const f of fr) if (!knownFringe.has(f)) { knownFringe.add(f); fringes.push({ id: f, name: f, rate: 0, cap: null }); warnings.push(`Fringe "${f}" added at 0 %; set its rate in the Fringes panel`); }
    const frAmt = num(cell(row, 'fringeAmount'));
    const wages = round2(a * rt * m);
    if (!fr.length && frAmt && wages > 0) {
      const pct = Math.round(frAmt / wages * 10000) / 10000;
      let id = synthetic.get(pct);
      if (!id) { id = `IMPORTED ${(pct * 100).toFixed(2)}%`; synthetic.set(pct, id); fringes.push({ id, name: `Imported fringe ${(pct * 100).toFixed(2)} %`, rate: pct, cap: null }); }
      fr = [id];
    }

    lines.push({
      id: `L${lines.length + 1}`, accountId, description: desc, amount: a, unit: unit || (amount !== null && rate !== null ? 'ITEM' : '-'),
      rate: rt, multiplier: m, fringes: fr, tags: [], payType: 'cash', notes: str(cell(row, 'notes')) || undefined,
    });
  }
  if (!lines.length) throw new Error('Found the header row but no budget lines under it.');
  const uniq = [...new Set(warnings)];
  const sortNum = (a: { number: string }, b: { number: string }) => a.number.localeCompare(b.number, undefined, { numeric: true });
  return {
    name: opts.name || 'Imported budget', sheet: opts.sheet || '', columns: C,
    categories: [...categories.values()].sort(sortNum), accounts: [...accounts.values()].sort(sortNum),
    fringes, lines, warnings: uniq, reportedTotal: round2(reportedTotal),
  };
}

/** Pick the sheet that looks most like a detail list and parse it. Accepts .xlsx/.xls/.csv/.txt (tab or comma). */
export function parseGenericBudget(buf: ArrayBuffer, filename = '', standard?: { categories: Category[]; accounts: Account[] }): GenericImport {
  const isText = /\.(csv|txt|tsv)$/i.test(filename);
  const wb = isText ? XLSX.read(new TextDecoder().decode(buf), { type: 'string', raw: true }) : XLSX.read(new Uint8Array(buf), { type: 'array' });
  let best: GenericImport | null = null; let firstErr: Error | null = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: '', raw: true });
    try {
      const imp = parseGenericRows(rows, { name: filename.replace(/\.[^.]+$/, ''), sheet: name, standard });
      if (!best || imp.lines.length > best.lines.length) best = imp;
    } catch (e: any) { firstErr ??= e; }
  }
  if (!best) throw firstErr ?? new Error('No sheet with budget lines');
  return best;
}
