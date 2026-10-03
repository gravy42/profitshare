import type { Board, BoardElement, LineItem, Project, Scene, Strip } from './types';
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
  scenes: Scene[];          // a scene shot across days appears in each of them
  eighths: number;
  castIds: number[];
}

/** Pages a strip carries: its own share when the scene is split across days, else the whole scene. */
export const stripEighths = (board: Board, strip: Strip, byId = new Map(board.scenes.map(s => [s.id, s]))): number =>
  strip.type !== 'scene' ? 0 : strip.eighths ?? byId.get(strip.sceneId)?.eighths ?? 0;

/** Which part of its scene a strip is (1-based) and how many parts there are; 1 of 1 for an unsplit scene. */
export function stripPart(board: Board, index: number): { part: number; parts: number } {
  const s = board.strips[index];
  if (!s || s.type !== 'scene') return { part: 1, parts: 1 };
  const idx = board.strips.map((x, i) => (x.type === 'scene' && x.sceneId === s.sceneId ? i : -1)).filter(i => i >= 0);
  return { part: idx.indexOf(index) + 1, parts: idx.length };
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
      cur.eighths += stripEighths(board, strip, byId);
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

/** Shoot this strip over two days: it becomes two strips of the same scene, the pages halved between them (the odd
 *  eighth lands on the first). Split a part again for a third day. Drag the second part below a day break. */
export function splitStrip(board: Board, index: number): Board {
  const s = board.strips[index];
  if (!s || s.type !== 'scene') return board;
  const e = stripEighths(board, s);
  const first = Math.ceil(e / 2), second = e - first;
  const strips = board.strips.slice();
  strips.splice(index, 1, { ...s, eighths: first }, { type: 'scene', sceneId: s.sceneId, eighths: second });
  return { ...board, strips };
}

/** Put a split scene back on one strip, where its first part sits, with the scene's full page count. */
export function unsplitScene(board: Board, sceneId: string): Board {
  const first = board.strips.findIndex(x => x.type === 'scene' && x.sceneId === sceneId);
  if (first < 0) return board;
  const strips = board.strips.filter((x, i) => i === first || !(x.type === 'scene' && x.sceneId === sceneId));
  strips[first] = { type: 'scene', sceneId };
  return { ...board, strips };
}

/** Set one part's pages; the scene's other parts share what is left so the parts still add up to the scene. */
export function setPartEighths(board: Board, index: number, eighths: number): Board {
  const s = board.strips[index];
  if (!s || s.type !== 'scene') return board;
  const total = board.scenes.find(x => x.id === s.sceneId)?.eighths ?? 0;
  const others = board.strips.map((x, i) => (i !== index && x.type === 'scene' && x.sceneId === s.sceneId ? i : -1)).filter(i => i >= 0);
  if (!others.length) return board;
  const mine = Math.max(0, Math.min(total, Math.round(eighths)));
  const was = others.map(i => stripEighths(board, board.strips[i]));
  const wasSum = was.reduce((a, b) => a + b, 0) || others.length;
  let left = total - mine;
  const strips = board.strips.slice();
  strips[index] = { ...s, eighths: mine };
  others.forEach((i, k) => {
    const share = k === others.length - 1 ? left : Math.round((total - mine) * (was[k] || 1) / wasSum);
    strips[i] = { ...(strips[i] as Extract<Strip, { type: 'scene' }>), eighths: Math.max(0, share) };
    left -= Math.max(0, share);
  });
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
    const e = stripEighths(board, strip, byId);
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
  const w = items.map(s => stripEighths(board, s, byId));
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

/** The stripboard owns a cast member's shoot days and a follower's days: the lines flagged daysFrom:'board' take
 *  the day-out-of-days count, and the person's points days become the sum of their DAY lines (shoot plus whatever
 *  rehearsal or fitting days sit on their own line). Lines without the flag are left alone. Idempotent, so it can
 *  run after every board edit. */
export function syncCastDaysFromBoard(p: Project): Project {
  const rows = dood(p.board);
  const daysByCast = new Map(rows.map(r => [r.castId, r.total]));
  const boardDays = new Map<string, number>();
  for (const pt of p.participants) {
    if (pt.castId != null && daysByCast.has(pt.castId)) boardDays.set(pt.id, daysByCast.get(pt.castId)!);
    else if (pt.followsCastIds?.length || pt.followsElements?.length) boardDays.set(pt.id, daysFollowing(p.board, pt));
  }
  if (!boardDays.size) return p;
  let touched = false;
  const lines = p.lines.map(l => {
    if (l.daysFrom !== 'board' || !l.participantId || !boardDays.has(l.participantId)) return l;
    const amount = boardDays.get(l.participantId)!;
    if (l.amount === amount) return l;
    touched = true; return { ...l, amount };
  });
  const dayTotals = new Map<string, number>();
  for (const l of lines) if (l.participantId && l.unit === 'DAY' && boardDays.has(l.participantId)) dayTotals.set(l.participantId, (dayTotals.get(l.participantId) ?? 0) + l.amount);
  const participants = p.participants.map(pt => {
    if (!boardDays.has(pt.id)) return pt;
    const days = dayTotals.has(pt.id) ? dayTotals.get(pt.id)! : boardDays.get(pt.id)!;
    if (days === pt.days) return pt;
    touched = true; return { ...pt, days };
  });
  return touched ? { ...p, participants, lines } : p;
}

/** Decide which lines the board owns, once per project. A cast member's or follower's first "Shoot" DAY line (or
 *  first DAY line) gets daysFrom:'board'. A combined "Shoot | Rehearsal | Fitting" line is split: the shoot part
 *  follows the board, and the rehearsal and fitting days move to a line of their own, sized so the budget total
 *  does not change the moment this runs. Idempotent. */
export function adoptBoardDays(p: Project): Project {
  const rows = dood(p.board);
  const daysByCast = new Map(rows.map(r => [r.castId, r.total]));
  const owned = new Set<string>();
  const boardDays = new Map<string, number>();
  for (const pt of p.participants) {
    if (pt.castId != null) { owned.add(pt.id); if (daysByCast.has(pt.castId)) boardDays.set(pt.id, daysByCast.get(pt.castId)!); }
    else if (pt.followsCastIds?.length || pt.followsElements?.length) { owned.add(pt.id); boardDays.set(pt.id, daysFollowing(p.board, pt)); }
  }
  if (!owned.size) return p;
  const flagged = new Set(p.lines.filter(l => l.daysFrom === 'board' && l.participantId).map(l => l.participantId!));
  const combined = /shoot/i;
  const extra = /rehears|fitting/i;
  let changed = false;
  const out: LineItem[] = [];
  const done = new Set<string>();
  for (const l of p.lines) {
    const pid = l.participantId;
    if (!pid || l.unit !== 'DAY' || !owned.has(pid) || flagged.has(pid) || done.has(pid)) { out.push(l); continue; }
    // the first eligible DAY line for this person: a "Shoot" line wins, otherwise whichever comes first
    const firstShoot = p.lines.find(x => x.participantId === pid && x.unit === 'DAY' && combined.test(x.description));
    if (firstShoot && firstShoot !== l) { out.push(l); continue; }
    done.add(pid); changed = true;
    if (combined.test(l.description) && extra.test(l.description)) {
      const shoot = boardDays.get(pid);
      const rest = shoot == null ? 0 : Math.max(0, l.amount - shoot);
      out.push({ ...l, description: l.description.replace(/\s*\|\s*rehearsal\s*\|\s*fitting/i, '').replace(/^shoot.*$/i, 'Shoot'), daysFrom: 'board' });
      out.push({ ...l, id: `${l.id}_rf`, description: 'Rehearsal | Fitting', amount: rest, daysFrom: undefined, notes: 'Days off the board: rehearsals, fittings, a wardrobe test. Edit freely; the Shoot line above follows the stripboard.' });
    } else {
      out.push({ ...l, daysFrom: 'board' });
    }
  }
  return changed ? { ...p, lines: out } : p;
}

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
  const participants = p.participants.map(pt => ({
    ...pt,
    ...(pt.castId != null && map.has(pt.castId) ? { castId: map.get(pt.castId)! } : {}),
    ...(pt.followsCastIds?.length ? { followsCastIds: pt.followsCastIds.map(id => map.get(id) ?? id) } : {}),
  }));
  return { ...p, board: { ...b, castList, scenes }, participants };
}

/** Drop a character from the cast list: their tags come off every scene, a participant linked by that cast
 *  number is unlinked (the budget line stays), and nobody follows them any more. The other numbers are kept. */
export function dropCastMember(p: Project, castId: number): Project {
  const b = p.board;
  if (!b.castList.some(c => c.id === castId)) return p;
  const castList = b.castList.filter(c => c.id !== castId);
  const scenes = b.scenes.map(s => s.cast.some(c => c.id === castId) ? { ...s, cast: s.cast.filter(c => c.id !== castId) } : s);
  const participants = p.participants.map(pt => {
    let out = pt;
    if (pt.castId === castId) { const { castId: _drop, ...rest } = pt; out = rest; }
    if (pt.followsCastIds?.includes(castId)) out = { ...out, followsCastIds: pt.followsCastIds.filter(id => id !== castId) };
    return out;
  });
  return { ...p, board: { ...b, castList, scenes }, participants };
}

/** Cast with no scene tags, the leftovers after a breakdown is cleaned up. */
export const unusedCast = (board: Board): number[] => {
  const n = castSceneCounts(board);
  return board.castList.map(c => c.id).filter(id => !n.get(id));
};
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
