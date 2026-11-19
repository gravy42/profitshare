// @vitest-environment jsdom
// Producer fees, the script purchase and star allowances are paid the way the Deal tab says. The budget tab used to
// offer a Pay menu on those lines that flipped back to the deal's choice as soon as it was used. Now the pay is shown
// as fixed, with a button that goes to the Deal tab control that sets it; every other line keeps its menu.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { sampleDemo } from '../data/seed';
import { applyDeal, dealControlledIds, premiumGroupOf, withDeal } from '../engine/deal';
import { topSheet } from '../engine/budget';
import type { LineItem, Project } from '../engine/types';
import { TopSheetView } from './TopSheetView';
import { DealView } from './DealView';

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

const line = (id: string, accountId: string, description: string): LineItem =>
  ({ id, accountId, description, amount: 1, unit: 'FLAT', multiplier: 1, rate: 10000, payType: 'cash', fringes: [], tags: [] });
/** The sample film with one line of each kind the Deal tab sets the pay for, and one ordinary line beside them. */
function film(): Project {
  const p = withDeal(sampleDemo());
  return { ...p, lines: [...p.lines, line('t_fee', '1201', 'Fee'), line('t_script', '1102', 'Script purchase'), line('t_star', '1401', 'STAR ALLOWANCE'), line('t_plain', '1201', 'Assistant to the producer')] };
}
function draw(raw: Project, onDealPay?: (g: string) => void, setProject: (f: (p: Project) => Project) => void = () => {}) {
  const eff = applyDeal(raw);
  const box = document.createElement('div'); document.body.appendChild(box);
  const root = createRoot(box);
  act(() => { root.render(<TopSheetView project={eff} raw={raw} controlled={dealControlledIds(raw, eff)} setProject={setProject} onDealPay={onDealPay} />); });
  // typing in the filter opens every account that has a matching line
  const filter = box.querySelector<HTMLInputElement>('input[placeholder="filter lines…"]')!;
  const type = (v: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(filter, v);
    filter.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const row = (description: string) => {
    type(description);
    const input = [...box.querySelectorAll<HTMLInputElement>('tr.line input.l')].find(i => i.value === description);
    if (!input) throw new Error(`no line called ${description}`);
    return input.closest('tr')!;
  };
  return { box, row, done: () => { act(() => root.unmount()); box.remove(); } };
}

describe('pay on lines the Deal tab sets', () => {
  it('knows which lines those are', () => {
    expect(premiumGroupOf(line('a', '1201', 'Fee'))).toBe('producers');
    expect(premiumGroupOf(line('a', '1102', 'Script Purchase'))).toBe('script');
    expect(premiumGroupOf(line('a', '1401', 'Cast Allowance'))).toBe('allowances');
    expect(premiumGroupOf(line('a', '1201', 'Assistant to the producer'))).toBeNull();
  });

  it('shows the pay as fixed with a button to the Deal tab, and leaves other lines their menu', () => {
    const went: string[] = [];
    const v = draw(film(), g => went.push(g));
    for (const [name, group] of [['Fee', 'producers'], ['Script purchase', 'script'], ['STAR ALLOWANCE', 'allowances']] as const) {
      const tr = v.row(name);
      expect(tr.querySelector('select.tag'), `${name}: no pay menu`).toBeNull();
      expect(tr.querySelector('.dealpay .tag')!.textContent).toBe('up front');
      const go = tr.querySelector<HTMLButtonElement>('.dealpay button')!;
      expect(go.textContent).toBe('Set on the Deal tab');
      act(() => go.click());
      expect(went[went.length - 1]).toBe(group);
    }
    expect(v.row('Assistant to the producer').querySelector('select.tag')).not.toBeNull();
    v.done();
  });

  it('shows what the deal chose, not what the line holds', () => {
    const raw = film();
    const v = draw({ ...raw, deal: { ...raw.deal!, pay: { ...raw.deal!.pay, premiums: { ...raw.deal!.pay.premiums, producers: 'points' } } } });
    expect(v.row('Fee').querySelector('.dealpay .tag')!.textContent).toBe('points');
    expect(v.row('Script purchase').querySelector('.dealpay .tag')!.textContent).toBe('up front');
    v.done();
  });

  it('the button lands on a control the Deal tab really has', () => {
    const raw = film(), eff = applyDeal(raw);
    const box = document.createElement('div'); document.body.appendChild(box);
    const root = createRoot(box);
    act(() => { root.render(<DealView raw={raw} eff={eff} setProject={() => {}} />); });
    for (const g of ['producers', 'script', 'allowances']) expect(box.querySelector(`select#deal-pay-${g}`), g).not.toBeNull();
    act(() => root.unmount()); box.remove();
  });

  it('does not move any money: a pay choice stored on such a line never counted, and still does not', () => {
    const raw = film();
    const stale = { ...raw, lines: raw.lines.map(l => l.id === 't_fee' ? { ...l, payType: 'deferred' as const } : l) };
    expect(topSheet(applyDeal(stale))).toEqual(topSheet(applyDeal(raw)));
  });
});
