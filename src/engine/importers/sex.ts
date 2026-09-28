import type { Board, Scene, Strip } from '../types';

/** Parser for the Movie Magic Scheduling exchange format (.sex), as exported by Shamel Studio,
 *  Movie Magic and others. Reverse-engineered from a Shamel export; there is no public spec.
 *
 *  Layout (all integers little-endian):
 *    "SSI*\0#\0\0\0" + 2 header bytes + "\0\0" + NUL-separated category names (Synopsis, Cast Members, ...)
 *    then records, each:  "#\0\0\0" u16 len, u16 type, payload (len covers type + payload)
 *      type 1 – scene header: u8 sceneIndex, "pages\tsceneNumber\tINT SET-TIME\0"
 *      type 3 – scene meta:   u16 sceneIndex, u16 ?, u16 eighths
 *      type 2 – element:      u16 sceneIndex, u8 categoryIndex, text\0
 *  Type-1 records appear in board (shooting) order. */
export function parseSex(buf: ArrayBuffer): Board {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  const latin = (s: Uint8Array) => Array.from(s, c => String.fromCharCode(c)).join('');
  if (latin(b.subarray(0, 4)) !== 'SSI*') throw new Error('Not a Movie Magic .sex file');
  const marker = (i: number) => b[i] === 0x23 && b[i + 1] === 0 && b[i + 2] === 0 && b[i + 3] === 0;
  let first = 6; while (first < b.length && !marker(first)) first++;
  const cats = latin(b.subarray(12, first)).split('\0').filter(Boolean);

  const scenes = new Map<number, Scene & { _order: number }>();
  const order: number[] = [];
  let i = first;
  while (i + 8 <= b.length) {
    if (!marker(i)) throw new Error(`Bad record at byte ${i}`);
    const len = dv.getUint16(i + 4, true);
    const type = dv.getUint16(i + 6, true);
    const pl = b.subarray(i + 8, i + 6 + len);
    if (type === 1) {
      const idx = pl[0];
      const text = latin(pl.subarray(1)).replace(/\0+$/, '');
      const [pages, number, heading] = text.split('\t');
      const m = /^(INT\/EXT|INT\.?\/EXT\.?|I\/E|INT|EXT)\.?\s*(.*?)-([^-]*)$/.exec(heading ?? '');
      const ieRaw = m ? m[1] : '';
      const ie: Scene['ie'] = ieRaw === 'INT' ? 'INT' : ieRaw === 'EXT' ? 'EXT' : 'I/E';
      scenes.set(idx, { id: `sc${number}`, number, ie, set: m ? m[2].trim() : heading, tod: m ? m[3].trim() : '',
        pages, eighths: 0, synopsis: '', location: '', scriptDay: '', cast: [], elements: {}, _order: order.length });
      order.push(idx);
    } else if (type === 3) {
      const idx = dv.getUint16(i + 8, true);
      const s = scenes.get(idx); if (s) s.eighths = dv.getUint16(i + 12, true);
    } else if (type === 2) {
      const idx = dv.getUint16(i + 8, true);
      const cat = cats[pl[2]] ?? `cat${pl[2]}`;
      const text = latin(pl.subarray(3)).replace(/\0+$/, '');
      const s = scenes.get(idx);
      if (s) {
        if (cat === 'Synopsis') s.synopsis = text;
        else if (cat === 'Cast Members') s.cast.push({ name: text });
        else if (cat === 'Location') s.location = text;
        else if (cat === 'Script Day') s.scriptDay = text;
        else if (cat === 'Comments') { /* ignore */ }
        else (s.elements[cat] ??= []).push(text);
      }
    }
    i += 6 + len;
  }
  // Cast numbering: order of first appearance in script order, since the file carries names only.
  const sorted = [...scenes.values()].sort((a, b2) => (parseInt(a.number) || 0) - (parseInt(b2.number) || 0));
  const castList: { id: number; name: string }[] = [];
  for (const s of sorted) for (const c of s.cast) {
    let m = castList.find(x => x.name === c.name);
    if (!m) { m = { id: castList.length + 1, name: c.name }; castList.push(m); }
    c.id = m.id;
  }
  const strips: Strip[] = order.map(idx => ({ type: 'scene', sceneId: scenes.get(idx)!.id }));
  return { castList, scenes: sorted.map(({ _order, ...s }) => s), strips, targetEighthsPerDay: 44 };
}
