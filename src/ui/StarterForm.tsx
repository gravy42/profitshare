import type { ReactNode } from 'react';
import type { SagTierId } from '../engine/types';
import { SAG_TIERS } from '../engine/sag';
import { money } from './format';

export interface StarterSettings { tier: SagTierId; rates: 'scale' | 'ballpark'; pagesPerDay: number; crew: 'lean' | 'full'; dayHours: 10 | 12 }

/** The five choices behind a starter budget, shared by the Start tab's card and the "draw a budget from the board" paths. */
export function StarterForm({ starter, setStarter, pages = true, dayLength = true, children }: { starter: StarterSettings; setStarter: (s: StarterSettings) => void; pages?: boolean; dayLength?: boolean; children?: ReactNode }) {
  return (
    <>
      <div className="row starterform">
        <div className="ctl"><label>SAG tier</label>
          <select value={starter.tier} onChange={e => setStarter({ ...starter, tier: e.target.value as SagTierId, crew: e.target.value === 'ULB' || e.target.value === 'MLB' ? 'lean' : 'full' })}>{SAG_TIERS.map(t => <option key={t.id} value={t.id}>{t.name}{t.cap ? ` (to ${money(t.cap)})` : ''}</option>)}</select></div>
        {pages && <div className="ctl"><label>Pages / day</label><input type="number" min={1} max={12} step={0.5} value={starter.pagesPerDay} onChange={e => setStarter({ ...starter, pagesPerDay: +e.target.value || 5 })} style={{ width: 70 }} /></div>}
        {dayLength && <div className="ctl"><label>Day</label>
          <select value={starter.dayHours} onChange={e => setStarter({ ...starter, dayHours: +e.target.value as 10 | 12 })}><option value={10}>10 hours</option><option value={12}>12 hours</option></select></div>}
        <div className="ctl"><label>Crew rates</label>
          <select value={starter.rates} onChange={e => setStarter({ ...starter, rates: e.target.value as 'scale' | 'ballpark' })}><option value="ballpark">Ballpark LA non-union (heads and keys above crew)</option><option value="scale">Everyone at the tier's scale (the Sing Sing baseline)</option></select></div>
        <div className="ctl"><label>Crew</label>
          <select value={starter.crew} onChange={e => setStarter({ ...starter, crew: e.target.value as 'lean' | 'full' })}><option value="lean">Lean (about 32)</option><option value="full">Full (about 45)</option></select></div>
      </div>
      {children}
    </>
  );
}
