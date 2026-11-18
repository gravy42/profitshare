import type { Account, Category, FringeDef, LineItem } from '../types';
import { parseShamelXlsx } from './shamelXlsx';
import { parseGenericBudget } from './genericBudget';
import { readSpreadsheet, sheetNamed } from './spreadsheet';

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
  const wb = readSpreadsheet(buf, filename);
  if (['TopSheet', 'Accounts', 'Details'].every(n => sheetNamed(wb, n) !== undefined)) {
    const s = parseShamelXlsx(wb);
    return { source: 'shamel', name: s.name, version: s.version, shootDays: s.shootDays, categories: s.categories, accounts: s.accounts,
      fringes: s.fringes, lines: s.lines, reportedTotal: s.reported.grandTotal, warnings: [] };
  }
  const g = parseGenericBudget(wb, filename, standard);
  return { source: 'generic', name: g.name, version: '', shootDays: 0, categories: g.categories, accounts: g.accounts,
    fringes: g.fringes, lines: g.lines, reportedTotal: g.reportedTotal, warnings: g.warnings };
}
