import type { Board, Project, Scene, Strip } from './types';
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
  const participants = p.participants.map(pt =>
    pt.castId != null && daysByCast.has(pt.castId) ? { ...pt, days: daysByCast.get(pt.castId)! } : pt);
  const castOfParticipant = new Map(participants.filter(x => x.castId != null).map(x => [x.id, x.castId!]));
  const lines = p.lines.map(l => {
    if (!l.participantId || l.unit !== 'DAY') return l;
    const cid = castOfParticipant.get(l.participantId);
    if (cid == null || !daysByCast.has(cid)) return l;
    return { ...l, amount: daysByCast.get(cid)! };
  });
  return { ...p, participants, lines };
}

export const totalEighths = (board: Board) => board.scenes.reduce((n, s) => n + s.eighths, 0);
