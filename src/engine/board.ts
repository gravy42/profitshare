import type { Board, BoardElement, Project, Scene, Strip } from './types';
import { newId } from './budget';

export const eighthsToText = (e: number) => {
  const whole = Math.floor(e / 8), rem = e % 8;
  if (whole && rem) return `${whole} ${rem}/8`;
  if (whole) return `${whole}`;
  return `${rem}/8`;
};

export interface ShootDay {
  index: number;            // 1-based
  label?: string;
  date?: string;
  scenes: Scene[];
  eighths: number;
  castIds: number[];
}

/** Group the strips into shoot days. A trailing group without a day break still counts as a day. */
export function shootDays(board: Board): ShootDay[] {
  const byId = new Map(board.scenes.map(s => [s.id, s]));
  const days: ShootDay[] = [];
  let cur: ShootDay = { index: 1, scenes: [], eighths: 0, castIds: [] };
  for (const strip of board.strips) {
    if (strip.type === 'daybreak') {
      cur.label = strip.label; cur.date = strip.date;
      days.push(cur);
      cur = { index: days.length + 1, scenes: [], eighths: 0, castIds: [] };
    } else if (strip.type === 'scene') {
      const s = byId.get(strip.sceneId);
      if (!s) continue;
      cur.scenes.push(s);
      cur.eighths += s.eighths;
      for (const c of s.cast) if (c.id != null && !cur.castIds.includes(c.id)) cur.castIds.push(c.id);
    }
  }
  if (cur.scenes.length) days.push(cur);
  return days;
}

/** Day-out-of-days: for each cast member, which shoot days they work. */
export interface DoodRow { castId: number; name: string; workDays: number[]; total: number; span: number }

export function dood(board: Board): DoodRow[] {
  const days = shootDays(board);
  return board.castList.map(c => {
    const workDays = days.filter(d => d.castIds.includes(c.id)).map(d => d.index);
    const span = workDays.length ? workDays[workDays.length - 1] - workDays[0] + 1 : 0;
    return { castId: c.id, name: c.name, workDays, total: workDays.length, span };
  });
}

export function moveStrip(board: Board, from: number, to: number): Board {
  if (from === to || from < 0 || from >= board.strips.length) return board;
  const strips = board.strips.slice();
  const [s] = strips.splice(from, 1);
  strips.splice(to > from ? to - 1 : to, 0, s);
  return { ...board, strips };
}

export function insertDayBreak(board: Board, at: number): Board {
  const strips = board.strips.slice();
  strips.splice(at, 0, { type: 'daybreak', id: newId('db') });
  return { ...board, strips };
}

export function removeStrip(board: Board, index: number): Board {
  const strips = board.strips.slice();
  strips.splice(index, 1);
  return { ...board, strips };
}

export function clearDayBreaks(board: Board): Board {
  return { ...board, strips: board.strips.filter(s => s.type !== 'daybreak') };
}

/** Drop a day break whenever the running page count would pass the target. Keeps your scene order. */
export function autoDayBreaks(board: Board, targetEighths = board.targetEighthsPerDay): Board {
  const byId = new Map(board.scenes.map(s => [s.id, s]));
  const out: Strip[] = [];
  let run = 0;
  for (const strip of board.strips) {
    if (strip.type === 'daybreak') continue;
    const e = strip.type === 'scene' ? (byId.get(strip.sceneId)?.eighths ?? 0) : 0;
    if (run > 0 && run + e > targetEighths) { out.push({ type: 'daybreak', id: newId('db') }); run = 0; }
    out.push(strip); run += e;
  }
  return { ...board, strips: out };
}

/** Split the strips into exactly `days` shooting days, keeping scene order, so the heaviest day is as light as
 *  possible (linear partition: binary search on the max day, greedy feasibility check). */
export function fitDayBreaks(board: Board, days: number): Board {
  const byId = new Map(board.scenes.map(s => [s.id, s]));
  const items = board.strips.filter(s => s.type !== 'daybreak');
  const w = items.map(s => s.type === 'scene' ? (byId.get(s.sceneId)?.eighths ?? 0) : 0);
  const n = Math.max(1, Math.min(Math.floor(days), items.length));
  const fits = (cap: number) => { let used = 1, run = 0; for (const e of w) { if (run + e > cap && run > 0) { used++; run = 0; } run += e; } return used <= n; };
  let lo = Math.max(...w, 0), hi = w.reduce((a, b) => a + b, 0);
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (fits(mid)) hi = mid; else lo = mid + 1; }
  // lay out at that cap as groups of strip indexes
  const groups: number[][] = [[]];
  let run = 0;
  w.forEach((e, i) => {
    if (run > 0 && run + e > lo) { groups.push([]); run = 0; }
    groups[groups.length - 1].push(i); run += e;
  });
  // the greedy pass can come in under n days; split the heaviest splittable day at its most balanced point until we have n
  const sum = (g: number[]) => g.reduce((t, i) => t + w[i], 0);
  while (groups.length < n) {
    const candidates = groups.map((g, gi) => ({ gi, e: sum(g) })).filter(x => groups[x.gi].length > 1).sort((x, y) => y.e - x.e);
    if (!candidates.length) break;
    const g = groups[candidates[0].gi];
    let best = 1, bestDiff = Infinity;
    for (let k = 1; k < g.length; k++) { const d = Math.abs(sum(g.slice(0, k)) - sum(g.slice(k))); if (d < bestDiff) { bestDiff = d; best = k; } }
    groups.splice(candidates[0].gi, 1, g.slice(0, best), g.slice(best));
  }
  const out: Strip[] = [];
  groups.forEach((g, gi) => { if (gi > 0) out.push({ type: 'daybreak', id: newId('db') }); for (const i of g) out.push(items[i]); });
  return { ...board, strips: out };
}

/** Push cast work-day counts from the board into participants (matched by castId) and into
 *  cast budget lines linked to those participants (DAY-unit performer lines). */
export function syncCastDaysFromBoard(p: Project): Project {
  const rows = dood(p.board);
  const daysByCast = new Map(rows.map(r => [r.castId, r.total]));
  const participants = p.participants.map(pt => {
    if (pt.castId != null && daysByCast.has(pt.castId)) return { ...pt, days: daysByCast.get(pt.castId)! };
    if (pt.followsCastIds?.length || pt.followsElements?.length) { const d = daysFollowing(p.board, pt); return d > 0 || rows.length ? { ...pt, days: d } : pt; }
    return pt;
  });
  const daysOfParticipant = new Map(participants.filter(x => x.castId != null || x.followsCastIds?.length || x.followsElements?.length).map(x => [x.id, x.days]));
  const lines = p.lines.map(l => {
    if (!l.participantId || l.unit !== 'DAY' || !daysOfParticipant.has(l.participantId)) return l;
    return { ...l, amount: daysOfParticipant.get(l.participantId)! };
  });
  return { ...p, participants, lines };
}

/** Only the positions that follow cast or tags: recounted after the board's tags change (a script merge, a re-tag).
 *  Cast-linked participants are left alone; pushing cast days into the budget stays a deliberate click. */
export function syncFollowersFromBoard(p: Project): { project: Project; changed: string[] } {
  const changed: string[] = [];
  const participants = p.participants.map(pt => {
    if (!(pt.followsCastIds?.length || pt.followsElements?.length)) return pt;
    const d = daysFollowing(p.board, pt);
    if (d === pt.days) return pt;
    changed.push(`${pt.name} ${pt.days} → ${d}`);
    return { ...pt, days: d };
  });
  if (!changed.length) return { project: p, changed };
  const daysOf = new Map(participants.filter(x => x.followsCastIds?.length || x.followsElements?.length).map(x => [x.id, x.days]));
  const lines = p.lines.map(l => (!l.participantId || l.unit !== 'DAY' || !daysOf.has(l.participantId)) ? l : { ...l, amount: daysOf.get(l.participantId)! });
  return { project: { ...p, participants, lines }, changed };
}

/** Shoot days on which any of these cast members work: a studio teacher's days, a stunt double's days. */
export function daysWithCast(board: Board, castIds: number[]): number {
  return shootDays(board).filter(d => d.castIds.some(id => castIds.includes(id))).length;
}

const normEl = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sceneHasElement = (s: Scene, els: BoardElement[]) =>
  els.some(e => (s.elements[e.category] ?? []).some(item => normEl(item) === normEl(e.item)));

/** Shoot days on which a scene carries any of these tags: an animal wrangler's days with the cat, a picture-car
 *  wrangler's days with the Datsun, a stunt coordinator's days with the stunts. */
export function daysWithElements(board: Board, els: BoardElement[]): number {
  return shootDays(board).filter(d => d.scenes.some(s => sceneHasElement(s, els))).length;
}

/** Days for someone who follows cast and/or tags: any day either brings them in. */
export function daysFollowing(board: Board, who: { followsCastIds?: number[]; followsElements?: BoardElement[] }): number {
  const cast = who.followsCastIds ?? [], els = who.followsElements ?? [];
  if (!cast.length && !els.length) return 0;
  return shootDays(board).filter(d => d.castIds.some(id => cast.includes(id)) || d.scenes.some(s => sceneHasElement(s, els))).length;
}

/** Every tag on the board, once each, with how many scenes carry it; for picking what a position follows. */
export function boardElements(board: Board): (BoardElement & { scenes: number })[] {
  const m = new Map<string, BoardElement & { scenes: number }>();
  for (const s of board.scenes) for (const [category, items] of Object.entries(s.elements)) for (const item of items) {
    const k = category + '\u0000' + normEl(item);
    const hit = m.get(k);
    if (hit) hit.scenes++; else m.set(k, { category, item, scenes: 1 });
  }
  return [...m.values()].sort((a, b) => a.category.localeCompare(b.category) || b.scenes - a.scenes || a.item.localeCompare(b.item));
}

export const totalEighths = (board: Board) => board.scenes.reduce((n, s) => n + s.eighths, 0);

/** Scenes each cast member is in, in script order (strip order is the schedule; this is the story). */
export function castSceneCounts(board: Board): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of board.scenes) for (const c of s.cast) if (c.id != null) m.set(c.id, (m.get(c.id) ?? 0) + 1);
  return m;
}

/** The cast list in a new order (old cast ids, in the order they should now be numbered 1..n). Scene tags and any
 *  participants linked by cast number follow. */
export function renumberCast(p: Project, order: number[]): Project {
  const b = p.board;
  const seen = new Set<number>();
  const ids = [...order.filter(id => b.castList.some(c => c.id === id) && !seen.has(id) && (seen.add(id), true)), ...b.castList.map(c => c.id).filter(id => !seen.has(id))];
  const map = new Map(ids.map((old, i) => [old, i + 1]));
  const castList = ids.map(old => ({ ...b.castList.find(c => c.id === old)!, id: map.get(old)! }));
  const scenes = b.scenes.map(s => ({ ...s, cast: s.cast.map(c => c.id != null ? { ...c, id: map.get(c.id) ?? c.id } : c).sort((x, y) => (x.id ?? 0) - (y.id ?? 0)) }));
  const participants = p.participants.map(pt => pt.castId != null && map.has(pt.castId) ? { ...pt, castId: map.get(pt.castId)! } : pt);
  return { ...p, board: { ...b, castList, scenes }, participants };
}
/** Most scenes first (the way a breakdown numbers its cast), ties by current number. */
export const castOrderByScenes = (board: Board): number[] => {
  const n = castSceneCounts(board);
  return board.castList.map(c => c.id).sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || a - b);
};
/** Order of first appearance in the script. */
export const castOrderByAppearance = (board: Board): number[] => {
  const first = new Map<number, number>();
  board.scenes.forEach((s, i) => { for (const c of s.cast) if (c.id != null && !first.has(c.id)) first.set(c.id, i); });
  return board.castList.map(c => c.id).sort((a, b) => (first.get(a) ?? 1e9) - (first.get(b) ?? 1e9) || a - b);
};
