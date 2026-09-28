import * as XLSX from 'xlsx';
import type { Account, Category, FringeDef, LineItem, Section } from '../types';

/** Import a Shamel Studio budget export (.xlsx with Budget Metadata / TopSheet / Accounts / Details sheets).
 *  Shamel does not export fringe *definitions*, only the names applied to each line, so we ship a
 *  California 2026 set fitted to Shamel's own math and add unknown names at 0 % for you to fill in. */

export const CA_FRINGES_2026: FringeDef[] = [
  { id: 'FICA1', name: 'FICA1 (Social Security)', rate: 0.062, cap: null },
  { id: 'FICA2', name: 'FICA2 (Medicare)', rate: 0.0145, cap: null },
  { id: 'FUI', name: 'FUI', rate: 0.006, cap: 7000 },
  { id: 'SUI (CA)', name: 'SUI (CA)', rate: 0.062, cap: 7000 },
  { id: 'WC (CA)', name: 'Workers Comp (CA)', rate: 0.0448, cap: null },
  { id: 'PAYROLL FEE', name: 'Payroll service fee', rate: 0.0175, cap: null },
  { id: 'SAG AFTRA', name: 'SAG-AFTRA P&H (principals)', rate: 0.21, cap: null },
  { id: 'SAG AFTRA BG', name: 'SAG-AFTRA P&H (background)', rate: 0.2075, cap: null },
  { id: 'PAYROLL FEE SAG BG', name: 'Payroll fee (SAG background)', rate: 0.0175, cap: null },
];

export interface ShamelImport {
  name: string; version: string; shootDays: number;
  categories: Category[]; accounts: Account[]; fringes: FringeDef[]; lines: LineItem[];
  reported: { grandTotal?: number; contingency?: number };
}

const sectionOf = (num: string): Section => {
  const n = parseInt(num, 10);
  return n < 2000 ? 'ATL' : n < 4000 ? 'PRODUCTION' : n < 5000 ? 'POST' : 'OTHER';
};

export function parseShamelXlsx(buf: ArrayBuffer): ShamelImport {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const need = ['TopSheet', 'Accounts', 'Details'];
  for (const n of need) if (!wb.Sheets[n]) throw new Error(`Missing sheet "${n}" – is this a Shamel Studio budget export?`);
  const rows = (name: string) => XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: '' });

  const meta: Record<string, any> = {};
  if (wb.Sheets['Budget Metadata']) for (const r of rows('Budget Metadata')) if (r[0]) meta[String(r[0])] = r[1];

  const categories: Category[] = [];
  let reportedGrand: number | undefined, reportedCont: number | undefined;
  for (const r of rows('TopSheet').slice(1)) {
    const num = String(r[0] ?? '').trim();
    if (num) categories.push({ number: num, name: String(r[1]), section: sectionOf(num) });
    else if (/contingency/i.test(String(r[1]))) reportedCont = Number(r[4]) || Number(r[2]);
    else if (/grand total/i.test(String(r[1]))) reportedGrand = Number(r[4]);
  }
  const accounts: Account[] = rows('Accounts').slice(1)
    .filter(r => String(r[0]).trim())
    .map(r => ({ number: String(r[0]).trim(), name: String(r[1]), categoryNumber: String(r[0]).trim().slice(0, 2) + '00' }));

  const fringes = CA_FRINGES_2026.map(f => ({ ...f }));
  const known = new Set(fringes.map(f => f.id));
  const lines: LineItem[] = [];
  rows('Details').slice(1).forEach((r, i) => {
    const acct = String(r[0] ?? '').trim();
    if (!acct) return;
    const fr = String(r[3] ?? '').split(',').map(s => s.trim()).filter(Boolean);
    for (const f of fr) if (!known.has(f)) { known.add(f); fringes.push({ id: f, name: f, rate: 0, cap: null }); }
    lines.push({
      id: `L${i + 1}`, accountId: acct, description: String(r[1] ?? ''),
      amount: Number(r[5]) || 0, unit: String(r[6] || '-'), rate: Number(r[7]) || 0, multiplier: Number(r[9]) || 1,
      fringes: fr, tags: String(r[4] ?? '').split(',').map(s => s.trim()).filter(Boolean),
      payType: 'cash', notes: String(r[15] ?? ''),
    });
  });
  return {
    name: String(meta['Project Name'] ?? 'Untitled'), version: String(meta['Budget Name'] ?? ''),
    shootDays: Number(meta['Location Shoot Days']) || 0,
    categories, accounts, fringes, lines, reported: { grandTotal: reportedGrand, contingency: reportedCont },
  };
}
