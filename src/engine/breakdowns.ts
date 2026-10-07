import type { Board, Scene } from './types';
import { shootDays, stripEighths, type ShootDay } from './board';

/** Script-day label for a scene, or '?' when the tagger left it blank. */
export const storyDayOf = (s: Scene) => (s.scriptDay && s.scriptDay.trim()) || '?';

/** Sort key for story days: numbers first in numeric order, then everything else alphabetically. */
export const storyDayKey = (d: string) => { const n = parseInt(d, 10); return isNaN(n) ? 1e9 : n; };

export interface StoryDayRow { day: ShootDay; storyDays: string[]; scenes: { scene: Scene; storyDay: string; cast: string[] }[] }

/** For each shoot day: the story days it touches, in schedule order, so hair, makeup and wardrobe can see the continuity jumps. */
export function storyDayBreakdown(board: Board): StoryDayRow[] {
  const names = new Map(board.castList.map(c => [c.id, c.name]));
  return shootDays(board).map(day => {
    const scenes = day.scenes.map(scene => ({ scene, storyDay: storyDayOf(scene), cast: scene.cast.map(c => names.get(c.id!) ?? c.name) }));
    const storyDays = [...new Set(scenes.map(x => x.storyDay))].sort((a, b) => storyDayKey(a) - storyDayKey(b));
    return { day, storyDays, scenes };
  });
}

export interface CharacterDay { day: ShootDay; scenes: { scene: Scene; storyDay: string }[]; storyDays: string[] }
export interface CharacterBreakdown { castId: number; name: string; days: CharacterDay[]; storyDaysTotal: number; jumps: number }

/** Per character: every shoot day they work, which scenes and which story days, and how many days ask for more than one look. */
export function characterBreakdown(board: Board): CharacterBreakdown[] {
  const days = shootDays(board);
  return board.castList.map(c => {
    const rows: CharacterDay[] = [];
    for (const day of days) {
      const scenes = day.scenes.filter(s => s.cast.some(x => x.id === c.id)).map(scene => ({ scene, storyDay: storyDayOf(scene) }));
      if (!scenes.length) continue;
      rows.push({ day, scenes, storyDays: [...new Set(scenes.map(x => x.storyDay))].sort((a, b) => storyDayKey(a) - storyDayKey(b)) });
    }
    const all = new Set(rows.flatMap(r => r.storyDays));
    return { castId: c.id, name: c.name, days: rows, storyDaysTotal: all.size, jumps: rows.filter(r => r.storyDays.length > 1).length };
  }).filter(r => r.days.length);
}

export const normItem = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export interface DepartmentDay { day: ShootDay; items: { item: string; scenes: Scene[] }[] }

/** One element category (Props, Wardrobe, Makeup/Hair, Set Dressing, Vehicles, Animals…) laid out by shoot day. */
export function departmentBreakdown(board: Board, category: string): DepartmentDay[] {
  return shootDays(board).map(day => {
    const m = new Map<string, { item: string; scenes: Scene[] }>();
    for (const s of day.scenes) for (const item of s.elements[category] ?? []) {
      const k = normItem(item); const hit = m.get(k);
      if (hit) { if (!hit.scenes.includes(s)) hit.scenes.push(s); } else m.set(k, { item, scenes: [s] });
    }
    return { day, items: [...m.values()].sort((a, b) => a.item.localeCompare(b.item)) };
  });
}

/** Every category on the board, most-tagged first. */
export function elementCategories(board: Board): string[] {
  const n = new Map<string, number>();
  for (const s of board.scenes) for (const [k, v] of Object.entries(s.elements)) n.set(k, (n.get(k) ?? 0) + v.length);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export interface TrackedDay { day: ShootDay; scenes: Scene[]; eighths: number; locations: string[]; storyDays: string[]; cast: string[] }

/** One element (Jack the cat, a picture car, a prosthetic) across the schedule: the days it works, what it does, who it works with. */
export function trackElement(board: Board, category: string, item: string): TrackedDay[] {
  const key = normItem(item);
  const names = new Map(board.castList.map(c => [c.id, c.name]));
  const byId = new Map(board.scenes.map(s => [s.id, s]));
  const out: TrackedDay[] = [];
  let i = 0;
  for (const day of shootDays(board)) {
    // walk the strips of this day to sum the pages of just the matching scenes (a split scene counts its share)
    let eighths = 0; const scenes: Scene[] = [];
    while (i < board.strips.length && board.strips[i].type !== 'daybreak') {
      const st = board.strips[i];
      if (st.type === 'scene') { const s = byId.get(st.sceneId); if (s && (s.elements[category] ?? []).some(x => normItem(x) === key)) { if (!scenes.includes(s)) scenes.push(s); eighths += stripEighths(board, st, byId); } }
      i++;
    }
    i++;
    if (!scenes.length) continue;
    out.push({ day, scenes, eighths, locations: [...new Set(scenes.map(s => s.location).filter(Boolean))], storyDays: [...new Set(scenes.map(storyDayOf))].sort((a, b) => storyDayKey(a) - storyDayKey(b)), cast: [...new Set(scenes.flatMap(s => s.cast.map(c => names.get(c.id!) ?? c.name)))] });
  }
  return out;
}

/** Items in a category, most scenes first, for the picker. */
export function itemsIn(board: Board, category: string): { item: string; scenes: number }[] {
  const m = new Map<string, { item: string; scenes: number }>();
  for (const s of board.scenes) for (const item of new Set((s.elements[category] ?? []).map(normItem))) {
    const hit = m.get(item); if (hit) hit.scenes++; else m.set(item, { item: (s.elements[category] ?? []).find(x => normItem(x) === item)!, scenes: 1 });
  }
  return [...m.values()].sort((a, b) => b.scenes - a.scenes || a.item.localeCompare(b.item));
}
