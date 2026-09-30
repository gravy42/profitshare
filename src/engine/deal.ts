// The deal layer. The budget you import or type is the raw budget and is never rewritten by the deal.
// The deal is a set of terms the user can change at any time; applyDeal() computes the effective
// budget from raw lines + terms, and every view reads the effective one. Change a term, everything updates.
import type { Deal, Participant, Project, SagTierId } from './types';
import { PAID_HOURS, setDayHours } from './budget';
import { everyoneAtScale, floorNonShootDays, rerateCast, sagTier } from './sag';
import type { LineItem, PremiumGroup } from './types';

/** The above-scale above-the-line money, in three groups, so a deal can treat each one differently. */
export const PRESET_GROUPS: Record<PremiumGroup, { label: string; match: (l: LineItem) => boolean }> = {
  producers: { label: 'Producer fees (1201 Fee lines)', match: l => l.accountId === '1201' && /^Fee$/i.test(l.description) },
  script: { label: 'Script purchase (1102)', match: l => l.accountId === '1102' && /script purchase/i.test(l.description) },
  allowances: { label: 'STAR / CAST ALLOWANCE lines (above-scale cast money)', match: l => /^(STAR|CAST) ALLOWANCE$/i.test(l.description) },
};
export type PresetGroup = PremiumGroup;
export const PROFIT_SHARE_PRESET_MATCH = (l: LineItem) => Object.values(PRESET_GROUPS).some(g => g.match(l));

export function defaultDeal(p: { shootDays: number; sag: { targetTier: SagTierId } }): Deal {
  return {
    pay: { model: 'as-budgeted', rerateCast: false, crewBasis: p.sag.targetTier, crewCustomRate: 400,
      premiums: { producers: 'cash', script: 'cash', allowances: 'cash' } },
    producers: { count: null, days: p.shootDays + 40 },
    nonShoot: { enabled: false, cashHourly: 16.9, rest: 'points' },
  };
}

/** Fill in terms a project saved before the deal layer existed. Safe to call on any project. */
export function withDeal(p: Project): Project {
  const d = defaultDeal(p);
  const deal: Deal = p.deal ? {
    pay: { ...d.pay, ...p.deal.pay, premiums: { ...d.pay.premiums, ...(p.deal.pay?.premiums ?? {}) } },
    producers: { ...d.producers, ...p.deal.producers },
    nonShoot: { ...d.nonShoot, ...p.deal.nonShoot },
  } : d;
  return { ...p, deal, dayHours: p.dayHours ?? 12 };
}

export const crewDayRateOf = (p: Project): number => {
  const d = withDeal(p).deal!;
  return d.pay.crewBasis === 'custom' ? d.pay.crewCustomRate : sagTier(d.pay.crewBasis).dayRate;
};

/** The effective project: raw lines with the deal terms applied, in this order:
 *  day length → producer headcount → pay model (scale for everyone, or re-rated cast) → premiums → non-shoot floor. */
export function applyDeal(raw: Project): Project {
  const p0 = withDeal(raw);
  const d = p0.deal!;
  // 1. day length: raw multipliers are read as 12-hour-day hours (14 / 18 / 15); map them to the chosen day
  let p: Project = setDayHours({ ...p0, dayHours: 12 }, p0.dayHours ?? 12);

  // 2. producers: how many get a wage line at scale, and for how many days
  if (d.pay.model === 'everyone-at-scale') {
    const producers = p.participants.filter(x => x.group === 'producer' && x.id.startsWith('p_producer'));
    const others = p.participants.filter(x => !(x.group === 'producer' && x.id.startsWith('p_producer')));
    const want = d.producers.count ?? producers.length;
    // each producer keeps their own days (editable on the points schedule); the deal's figure is the default for new ones
    const kept: Participant[] = producers.slice(0, want).map(x => ({ ...x, days: x.days || d.producers.days }));
    for (let i = producers.length; i < want; i++) kept.push({ id: `p_producer_${i + 1}`, name: `Producer #${i + 1}`, role: 'Producer', group: 'producer', tierId: 'producer', days: d.producers.days, bonusMultiplier: 1 });
    p = { ...p, participants: [...others, ...kept] };
  }

  // 3. pay model
  if (d.pay.model === 'everyone-at-scale') {
    p = everyoneAtScale(p, p.sag.targetTier, { premiums: 'keep', producerDays: d.producers.days, crewDayRate: crewDayRateOf(p) });
  } else if (d.pay.rerateCast) {
    p = rerateCast(p, p.sag.targetTier);
  }

  // 4. premiums: producer fees, script purchase, star / cast allowances
  const groups = Object.keys(PRESET_GROUPS) as PremiumGroup[];
  p = { ...p, lines: p.lines.flatMap(l => {
    const g = groups.find(k => PRESET_GROUPS[k].match(l));
    if (!g) return [l];
    const c = d.pay.premiums[g];
    return c === 'delete' ? [] : [{ ...l, payType: c }];
  }) };

  // 5. prep / wrap / post days at a cash floor
  if (d.nonShoot.enabled) p = floorNonShootDays(p, { cashHourly: d.nonShoot.cashHourly, rest: d.nonShoot.rest });

  return p;
}

/** Which raw line ids the deal rewrites (rate or pay type differs from raw), so the top sheet can show them as set by the deal. */
export function dealControlledIds(raw: Project, effective: Project): Set<string> {
  const rawById = new Map(raw.lines.map(l => [l.id, l]));
  const out = new Set<string>();
  for (const l of effective.lines) {
    const r = rawById.get(l.id);
    if (!r) { out.add(l.id); continue; }
    if (r.rate !== l.rate || r.payType !== l.payType || r.multiplier !== l.multiplier || r.amount !== l.amount) out.add(l.id);
  }
  return out;
}

export const paidHoursNow = (p: Project) => PAID_HOURS[withDeal(p).dayHours ?? 12];
