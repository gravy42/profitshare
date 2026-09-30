import type { Board, Scene, Strip } from '../types';

/** Screenplay text → breakdown. One parser for Fountain, plain text (Highland, Celtx, Final Draft "save as text",
 *  pdftotext) and the line stream pulled out of a PDF. Scene headings become scenes, the characters who speak in
 *  each scene become its cast, and the length of each scene is measured in eighths from where the headings fall.
 *
 *  Lines carry a position on the page so the eighths come out right whatever the source:
 *    pos    = page index + fraction of the way down the page (0 at the top, 1 at the bottom)
 *    indent = how far in from the left the line starts (chars for text, points for PDF); character cues sit
 *             further in than action, which is how a cue is told apart from a shouted action line. */
export interface ScriptLine { text: string; pos: number; indent: number; page: string }

export interface ScreenplayImport { board: Board; title: string; pages: number; warnings: string[] }

const HEADING = /^(?:(\d+[A-Z]?)[.\s]+)?(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.?|EXT\.?)(?=[\s.\-:])\s*[.\-:]?\s*(.*?)(?:\s+(\d+[A-Z]?)|\s*#([\w.-]+)#)?\s*$/i;
const TOD = /\b(DAY|NIGHT|MORNING|AFTERNOON|EVENING|DUSK|DAWN|SUNSET|SUNRISE|LATER|CONTINUOUS|SAME TIME|MAGIC HOUR|PRE-DAWN|PREDAWN|NOON|MIDNIGHT|TWILIGHT|MOMENTS|HOURS?|MINUTES)\b/i;
// all-caps lines that are not character cues: time cards, montage marks, sound effects with punctuation
const NOT_CUE = /^(?:LATER|MEANWHILE|CONTINUOUS|THE NEXT (?:DAY|MORNING|NIGHT)|THAT (?:NIGHT|MORNING|EVENING|AFTERNOON)|(?:\w+[- ])?(?:SECONDS?|MINUTES?|HOURS?|DAYS?|WEEKS?|MONTHS?|YEARS?) LATER|MOMENTS LATER|END (?:OF )?(?:MONTAGE|FLASHBACK|DREAM|INTERCUT).*|MONTAGE.*|FLASHBACK.*|INTERCUT.*|BACK TO .*|SUPER.*|TITLE.*|CHYRON.*|INSERT.*|ANGLE ON.*|CLOSE ON.*|POV.*|SILENCE|BLACK|BEAT)$/i;
const TRANSITION = /^(?:(?:CUT|DISSOLVE|FADE|SMASH CUT|MATCH CUT|WIPE|JUMP CUT|TIME CUT|IRIS)\b.*(?:TO|IN|OUT)\s*[:.]?|.*TO:|THE END\.?|END\.?|FADE OUT\.?|OVER BLACK\.?|BLACK\.?)$/i;
const NOISE = /^(?:\(?CONTINUED\)?:?|\(MORE\)|CONT'D|\d{1,3}\.?|[ivx]+\.?)$/i;
const CAST_SPLIT = /\s*(?:\/|\s&\s|\s\+\s)\s*/;
const GROUP = /^(?:EVERYONE|EVERYBODY|ALL|BOTH|TOGETHER|CROWD|GROUP|VOICE|VOICES|UNISON|OVERLAPPING|VARIOUS)$/;
// group cues that are real parts (they speak) but are ordinary words in action, so never matched there
const GROUP_NOUN = /^(?:FRIENDS|FAMILY|KIDS|CHILDREN|MEN|WOMEN|GUESTS|PEOPLE|PATRONS|STUDENTS|SOLDIERS|COPS|OFFICERS|CUSTOMERS|REPORTERS|FANS|TEAM)$/;

const letters = (s: string) => s.replace(/[^A-Za-z]/g, '');
const isCaps = (s: string) => { const l = letters(s); return l.length > 0 && l === l.toUpperCase(); };
const mostlyCaps = (s: string) => { const l = letters(s); return l.length > 0 && l.replace(/[a-z]/g, '').length / l.length >= 0.7; };   // McCLANE, DeSANTIS
const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const cleanCue = (s: string) => plain(s).replace(/\(.*?\)/g, '').replace(/\^\s*$/, '').replace(/\s+/g, ' ').trim().toUpperCase();
const looksLikeCue = (s: string, strict = true) => {
  const c = cleanCue(s);
  return c.length >= 2 && c.length <= 40 && c.split(' ').length <= 5 && (strict ? isCaps(s) : mostlyCaps(s)) && !HEADING.test(s) && !TRANSITION.test(s) && !NOISE.test(s)
    && !NOT_CUE.test(c) && /[A-Z]/.test(c) && !/[,:;!?"“”]|\.$/.test(c);
};

/** Shared by every script importer: number the cast, one strip per scene in script order. */
export function finishBoard(scenes: Scene[]): Board {
  const castList: { id: number; name: string }[] = [];
  for (const s of scenes) for (const c of s.cast) {
    let m = castList.find(x => x.name === c.name);
    if (!m) { m = { id: castList.length + 1, name: c.name }; castList.push(m); }
    c.id = m.id;
  }
  for (const s of scenes) s.cast.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const strips: Strip[] = scenes.map(s => ({ type: 'scene', sceneId: s.id }));
  return { castList, scenes, strips, targetEighthsPerDay: 44 };
}

/** Plain text or Fountain → positioned lines. Pages split on form feeds (pdftotext) or Fountain's ===;
 *  a script with no page marks is read as 55 lines to the page. */
export function linesFromText(text: string): { lines: ScriptLine[]; title: string } {
  let src = text.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '');
  let title = '';
  // Fountain title page: key: value lines up to the first blank line, only when the file starts that way
  if (/^[A-Za-z][\w ]*:\s*\S/.test(src)) {
    const cut = src.search(/\n\s*\n/);
    if (cut > 0 && !/^(INT|EXT|I\/E)\b/im.test(src.slice(0, cut))) {
      title = (/^title:\s*(.+)$/im.exec(src.slice(0, cut))?.[1] ?? '').trim();
      src = src.slice(cut);
    }
  }
  let pages = src.split(/\f|^={3,}\s*$/m).map(p => p.split('\n'));
  let labels: string[] | null = null;
  if (pages.length === 1) {
    // text copied out of a PDF keeps its page numbers as bare lines ("12."); when they count up, they mark the pages
    const all = pages[0];
    const marks: number[] = []; let last = 0;
    all.forEach((raw, i) => { const m = /^\s*(\d{1,3})\.?\s*$/.exec(raw); if (m && (+m[1] === last + 1 || (last === 0 && +m[1] <= 3))) { marks.push(i); last = +m[1]; } });
    if (marks.length >= 2 && last >= marks.length) {
      pages = []; labels = [];
      let start = 0, n = 1;
      for (const mi of marks) {
        if (mi > start) { pages.push(all.slice(start, mi)); labels.push(String(n)); }
        start = mi; n = +(/(\d+)/.exec(all[mi])![1]);
      }
      pages.push(all.slice(start)); labels.push(String(n));
    } else if (all.length > 70) {
      pages = [];
      for (let i = 0; i < all.length; i += 55) pages.push(all.slice(i, i + 55));
    }
  }
  const out: ScriptLine[] = [];
  pages.forEach((lines, pi) => {
    const n = Math.max(lines.length, 1);
    lines.forEach((raw, li) => {
      const indent = raw.length - raw.trimStart().length;
      out.push({ text: raw.trim(), pos: pi + li / n, indent, page: labels ? labels[pi] : String(pi + 1) });
    });
  });
  return { lines: out, title };
}

export function parseScreenplayText(text: string): ScreenplayImport {
  const { lines, title } = linesFromText(text);
  return parseScreenplayLines(lines, { cueIndent: 10, title });
}

/** @param opts.cueIndent how much further in than action a character cue sits, in the lines' indent units.
 *  When the text carries no indentation at all (Fountain), cues are found by shape instead: an all-caps line
 *  preceded by a blank line and followed by dialogue. */
export function parseScreenplayLines(lines: ScriptLine[], opts: { cueIndent: number; title?: string }): ScreenplayImport {
  const warnings: string[] = [];
  const nonEmpty = lines.filter(l => l.text);
  const indents = nonEmpty.map(l => l.indent);
  const hasIndent = indents.some(i => i > 0);
  // action indent = the most common indent of longer lines
  const freq = new Map<number, number>();
  for (const l of nonEmpty) if (l.text.length > 30) freq.set(l.indent, (freq.get(l.indent) ?? 0) + 1);
  const actionIndent = hasIndent ? [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? Math.min(...nonEmpty.filter(l => !NOISE.test(l.text)).map(l => l.indent)) : 0;
  // text copied out of a PDF loses both indentation and blank lines; then a cue is any short all-caps line with
  // dialogue under it, and dialogue runs until a line too long to be dialogue (the dialogue column is ~35 chars)
  const dense = !hasIndent && lines.length > 20 && (lines.length - nonEmpty.length) / lines.length < 0.08;
  const DIALOGUE_MAX = 42;

  // title: the first real line before the first heading, if it's short and not a key: value
  let title = opts.title ?? '';
  const firstHeading = lines.findIndex(l => headingOf(l.text, hasIndent ? l.indent <= actionIndent + opts.cueIndent : true));
  if (!title) for (const l of lines.slice(0, firstHeading < 0 ? 0 : firstHeading)) {
    const t = l.text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
    if (t && t.length <= 60 && !/:\s/.test(t) && !/^(by|written by|draft|revised|copyright|©|\(c\))/i.test(t) && !NOISE.test(t) && !TRANSITION.test(t)) { title = t.replace(/^(title:)\s*/i, ''); break; }
  }

  const scenes: Scene[] = [];
  let cur: Scene | null = null;
  let curStart = 0, curEnd = 0;
  let mode: 'action' | 'dialogue' = 'action';
  const actionText: string[][] = [];   // per scene, the action lines, for finding silent cast later
  const LINE = 1 / 55;
  const close = () => { if (cur) cur.eighths = Math.max(1, Math.round((curEnd + LINE - curStart) * 8)); };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.text;
    if (!t) { mode = 'action'; continue; }
    if (NOISE.test(t)) continue;
    const h = headingOf(t, hasIndent ? l.indent <= actionIndent + opts.cueIndent : true);
    if (h) {
      close();
      const n = scenes.length + 1;
      cur = { id: `sc${n}`, number: h.number || String(n), ie: h.ie, set: h.set, tod: h.tod, pages: l.page, eighths: 1, synopsis: '', location: '', scriptDay: '', cast: [], elements: {} };
      scenes.push(cur); actionText.push([]);
      curStart = l.pos; curEnd = l.pos; mode = 'action';
      continue;
    }
    if (!cur) continue;                       // title page, FADE IN, anything before scene 1
    curEnd = l.pos;
    if (l.page !== cur.pages.split('-').pop()) cur.pages = `${cur.pages.split('-')[0]}-${l.page}`;
    if (TRANSITION.test(t) || /^>/.test(t)) { mode = 'action'; continue; }
    const next = lines[i + 1];
    const prevBlank = i === 0 || !lines[i - 1].text;
    const forcedCue = /^@/.test(t);
    const forcedAction = /^!/.test(t);
    const nextIsDialogue = !!next?.text && !headingOf(next.text, true) && !TRANSITION.test(next.text) && (!hasIndent || next.indent < l.indent - opts.cueIndent / 2 || /^\(/.test(next.text));
    const cueByIndent = hasIndent && l.indent >= actionIndent + opts.cueIndent && looksLikeCue(t, false) && nextIsDialogue;
    const cueByShape = !hasIndent && (prevBlank || dense) && looksLikeCue(t) && nextIsDialogue && !(dense && isCaps(next?.text ?? '') && !/^\(/.test(next?.text ?? ''));
    if (!forcedAction && (forcedCue || cueByIndent || cueByShape)) {
      for (const name of cleanCue(t.replace(/^@/, '')).split(CAST_SPLIT).map(s => s.trim()).filter(Boolean)) {
        if (name.length >= 2 && !GROUP.test(name) && !cur.cast.some(c => c.name === name)) cur.cast.push({ name });
      }
      mode = 'dialogue';
      continue;
    }
    if (mode === 'dialogue' && dense && t.length > DIALOGUE_MAX && !/^\(/.test(t)) mode = 'action';
    if (mode === 'dialogue') continue;        // dialogue and parentheticals, until the next blank line
    if (/^[#=~]/.test(t)) continue;           // Fountain sections, synopses, lyrics
    const a = t.replace(/^!/, '');
    actionText[scenes.length - 1].push(a);
    if (!cur.synopsis && !NOT_CUE.test(a)) cur.synopsis = a.length > 120 ? a.slice(0, 117) + '...' : a;
  }
  close();

  // silent cast: a speaking character named in a scene's action, in CAPS (an introduction) or in Title Case
  // ("Lena floats on her back"). A name right after of / from / about, or with 's on it, is a mention,
  // not a presence ("a photo of Addison", "a text from Cathy", "Pete's name on the screen"), and lower-case
  // words never count, so KID doesn't match "a kid on a bike".
  const names = new Set<string>();
  for (const s of scenes) for (const c of s.cast) if (c.name.length >= 3 && !GROUP_NOUN.test(c.name)) names.add(c.name);
  const titleCase = (n: string) => n.toLowerCase().replace(/(^|[\s'-])(\w)/g, (_, a, b) => a + b.toUpperCase());
  scenes.forEach((s, i) => {
    const text = actionText[i].join(' ');
    for (const name of names) {
      if (s.cast.some(c => c.name === name)) continue;
      const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const caps = new RegExp(`(^|[^A-Za-z])${esc(name)}(?=$|[^A-Za-z])`).test(text);
      const present = new RegExp(`(?<!\\b(?:of|from|about) )(?<![A-Za-z])${esc(titleCase(name))}(?![A-Za-z]|['’]s)`).test(text);
      if (caps || present) s.cast.push({ name });
    }
  });

  const lastPos = nonEmpty.length ? nonEmpty[nonEmpty.length - 1].pos : 0;
  const pages = Math.max(1, Math.ceil(lastPos + 0.01));
  if (!scenes.length) warnings.push('No scene headings found (lines starting INT. or EXT.)');
  return { board: finishBoard(scenes), title, pages, warnings };
}

function headingOf(text: string, allowed: boolean): { ie: Scene['ie']; set: string; tod: string; number: string } | null {
  if (!allowed) return null;
  let t = text.trim();
  let forced = false;
  if (/^\.[^.\s]/.test(t)) { forced = true; t = t.slice(1); }
  const m = HEADING.exec(t);
  if (!m && !forced) return null;
  const ieRaw = (m?.[2] ?? '').replace(/[.\s]/g, '').toUpperCase();
  const forcedNumber = forced ? /#([\w.-]+)#\s*$/.exec(t)?.[1] ?? '' : '';
  const rest = plain(m ? m[3] : t).replace(/\s*#[\w.-]+#\s*$/, '').trim().toUpperCase();
  const parts = rest.split(/\s+[-–—]+\s+/);
  let tod = '';
  if (parts.length > 1 && TOD.test(parts[parts.length - 1])) tod = parts.pop()!.trim();
  return { ie: ieRaw === 'INT' ? 'INT' : ieRaw === 'EXT' ? 'EXT' : ieRaw ? 'I/E' : 'INT', set: parts.join(' - ').trim(), tod, number: (m?.[1] ?? m?.[4] ?? m?.[5] ?? forcedNumber).toUpperCase() };
}
