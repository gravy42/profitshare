import * as XLSX from 'xlsx';
import type { Account, Category, FringeDef, LineItem } from '../types';
import { parseShamelXlsx } from './shamelXlsx';
import { parseGenericBudget } from './genericBudget';

export interface BudgetImport {
  source: 'shamel' | 'generic';
  name: string; version: string; shootDays: number;
  categories: Category[]; accounts: Account[]; fringes: FringeDef[]; lines: LineItem[];
  reportedTotal?: number;
  warnings: string[];
}

/** Sniff the file: a Shamel Studio export has TopSheet / Accounts / Details sheets; anything else goes through
 *  the generic header-matching importer (Movie Magic Budgeting Excel/CSV exports, hand-made sheets). */
export function parseBudgetFile(buf: ArrayBuffer, filename: string, standard?: { categories: Category[]; accounts: Account[] }): BudgetImport {
  if (/\.xlsx?$/i.test(filename)) {
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', bookSheets: true });
    if (['TopSheet', 'Accounts', 'Details'].every(n => wb.SheetNames.includes(n))) {
      const s = parseShamelXlsx(buf);
      return { source: 'shamel', name: s.name, version: s.version, shootDays: s.shootDays, categories: s.categories, accounts: s.accounts,
        fringes: s.fringes, lines: s.lines, reportedTotal: s.reported.grandTotal, warnings: [] };
    }
  }
  const g = parseGenericBudget(buf, filename, standard);
  return { source: 'generic', name: g.name, version: '', shootDays: 0, categories: g.categories, accounts: g.accounts,
    fringes: g.fringes, lines: g.lines, reportedTotal: g.reportedTotal, warnings: g.warnings };
}
