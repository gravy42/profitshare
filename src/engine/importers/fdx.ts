import type { Board, Scene } from '../types';
import { finishBoard } from './screenplay';

/** Final Draft (.fdx) → breakdown. Reads scene headings, page lengths and the characters who speak
 *  in each scene. Non-speaking characters tagged in Final Draft's tagger are not in the FDX text
 *  stream in a reliable way, so add them on the board afterwards. */
export function parseFdx(xml: string): Board {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not parse this .fdx file');
  const content = doc.querySelector('FinalDraft > Content');
  if (!content) throw new Error('No <Content> in this .fdx');

  const textOf = (p: Element) => Array.from(p.children)
    .filter(c => c.tagName === 'Text').map(c => c.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
  const lengthToEighths = (len: string): number => {
    // "2/8", "3 3/8", "2", "" → eighths
    const m = /^(\d+)?\s*(?:(\d+)\/8)?$/.exec(len.trim());
    if (!m) return 0;
    return (parseInt(m[1] ?? '0', 10) * 8) + parseInt(m[2] ?? '0', 10);
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
      cur = {
        id: `sc${n}`, number: String(n),
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
  }
  return finishBoard(scenes);
}
