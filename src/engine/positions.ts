// Hiring someone in one move: a wage line in the right account (created if the budget doesn't have it) and a
// participant on the points schedule linked to it, so the top sheet, the SAG check and the back end all see them.
import type { Participant, Project } from './types';
import { addAccount, addCategory, addLine, PAID_HOURS, dayHoursOf, newId } from './budget';
import { payrollFringeSet, scaleHourly } from './sag';
import { crewDayRateOf } from './deal';
import { sectionForNumber } from './budget';
import { daysWithCast } from './board';

export interface NewPosition {
  title: string;                 // "Intimacy Coordinator"
  accountId: string;             // an account in the project, or a number from SUGGESTED_ACCOUNTS to create
  days: number;
  hourly?: number;               // 8-hour base hourly; default: the deal's crew rate ÷ 8
  longDay?: boolean;             // paid at the long-day hours (14 on a 12-hour day) instead of the crew day
  group?: Participant['group'];
  payType?: 'cash' | 'deferred' | 'points';
  note?: string;                 // "(skateboarding)"
  followsCastIds?: number[];     // on set whenever any of these cast work; days come from the board
}

/** Accounts a position is likely to want that a Shamel or Movie Magic budget may not carry yet. */
export const SUGGESTED_ACCOUNTS: { number: string; name: string; categoryNumber: string; categoryName: string; match: RegExp }[] = [
  { number: '1501', name: 'STUNT COORDINATOR', categoryNumber: '1500', categoryName: 'STUNTS & INTIMACY', match: /stunt coord/i },
  { number: '1502', name: 'STUNT PERFORMERS', categoryNumber: '1500', categoryName: 'STUNTS & INTIMACY', match: /stunt (perf|double|player)/i },
  { number: '1503', name: 'INTIMACY COORDINATOR', categoryNumber: '1500', categoryName: 'STUNTS & INTIMACY', match: /intima/i },
  { number: '2112', name: 'STUDIO TEACHER', categoryNumber: '2100', categoryName: 'PRODUCTION STAFF', match: /studio teach|welfare|tutor/i },
  { number: '2806', name: 'SET MEDIC', categoryNumber: '2800', categoryName: 'SET OPERATIONS', match: /medic/i },
  { number: '3502', name: 'HEALTH & SAFETY COORDINATOR', categoryNumber: '3500', categoryName: 'HEALTH & SAFETY', match: /safety|covid/i },
  { number: '2107', name: 'SCRIPT SUPERVISOR', categoryNumber: '2100', categoryName: 'PRODUCTION STAFF', match: /script sup/i },
  { number: '2111', name: 'PRODUCTION ASSISTANTS', categoryNumber: '2100', categoryName: 'PRODUCTION STAFF', match: /\bPA\b|production assist/i },
];

/** The account a title most likely belongs in: an existing account whose name matches, else a suggestion. */
export function suggestAccount(p: Project, title: string): { number: string; name: string; exists: boolean } | null {
  const t = title.trim(); if (!t) return null;
  const words = t.toUpperCase().split(/\s+/).filter(w => w.length > 3);
  const hit = p.accounts.find(a => words.length && words.every(w => a.name.toUpperCase().includes(w)))
    ?? p.accounts.find(a => words.some(w => a.name.toUpperCase().includes(w) && !/COORDINATOR|ASSISTANT|SUPERVISOR|MANAGER/.test(w)));
  if (hit) return { number: hit.number, name: hit.name, exists: true };
  const s = SUGGESTED_ACCOUNTS.find(x => x.match.test(t));
  return s ? { number: s.number, name: s.name, exists: p.accounts.some(a => a.number === s.number) } : null;
}

const tierForHourly = (h: number) => (h >= 35 ? 'hod' : h >= 30 ? 'key' : h >= 22 ? 'crew' : 'general');

export function addPosition(p: Project, pos: NewPosition): { project: Project; participant: Participant } {
  let q = p;
  // the account, and its category, if the budget doesn't carry them
  if (!q.accounts.some(a => a.number === pos.accountId)) {
    const s = SUGGESTED_ACCOUNTS.find(x => x.number === pos.accountId);
    const catNo = s?.categoryNumber ?? pos.accountId.slice(0, 2) + '00';
    if (!q.categories.some(c => c.number === catNo)) q = addCategory(q, catNo, s?.categoryName ?? `Category ${catNo}`, sectionForNumber(catNo));
    q = addAccount(q, catNo, pos.accountId, s?.name ?? pos.title.toUpperCase());
  }
  const hours = PAID_HOURS[dayHoursOf(q)];
  const hourly = pos.hourly ?? scaleHourly(crewDayRateOf(q));
  const title = pos.title.trim();
  const id = newId('p');
  const follows = pos.followsCastIds?.filter(id => q.board.castList.some(c => c.id === id));
  const days = follows?.length ? daysWithCast(q.board, follows) : Math.max(0, pos.days);
  const participant: Participant = { id, name: title, role: title, group: pos.group ?? 'crew', tierId: q.tiers.some(t => t.id === tierForHourly(hourly)) ? tierForHourly(hourly) : q.tiers[0]?.id ?? 'crew', days, bonusMultiplier: 1, ...(follows?.length ? { followsCastIds: follows } : {}) };
  const names = follows?.length ? follows.map(id => q.board.castList.find(c => c.id === id)!.name).join(', ') : '';
  const { project } = addLine(q, pos.accountId, {
    description: `${title}${pos.note ? ` ${pos.note}` : ''}${names ? ` (days with ${names})` : ''}`, amount: days, unit: 'DAY', rate: hourly,
    multiplier: pos.longDay ? hours.long : hours.day, fringes: payrollFringeSet(q), tags: [], payType: pos.payType ?? 'cash', participantId: id,
  });
  return { project: { ...project, participants: [...project.participants, participant] }, participant };
}
