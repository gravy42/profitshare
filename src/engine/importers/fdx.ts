import type { Board, Scene } from '../types';
import { addSilentCast, finishBoard } from './screenplay';

interface FdTag { category: string; label: string }

/** Final Draft's tagger, when the writer has used it: each tagged span in the text carries a TagNumber, which
 *  points at one or more tag definitions (a label in a category). Cast Members, Script Day, Location and Synopsis
 *  fill the scene's own fields; every other category (Props, Vehicles, Background Actors, Animals, Stunts, ...)
 *  becomes a breakdown tag under Final Draft's category name. */
function readTagData(doc: Document): Map<string, FdTag[]> {
  const out = new Map<string, FdTag[]>();
  const td = doc.querySelector('FinalDraft > TagData');
  if (!td) return out;
  const cats = new Map<string, string>();
  for (const c of Array.from(td.querySelectorAll('TagCategories > TagCategory'))) cats.set(c.getAttribute('Id') ?? '', (c.getAttribute('Name') ?? '').trim());
  const defs = new Map<string, FdTag>();
  for (const d of Array.from(td.querySelectorAll('TagDefinitions > TagDefinition'))) {
    const label = (d.getAttribute('Label') ?? '').replace(/\s+/g, ' ').trim();
    if (label) defs.set(d.getAttribute('Id') ?? '', { category: cats.get(d.getAttribute('CatId') ?? '') || 'Notes', label });
  }
  for (const t of Array.from(td.querySelectorAll('Tags > Tag'))) {
    const list = Array.from(t.querySelectorAll('DefId')).map(x => defs.get((x.textContent ?? '').trim())).filter((x): x is FdTag => !!x);
    if (list.length) out.set(t.getAttribute('Number') ?? '', list);
  }
  return out;
}

/** Final Draft (.fdx) → breakdown. Reads scene headings and numbers, page lengths, the characters who speak in
 *  each scene, silent characters named in the action, and, when the script was tagged in Final Draft, every tag. */
export function parseFdx(xml: string): Board {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not parse this .fdx file');
  const content = doc.querySelector('FinalDraft > Content');
  if (!content) throw new Error('No <Content> in this .fdx');
  const tags = readTagData(doc);

  const textOf = (p: Element) => Array.from(p.children)
    .filter(c => c.tagName === 'Text').map(c => c.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
  const lengthToEighths = (len: string): number => {
    // "2/8", "3 3/8", "2", "" → eighths
    const m = /^(\d+)?\s*(?:(\d+)\/8)?$/.exec(len.trim());
    if (!m) return 0;
    return (parseInt(m[1] ?? '0', 10) * 8) + parseInt(m[2] ?? '0', 10);
  };
  const fdSynopsis = new Map<Scene, string>();
  const applyTag = (s: Scene, t: FdTag) => {
    switch (t.category) {
      case 'Cast Members': {
        const name = t.label.toUpperCase().replace(/\(.*?\)/g, '').trim();   // "NAYELI (O.S.)" → NAYELI
        if (name && !s.cast.some(c => c.name === name)) s.cast.push({ name });
        return;
      }
      case 'Script Day': if (!s.scriptDay) s.scriptDay = t.label.replace(/^D(?=\d+$)/i, ''); return;   // D14 → 14
      case 'Location': if (!s.location) s.location = t.label; return;
      case 'Synopsis': if (!fdSynopsis.has(s)) fdSynopsis.set(s, t.label); return;
      default: {
        const list = (s.elements[t.category] ??= []);
        if (!list.some(x => x.toLowerCase() === t.label.toLowerCase())) list.push(t.label);
      }
    }
  };

  const scenes: Scene[] = [];
  let cur: Scene | null = null;
  let n = 0;
  for (const p of Array.from(content.children)) {
    if (p.tagName !== 'Paragraph') continue;
    const type = p.getAttribute('Type');
    if (type === 'Scene Heading') {
      const heading = textOf(p).toUpperCase();
      const props = p.querySelector('SceneProperties');
      const m = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?)\s*(.*?)(?:\s+-\s+([^-]*))?$/.exec(heading);
      const ieRaw = (m?.[1] ?? '').replace(/\./g, '');
      n += 1;
      const fdNumber = (p.getAttribute('Number') ?? '').trim();   // Final Draft's own scene number, once the script is locked or numbered
      cur = {
        id: `sc${n}`, number: fdNumber || String(n),
        ie: ieRaw === 'INT' ? 'INT' : ieRaw === 'EXT' ? 'EXT' : 'I/E',
        set: (m?.[2] ?? heading).trim(), tod: (m?.[3] ?? '').trim(),
        pages: props?.getAttribute('Page') ?? '', eighths: lengthToEighths(props?.getAttribute('Length') ?? ''),
        synopsis: '', location: '', scriptDay: '', cast: [], elements: {},
      };
      scenes.push(cur);
    } else if (type === 'Character' && cur) {
      // "SAM (O.S.)" → SAM ; "TAYLOR/LIAM" → TAYLOR, LIAM
      const raw = textOf(p).toUpperCase().replace(/\(.*?\)/g, '').trim();
      for (const name of raw.split('/').map(s => s.trim()).filter(Boolean)) {
        if (!cur.cast.some(c => c.name === name)) cur.cast.push({ name });
      }
      cur.text = (cur.text ? cur.text + '\n' : '') + ' '.repeat(20) + textOf(p).toUpperCase();
    } else if ((type === 'Dialogue' || type === 'Parenthetical') && cur) {
      cur.text = (cur.text ? cur.text + '\n' : '') + ' '.repeat(10) + textOf(p);
    } else if (type === 'Action' && cur) {
      const t = textOf(p);
      if (t && !cur.synopsis) cur.synopsis = t.length > 120 ? t.slice(0, 117) + '...' : t;
      if (t) cur.text = (cur.text ? cur.text + '\n' : '') + t;
    }
    // the writer's own tags on this paragraph, whatever kind of paragraph it is
    if (cur && tags.size) {
      for (const x of Array.from(p.children)) {
        if (x.tagName !== 'Text') continue;
        for (const t of tags.get(x.getAttribute('TagNumber') ?? '') ?? []) applyTag(cur, t);
      }
    }
  }
  for (const [s, syn] of fdSynopsis) s.synopsis = syn;
  addSilentCast(scenes);
  return finishBoard(scenes);
}

/** True when the file carries tags from Final Draft's tagger. */
export function fdxHasTags(xml: string): boolean {
  return /<TagData>[\s\S]*<Tag Number=/.test(xml);
}

/** The title from a Final Draft title page, if there is one. */
export function fdxTitle(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const tp = doc.querySelector('TitlePage');
  if (!tp) return '';
  for (const p of Array.from(tp.querySelectorAll('Paragraph'))) {
    const t = Array.from(p.children).filter(c => c.tagName === 'Text').map(c => c.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
    if (t) return t.replace(/^["“”']+|["“”']+$/g, '');
  }
  return '';
}
