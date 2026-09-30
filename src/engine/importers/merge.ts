// Pour a script into a board you already have. The board (from a .sex file, or built by hand) keeps its strip
// order, day breaks, cast numbers, locations, script days and every tag on it; the script brings each scene's
// text, its speaking and silent cast, and a first pass of tags on top of what is there. Scenes match by number.
import type { Board, CastMember, Scene } from '../types';
import { autoTag, namedAnimals } from '../breakdown';

export interface MergeReport {
  matched: number;                 // board scenes that found their script scene
  unmatched: string[];             // board scene numbers with no script scene of that number
  added: string[];                 // script scenes the board didn't have, appended at the end of the strips
  newCast: string[];               // names the script speaks or shows that the board's cast list lacked
  castAdded: number;               // scene-cast tags added
  tagsAdded: number;               // breakdown tags added across all categories
  headingMismatch: string[];       // matched by number, but the set names don't look like the same scene
}

// a cue like FRIENDS or GUESTS is a group, not a person: it goes on the board as background, not on the cast list
const GROUP = /^(?:FRIENDS|FAMILY|KIDS|CHILDREN|MEN|WOMEN|GUESTS|PEOPLE|PATRONS|STUDENTS|SOLDIERS|COPS|OFFICERS|CUSTOMERS|REPORTERS|FANS|TEAM|CROWD|EVERYONE|ALL|BOTH|VOICES?)$/;
const normNo = (n: string) => n.trim().toUpperCase().replace(/^0+(?=\d)/, '');
const normSet = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const count = (b: Board) => b.scenes.reduce((n, s) => n + Object.values(s.elements).flat().length, 0);

export function mergeScriptIntoBoard(board: Board, script: Board): { board: Board; report: MergeReport } {
  const byNo = new Map(script.scenes.map(s => [normNo(s.number), s]));
  const used = new Set<string>();
  const castList: CastMember[] = board.castList.map(c => ({ ...c }));
  const idByName = new Map(castList.map(c => [c.name.toUpperCase(), c.id]));
  let nextId = castList.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const newCast: string[] = [];
  const idFor = (name: string) => {
    const k = name.toUpperCase();
    let id = idByName.get(k);
    if (id == null) { id = nextId++; castList.push({ id, name: k }); idByName.set(k, id); newCast.push(k); }
    return id;
  };
  let castAdded = 0;
  const unmatched: string[] = [], headingMismatch: string[] = [];

  const merged: Scene[] = board.scenes.map(s => {
    const src = byNo.get(normNo(s.number));
    if (!src) { unmatched.push(s.number); return s; }
    used.add(normNo(s.number));
    const a = normSet(s.set), b = normSet(src.set);
    if (a && b && !(a.includes(b) || b.includes(a) || a.split(' ')[0] === b.split(' ')[0])) headingMismatch.push(`${s.number} (${s.set} / ${src.set})`);
    const cast = s.cast.map(c => ({ ...c }));
    const elements = { ...s.elements };
    for (const c of src.cast) {
      if (cast.some(x => x.name.toUpperCase() === c.name.toUpperCase())) continue;
      if (GROUP.test(c.name.toUpperCase())) { const bg = elements['Background Actors'] ?? []; if (!bg.some(x => x.toLowerCase() === c.name.toLowerCase())) elements['Background Actors'] = [...bg, c.name.toLowerCase()]; continue; }
      cast.push({ id: idFor(c.name), name: c.name.toUpperCase() }); castAdded++;
    }
    cast.sort((x, y) => (x.id ?? 0) - (y.id ?? 0));
    return {
      ...s, cast, elements,
      text: src.text ?? s.text,
      synopsis: s.synopsis || src.synopsis,
      eighths: s.eighths || src.eighths,
      pages: s.pages || src.pages,
      tod: s.tod || src.tod,
    };
  });
  // scenes the script has that the board doesn't: on at the end, so nothing already scheduled moves
  const added: string[] = [];
  const extra: Scene[] = [];
  for (const src of script.scenes) {
    if (used.has(normNo(src.number))) continue;
    const id = merged.some(s => s.id === src.id) || extra.some(s => s.id === src.id) ? `sc_${normNo(src.number)}_${Date.now().toString(36)}` : src.id;
    extra.push({ ...src, id, cast: src.cast.filter(c => !GROUP.test(c.name.toUpperCase())).map(c => ({ id: idFor(c.name), name: c.name.toUpperCase() })).sort((x, y) => x.id - y.id) });
    added.push(src.number);
  }
  const scenes = [...merged, ...extra];
  const strips = [...board.strips, ...extra.map(s => ({ type: 'scene' as const, sceneId: s.id }))];
  // the first pass of tags, on top of what the board carries; hand-made tags are never removed
  const before = count({ ...board, scenes });
  const names = castList.map(c => c.name);
  const animals = namedAnimals({ ...board, castList, scenes, strips });
  const tagged = scenes.map(s => s.text ? { ...s, elements: autoTag(s, names, animals) } : s);
  const out: Board = { ...board, castList, scenes: tagged, strips };
  return { board: out, report: { matched: used.size, unmatched, added, newCast, castAdded, tagsAdded: count(out) - before, headingMismatch } };
}

/** One line for the message bar. */
export function describeMerge(r: MergeReport): string {
  const bits = [`${r.matched} scene${r.matched === 1 ? '' : 's'} matched by number`];
  if (r.tagsAdded) bits.push(`${r.tagsAdded} tag${r.tagsAdded === 1 ? '' : 's'} added`);
  if (r.castAdded) bits.push(`${r.castAdded} cast tag${r.castAdded === 1 ? '' : 's'} added`);
  if (r.newCast.length) bits.push(`new on the cast list: ${r.newCast.join(', ')}`);
  if (r.added.length) bits.push(`${r.added.length} scene${r.added.length === 1 ? '' : 's'} the board didn't have, added at the end: ${r.added.slice(0, 8).join(', ')}${r.added.length > 8 ? '…' : ''}`);
  if (r.unmatched.length) bits.push(`${r.unmatched.length} board scene${r.unmatched.length === 1 ? '' : 's'} not in the script: ${r.unmatched.slice(0, 8).join(', ')}${r.unmatched.length > 8 ? '…' : ''}`);
  if (r.headingMismatch.length) bits.push(`check ${r.headingMismatch.length}: same number, different heading: ${r.headingMismatch.slice(0, 4).join('; ')}${r.headingMismatch.length > 4 ? '…' : ''}`);
  return bits.join(' · ');
}
