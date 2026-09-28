import type { Account, Category, FringeDef, LineItem, PayType, Project, Section } from './types';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Wages before fringes for a line. amount × rate × multiplier. */
export function lineSubtotal(l: LineItem): number {
  return round2(l.amount * l.rate * l.multiplier);
}

/** Fringes for a line. Each fringe applies its rate to the wages, capped per line at its wage base. */
export function lineFringes(l: LineItem, fringes: FringeDef[]): number {
  const wages = lineSubtotal(l);
  if (wages <= 0 || l.fringes.length === 0) return 0;
  const byId = new Map(fringes.map(f => [f.id, f]));
  let total = 0;
  for (const id of l.fringes) {
    const f = byId.get(id);
    if (!f) continue;
    const base = f.cap ? Math.min(wages, f.cap) : wages;
    total += base * f.rate;
  }
  return round2(total);
}

export function lineTotal(l: LineItem, fringes: FringeDef[]): number {
  return round2(lineSubtotal(l) + lineFringes(l, fringes));
}

/** Money grouped by how it gets paid. */
export interface Rollup {
  cash: number;            // wages/costs paid from the production account
  cashFringes: number;
  deferred: number;        // fixed IOUs paid from first proceeds
  deferredFringes: number;
  points: number;          // cash value of what was converted to points (informational)
}
export const emptyRollup = (): Rollup => ({ cash: 0, cashFringes: 0, deferred: 0, deferredFringes: 0, points: 0 });
export const rollupCashTotal = (r: Rollup) => r.cash + r.cashFringes;
export const rollupTotal = (r: Rollup) => r.cash + r.cashFringes + r.deferred + r.deferredFringes;

function accumulate(r: Rollup, l: LineItem, fringes: FringeDef[]) {
  const sub = lineSubtotal(l);
  const fr = lineFringes(l, fringes);
  if (l.payType === 'points') { r.points += sub; return; }
  if (l.payType === 'deferred') { r.deferred += sub; r.deferredFringes += fr; }
  else { r.cash += sub; r.cashFringes += fr; }
}
function addRollup(a: Rollup, b: Rollup) {
  a.cash += b.cash; a.cashFringes += b.cashFringes; a.deferred += b.deferred;
  a.deferredFringes += b.deferredFringes; a.points += b.points;
}

export interface AccountRollup extends Rollup { account: Account }
export interface CategoryRollup extends Rollup { category: Category; accounts: AccountRollup[] }
export interface SectionRollup extends Rollup { section: Section; categories: CategoryRollup[] }

export interface TopSheet {
  sections: SectionRollup[];
  aboveTheLine: Rollup;
  belowTheLine: Rollup;
  subtotal: Rollup;             // everything before contingency
  contingency: number;          // pct of the cash budget (cash + its fringes)
  cashBudget: number;           // cash + cash fringes + contingency  ← what you have to raise
  deferredTotal: number;        // deferred + its fringes
  totalProductionCost: number;  // cashBudget + deferredTotal  ← what SAG measures
  pointsValue: number;
}

export function topSheet(p: Project): TopSheet {
  const accById = new Map(p.accounts.map(a => [a.number, a]));
  const accRoll = new Map<string, AccountRollup>();
  for (const l of p.lines) {
    const acc = accById.get(l.accountId);
    if (!acc) continue;
    let r = accRoll.get(acc.number);
    if (!r) { r = { ...emptyRollup(), account: acc }; accRoll.set(acc.number, r); }
    accumulate(r, l, p.fringes);
  }
  const catRoll = new Map<string, CategoryRollup>();
  for (const c of p.categories) catRoll.set(c.number, { ...emptyRollup(), category: c, accounts: [] });
  for (const a of accRoll.values()) {
    const c = catRoll.get(a.account.categoryNumber) ?? catRoll.get(a.account.number.slice(0, 2) + '00');
    if (!c) continue;
    c.accounts.push(a);
    addRollup(c, a);
  }
  for (const c of catRoll.values()) c.accounts.sort((x, y) => x.account.number.localeCompare(y.account.number));
  const order: Section[] = ['ATL', 'PRODUCTION', 'POST', 'OTHER'];
  const sections: SectionRollup[] = order.map(section => {
    const cats = [...catRoll.values()].filter(c => c.category.section === section);
    const s: SectionRollup = { ...emptyRollup(), section, categories: cats };
    for (const c of cats) addRollup(s, c);
    return s;
  });
  const atl = sections[0];
  const btl = emptyRollup(); sections.slice(1).forEach(s => addRollup(btl, s));
  const subtotal = emptyRollup(); sections.forEach(s => addRollup(subtotal, s));
  const contingency = round2(rollupCashTotal(subtotal) * p.contingencyPct / 100);
  const cashBudget = round2(rollupCashTotal(subtotal) + contingency);
  const deferredTotal = round2(subtotal.deferred + subtotal.deferredFringes);
  return {
    sections, aboveTheLine: atl, belowTheLine: btl, subtotal, contingency, cashBudget, deferredTotal,
    totalProductionCost: round2(cashBudget + deferredTotal), pointsValue: round2(subtotal.points),
  };
}

/** Days a line represents for points purposes. Weeks count as 5 days. */
export function lineDays(l: LineItem): number {
  if (l.unit === 'DAY') return l.amount;
  if (l.unit === 'WEEK') return l.amount * 5;
  return 0;
}

export function setPayType(p: Project, lineId: string, payType: PayType): Project {
  return { ...p, lines: p.lines.map(l => l.id === lineId ? { ...l, payType } : l) };
}

export function updateLine(p: Project, lineId: string, patch: Partial<LineItem>): Project {
  return { ...p, lines: p.lines.map(l => l.id === lineId ? { ...l, ...patch } : l) };
}

let counter = 0;
export const newId = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

// ---------- editing ----------

const SECTION_OF = (num: string): Section => {
  const n = parseInt(num, 10);
  return n < 2000 ? 'ATL' : n < 4000 ? 'PRODUCTION' : n < 5000 ? 'POST' : 'OTHER';
};
export const sectionForNumber = SECTION_OF;

export function addLine(p: Project, accountId: string, patch: Partial<LineItem> = {}): { project: Project; line: LineItem } {
  const line: LineItem = {
    id: newId('L'), accountId, description: '', amount: 1, unit: '-', rate: 0, multiplier: 1,
    fringes: [], tags: [], payType: 'cash', ...patch,
  };
  // keep lines grouped by account: insert after the last line of this account
  let at = -1;
  p.lines.forEach((l, i) => { if (l.accountId === accountId) at = i; });
  const lines = [...p.lines];
  lines.splice(at + 1, 0, line);
  return { project: { ...p, lines }, line };
}

export function removeLine(p: Project, lineId: string): Project {
  return { ...p, lines: p.lines.filter(l => l.id !== lineId) };
}

export function addCategory(p: Project, number: string, name: string, section?: Section): Project {
  number = number.trim();
  if (!number || p.categories.some(c => c.number === number)) return p;
  const categories = [...p.categories, { number, name: name.trim() || `Category ${number}`, section: section ?? SECTION_OF(number) }]
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  return { ...p, categories };
}

export function addAccount(p: Project, categoryNumber: string, number: string, name: string): Project {
  number = number.trim();
  if (!number || p.accounts.some(a => a.number === number)) return p;
  const accounts = [...p.accounts, { number, name: name.trim() || `Account ${number}`, categoryNumber }]
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  return { ...p, accounts };
}

export function renameAccount(p: Project, number: string, name: string): Project {
  return { ...p, accounts: p.accounts.map(a => a.number === number ? { ...a, name } : a) };
}
export function renameCategory(p: Project, number: string, name: string): Project {
  return { ...p, categories: p.categories.map(c => c.number === number ? { ...c, name } : c) };
}

/** Remove an account and every line in it. */
export function removeAccount(p: Project, number: string): Project {
  return { ...p, accounts: p.accounts.filter(a => a.number !== number), lines: p.lines.filter(l => l.accountId !== number) };
}
/** Remove a category with all its accounts and lines. */
export function removeCategory(p: Project, number: string): Project {
  const gone = new Set(p.accounts.filter(a => a.categoryNumber === number).map(a => a.number));
  return {
    ...p, categories: p.categories.filter(c => c.number !== number),
    accounts: p.accounts.filter(a => a.categoryNumber !== number), lines: p.lines.filter(l => !gone.has(l.accountId)),
  };
}

export function upsertFringe(p: Project, f: FringeDef): Project {
  const i = p.fringes.findIndex(x => x.id === f.id);
  const fringes = [...p.fringes];
  if (i >= 0) fringes[i] = f; else fringes.push(f);
  return { ...p, fringes };
}
/** Remove a fringe definition and un-apply it from every line. */
export function removeFringe(p: Project, id: string): Project {
  return { ...p, fringes: p.fringes.filter(f => f.id !== id), lines: p.lines.map(l => l.fringes.includes(id) ? { ...l, fringes: l.fringes.filter(x => x !== id) } : l) };
}
export function toggleLineFringe(p: Project, lineId: string, fringeId: string): Project {
  return { ...p, lines: p.lines.map(l => l.id !== lineId ? l : { ...l, fringes: l.fringes.includes(fringeId) ? l.fringes.filter(x => x !== fringeId) : [...l.fringes, fringeId] }) };
}
