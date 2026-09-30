// Script breakdown: the categories a stripboard tags a scene with (the Movie Magic / Shamel set, so a .sex board
// and a tagged script speak the same language), a first-pass auto-tagger that reads the scene text, and the
// small edits the tagger panel makes. Tags live in scene.elements[category] as plain strings.
import type { Board, Scene } from './types';

export const BREAKDOWN_CATEGORIES = [
  { key: 'Extras', color: '#7a6a3a' },
  { key: 'Stunts', color: '#b3402a' },
  { key: 'Vehicles', color: '#2f5f8f' },
  { key: 'Props', color: '#a0522d' },
  { key: 'Animals', color: '#4f7d2b' },
  { key: 'Wardrobe', color: '#8a2d7a' },
  { key: 'Makeup/Hair', color: '#b0446b' },
  { key: 'Set Dressing', color: '#7a5a1e' },
  { key: 'Greenery', color: '#3d7a3d' },
  { key: 'Special Effects', color: '#cc6d1f' },
  { key: 'Visual Effects', color: '#4b3fa8' },
  { key: 'Sound', color: '#2a7f7c' },
  { key: 'Music', color: '#5b2a86' },
  { key: 'Special Equipment', color: '#4a4a5a' },
  { key: 'Security', color: '#5a5a5a' },
  { key: 'Additional Labor', color: '#6b6b4a' },
  { key: 'Notes', color: '#6d6d6d' },
] as const;
export type BreakdownCategory = typeof BREAKDOWN_CATEGORIES[number]['key'];
export const categoryColor = (key: string) => BREAKDOWN_CATEGORIES.find(c => c.key === key)?.color ?? '#888';

const STOP = /^(a|an|the|her|his|their|its|our|my|your|of|in|on|at|to|from|with|and|or|some|one|two|three|several|another|each|this|that|these|those|same|own|is|are|was|be|has|have|no|not|without|then|also|still|just|very|too|so|all|other|actual|nearby|up|down|out|off|into|onto|over|back|there|here|now|as|like|for|by|about|while|when|where|who|which|what|it|he|she|they|we|you|i)$/i;
const VERB = /^(grabs?|grabbed|sits?|sat|sitting|shoves?|trips?|falls?|slips?|takes?|took|puts?|pulls?|picks?|opens?|closes?|holds?|hands?|gives?|wears?|wearing|gets?|got|comes?|goes?|went|walks?|runs?|looks?|stares?|stands?|leans?|drops?|throws?|kicks?|pours?|drinks?|eats?|reads?|writes?|types?|hangs?|finds?|found|sees?|saw|hears?|plays?|presses?|taps?|checks?|digs?|fishes|snaps?|carries|carry|brings?|wants?|needs?|loves?|likes?|makes?|made|uses?|shows?|watches|watch|entertain|tosses|toss|sets?|places?|loads?|removes?|clips?|unclips|dressed|steers|pushes|push|rides?|scoops?|buries|bury|examines|rubs?|plucks?|leaves?|passes|slides?|crosses|answers?|hugs?|kisses|smiles?|laughs?|cries|sighs?|nods?|shakes?|turns?|heads?|wanders?|sips?|swigs?|clinks?|swings?|does|do|did|has|have|had|is|are|was|were|be|been|being|meet|meets)$/i;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The word or two of description before a keyword: "beat-up little green car" → "little green car". */
function phraseBefore(text: string, at: number, keyword: string, max = 2): string {
  const before = text.slice(0, at).split(/\s+/).filter(Boolean);
  const words: string[] = [];
  for (let i = before.length - 1; i >= 0 && words.length < max; i--) {
    const w = before[i].replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
    if (!w || STOP.test(w) || VERB.test(w) || /[.!?,;:]$/.test(before[i]) || /^[A-Z]/.test(w)) break;   // stop at names, verbs, sentence starts
    if (!/^[a-z0-9'-]+$/i.test(w)) break;
    words.unshift(w);
  }
  return [...words, keyword].join(' ');
}

interface Rule { cat: BreakdownCategory; re: RegExp; label?: (m: RegExpExecArray, text: string) => string }
const kw = (words: string) => new RegExp(`(?<![\\w-])(${words})(?![\\w-])`, 'gi');
/** The sentence a match sits in, for stunts, where the whole beat is the tag. */
const sentenceAt = (text: string, at: number) => {
  let a = at, b = at;
  while (a > 0 && !(/[.!?]/.test(text[a - 1]) && /\s/.test(text[a]))) a--;
  while (b < text.length && !/[.!?]/.test(text[b])) b++;
  const s = text.slice(a, b).replace(/\s+/g, ' ').trim();
  return s.length > 72 ? s.slice(0, 69) + '...' : s;
};
const negated = (text: string, at: number) => /\b(no|without|never)\s+(\w+\s+)?$/i.test(text.slice(Math.max(0, at - 20), at));
const RULES: Rule[] = [
  { cat: 'Vehicles', re: kw("station wagon|wagon|muscle car|sports car|pickup truck|pick-up|electric SUV|SUV|car|cars|truck|van|bus|taxi|cab|motorcycle|motorbike|scooter|bicycle|bike|flatbed|ambulance|limo|limousine|jeep|convertible|sedan|trailer|RV|boat|plane|helicopter|train|subway|golf cart|tractor"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].toLowerCase() === 'suv' ? 'SUV' : m[0].toLowerCase())) },
  { cat: 'Animals', re: kw("cat|kitten|kitty|tabby|dog|puppy|horse|horses|bird|birds|parrot|snake|rat|mouse|rabbit|cow|cows|goat|chicken|chickens|pigeon|pigeons|fish|hamster|ferret|donkey|deer"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].toLowerCase(), 1)) },
  { cat: 'Extras', re: kw("patrons|guests|crowd|couples|passersby|passers-by|pedestrians|customers|diners|shoppers|neighbors|partygoers|party-goers|onlookers|commuters|tourists|students|waiters|waitresses|bartenders|nurses|cops|officers|paramedics|reporters|photographers|fans|audience|mourners|congregation|family and friends|friends and family|movie patrons|groups of friends|eight men and women|men and women|the whole family|kids|children|extras"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].toLowerCase(), 2)) },
  { cat: 'Sound', re: /\b(SOUND[S]? OF [A-Z ,'&-]+|KNOCK(?:, KNOCK)*[,!.]?|RINGS|RING|CHIRPS|CHIRP|DINGS|DING|HONKS|HONK|MEOWS|MEOW|PURRS?|SNORE|BUZZES|BUZZ|SIREN|ALARM|CRASH|BANG|GUNSHOT|THUNDER|CHEERING|APPLAUSE|POPPERS|CLICKING|CLINKS?|SLAMMING SHUT|SLAMS|DOORBELL|BELL|WHISTLE|FOOTSTEPS|SCREECH|EXPLOSION|VIBRATES)\b/g, label: m => cap(m[0].replace(/[,!.]+$/, '').toLowerCase()) },
  { cat: 'Music', re: kw("jazz music|classic jazz|jazz song|jazz record|jazz|music|song|record player|turntable|vinyl|radio|band|accordion|guitar|piano|drums|bodhran|bordhran|karaoke|playlist|singing|sings"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].toLowerCase(), 2)) },
  { cat: 'Special Effects', re: kw("snow|fake snow|flurry|fireworks|rain|fire pit|fire|smoke|fog|explosion|sparks|wind machine|bubbles|steam|breath in the cold"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].toLowerCase(), 1)) },
  { cat: 'Visual Effects', re: /^(?:ON (?:CARD|SCREEN|PHONE|LETTER|NOTE|PAGE|TV|MONITOR|LAPTOP|IPAD)|TITLE GFX|SUPER|CHYRON)\b/gm, label: m => cap(m[0].toLowerCase()) + ' insert' },
  { cat: 'Visual Effects', re: kw("text message|text messages|bumble text|notification|face-?time|facetime|instagram|social media|doom scrolls|googles|missed calls|posts?|texts"), label: m => 'phone screen: ' + m[0].toLowerCase() },
  { cat: 'Stunts', re: kw("trips|tackle|tackles|fight|fights|punch|punches|crash|crashes|swerves|jumps off|leaps|slides down|collapses|tumbles|wrestles|throws a punch|face-plants|falls to the|falls off|falls down|falls back|rolls twice|hit by|slams into"), label: (m, t) => sentenceAt(t, m.index) },
  { cat: 'Wardrobe', re: kw("hoodie|jeans|converse|dress|heels|coat|jacket|uniform|suspenders|beanie|pajamas|boxers|wig|costume|hat|santa hat|glasses|sunglasses|headphones|helmet|helmets|turkey crown|apron|robe|gown|tuxedo|suit|scarf|gloves|boots|sneakers|socks|unicorn socks|blindfold|handkerchief|name tag|goalie uniform|cap|lip ring"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].toLowerCase(), 2)) },
  { cat: 'Makeup/Hair', re: kw("makeup|mascara|eyelash curler|eyelashes|lipstick|hair has been cut|hair cut|haircut|styled|sunburn|whiskers|tattoos?|sharpie tattoos|blood|bruise|wound|scar|puffy eyes|tears|beard|mustache"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].toLowerCase(), 1)) },
  { cat: 'Set Dressing', re: kw("decorations|christmas tree|christmas lights|cards hang|poster|photographs|photos|knickknacks|shelves|emmy|cork boards|neon sign|paraphernalia|sectional couch|couch|sofa|bar stool|cat tree|fire pit|plaque|bench|window unit|lamp|marquee|mailbox|turntable|desk|island|patio chair|pull-out couch|mirror|full-length mirror"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].toLowerCase(), 2)) },
  { cat: 'Greenery', re: kw("plants|trees|garden|flowers|hedge|lawn|bushes|palm|cactus|wreath|christmas tree branch"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].toLowerCase(), 1)) },
  { cat: 'Props', re: kw("cell ?phone|cellphone|phone|iPad|laptop|computer|typewriter|3X3 cards?|cards?|envelope|letter|letters|book|books|bottle of bourbon|bourbon|tumbler|tumblers|glass|glasses of|wine|beer|coffee|pie|banana bread|cookies|ice cream|turkey|joint|joints|pill bottle|keys|bag|messenger bag|weekender bag|purse|remote control|remote|script|script pages|menu|menus|urn|urns|photo album|photograph|picture|map|long board|longboard|skateboard|tweezers|ring box|ring|handkerchief|note|clown wig|clown nose|clown dress|dish towel|shopping bags|beauty products|makeup remover|makeup mirror|recipe|metal box|spoon|carton|stamp|stamps|file boxes|storage box|record|records|chopsticks|sushi|drinks|beer|tea|cup|mic|microphone|sound board|headphones|eyelash curler|mascara|\\$20|twenty|cash|wallet|newspaper|flashlight|helmet|helmets|santa hat|blindfold"), label: (m, t) => cap(phraseBefore(t, m.index, m[0].replace(/\s+/g, ' ').toLowerCase(), 2)) },
  { cat: 'Special Equipment', re: kw("car mount|process trailer|steadicam|drone|crane|dolly|jib|underwater|ski|skate rig|tow rig|rain tower"), label: m => cap(m[0].toLowerCase()) },
];

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s'"]+|[\s'".,;:!?]+$/g, '').replace(/^(a|an|the) /i, '').trim();
const norm = (s: string) => s.toLowerCase().replace(/\b\w+['’]s /g, '').replace(/\bcell ?phone\b/g, 'phone').replace(/\bcellphone\b/g, 'phone').replace(/\s+/g, ' ').trim();
const same = (a: string, b: string) => norm(a) === norm(b);

/** A first pass at the breakdown from the scene text: what an AD would circle on the first read. Existing tags
 *  are kept; new ones are added. Honest about what it is: keywords and screenplay conventions (a CAPS phrase in
 *  action is a prop, a sound or a person), so it over-tags a little and misses what the writer didn't name. */
export function autoTag(scene: Scene, castNames: string[] = []): Record<string, string[]> {
  const out: Record<string, string[]> = Object.fromEntries(Object.entries(scene.elements).map(([k, v]) => [k, [...v]]));
  const add = (cat: string, item: string) => {
    const it = clean(item);
    if (it.length < 2 || it.length > 80) return;
    const list = (out[cat] ??= []);
    const n = norm(it), nw = n.split(' ');
    for (let i = 0; i < list.length; i++) {
      const x = norm(list[i]), xw = x.split(' ');
      if (x === n || x.endsWith(' ' + n)) return;                                  // already there, or a longer phrase has it
      if (n.endsWith(' ' + x)) { list[i] = it; return; }                           // the new phrase is the longer one
      // overlap: "orange tabby" + "tabby cat" → "orange tabby cat"
      for (let k = Math.min(xw.length, nw.length) - 1; k >= 1; k--) {
        if (xw.slice(-k).join(' ') === nw.slice(0, k).join(' ')) { list[i] = cap([...xw, ...nw.slice(k)].join(' ')); return; }
        if (nw.slice(-k).join(' ') === xw.slice(0, k).join(' ')) { list[i] = cap([...nw, ...xw.slice(k)].join(' ')); return; }
      }
    }
    list.push(it);
  };
  const text = scene.text ?? scene.synopsis ?? '';
  if (!text) return out;
  // only action lines (scene text keeps cues and dialogue indented): people talk about things that aren't on set
  const action = text.split('\n').filter(l => l && !/^\s/.test(l)).join('\n');
  const cast = new Set(castNames.map(n => n.toUpperCase()));
  // what's written on cards, screens and titles is an insert, not a thing on set
  const scan = action.split('\n').filter(l => !/^(ON|AMONG|SUPER|TITLE|CHYRON|INSERT)\b/.test(l) && !/^[A-Z\s]+:/.test(l)).join('\n');

  // CAPS phrases in action: characters (skip), sounds (rule below), otherwise props or extras
  for (const m of scan.matchAll(/\b([A-Z][A-Z0-9'&-]*(?:[ -][A-Z0-9'&-]{2,}){0,4})\b/g)) {
    const p = m[1].trim().replace(/^(A|AN|THE) /, '');
    if (p.length < 3 || /^(INT|EXT|I\/E|ON|THE|AND|OF|A|AT|TO|IN|FADE|CUT|CONTINUOUS|LATER|DAY|NIGHT|MORNING|END|MONTAGE|POV|CLOSE|ANGLE|BACK|TITLE|GFX|OVER|BLACK|CARD|SCREEN|NOTE|LETTER|PAGE|MORE|CONT'D|V\.O|O\.S|O\.C)$/.test(p)) continue;
    if ([...cast].some(c => c === p || p.startsWith(c + ' ') || c.startsWith(p + ' '))) continue;
    if (/^(?:SOUND|KNOCK|RING|CHIRP|DING|HONK|MEOW|PURR|SNORE|CLICK|CLINK|SLAM|BUZZ|SIREN|ALARM|CRASH|BANG|CHEER|POPPER|VIBRAT|LOUD)/.test(p)) continue;   // sounds handled below
    if (/^(?:TEN|TWENTY|THIRTY|AN? |ONE |TWO |THREE )?(?:SECONDS?|MINUTES?|HOURS?|DAYS?|WEEKS?|MONTHS?|YEARS?) LATER$/.test(p) || /LATER$/.test(p)) continue;
    if (/^ON [A-Z]/.test(p) || /^SUPER/.test(p) || /^TITLE/.test(p)) continue;    // screen inserts, VFX rule
    if (/(PATRONS|GUESTS|CROWD|COUPLES|FRIENDS|FAMILY|MEN AND WOMEN|PEOPLE|KIDS|CHILDREN|WAITRESS|WAITER|HOSTESS|ENGINEER|EXECUTIVE|COP|OFFICER|NURSE|DRIVER|PERSON|WOMAN|MAN|GUY|GIRL|BOY|COUPLE)$/.test(p)) { add('Extras', p.toLowerCase().replace(/^(a|an|the) /, '')); continue; }
    if (/^(?:[A-Z]+ ){0,3}(?:CARD|CARDS|APP|MESSAGE|TEXT|RING|WIG|NOSE|OUTFIT|HAT|CONTROL|NOTE|HANDKERCHIEF|PHOTOS?|PHOTOGRAPHS?|DECORATIONS|PARAPHERNALIA|BOOK|POSTER|ENVELOPES?|BOTTLE|MOVIE|PICTURE|POST|CALLS|TEXT MESSAGE)$/.test(p)) add(/(PHOTOS?|PHOTOGRAPHS?|DECORATIONS|PARAPHERNALIA|POSTER)$/.test(p) ? 'Set Dressing' : /(MESSAGE|TEXT|APP|CALLS|POST)$/.test(p) ? 'Visual Effects' : 'Props', p.toLowerCase());
  }
  for (const r of RULES) {
    const src = r.cat === 'Visual Effects' ? action : scan;   // inserts are read for VFX, and for nothing else
    for (const m of src.matchAll(r.re)) { if (negated(src, m.index!)) continue; add(r.cat, r.label ? r.label(m as RegExpExecArray, src) : m[0]); }
  }
  // the heading itself
  if (/\((?:DRIVING|MOVING)\)/i.test(scene.set)) add('Special Equipment', /DRIVING/i.test(scene.set) ? 'car mount / process trailer' : 'camera car');
  if (/\((?:DRIVING)\)/i.test(scene.set)) add('Vehicles', scene.set.replace(/\s*\(.*\)/, '').toLowerCase());
  if (/FLASHBACK|DREAM|FANTASY/i.test(scene.set)) add('Notes', scene.set.match(/FLASHBACK|DREAM|FANTASY/i)![0].toLowerCase());
  if (/\bMONTAGE\b/i.test(text)) add('Notes', 'montage');
  if (/\((?:on (?:speaker|phone|iPad|speakers|FaceTime)[^)]*|V\.O\.|O\.S\.|O\.C\.)\)/i.test(text)) {
    for (const m of text.matchAll(/^([A-Z][A-Z0-9 .'#/&-]{1,38}?)\s*(?:\(CONT'D\)\s*)?\((V\.O\.|O\.S\.|O\.C\.|on [^)]*)\)/gm)) add('Notes', `${m[1].trim()} ${/^on/i.test(m[2]) ? m[2].toLowerCase() : m[2].toUpperCase()}`);
  }
  for (const k of Object.keys(out)) { out[k] = out[k].slice(0, 16); if (!out[k].length) delete out[k]; }
  return out;
}

export function autoTagBoard(board: Board): Board {
  const names = board.castList.map(c => c.name);
  return { ...board, scenes: board.scenes.map(s => ({ ...s, elements: autoTag(s, names) })) };
}

export function addElement(board: Board, sceneId: string, cat: string, item: string): Board {
  const it = clean(item); if (!it) return board;
  return { ...board, scenes: board.scenes.map(s => s.id !== sceneId ? s : { ...s, elements: { ...s.elements, [cat]: [...(s.elements[cat] ?? []).filter(x => !same(x, it)), it] } }) };
}
export function removeElement(board: Board, sceneId: string, cat: string, item: string): Board {
  return { ...board, scenes: board.scenes.map(s => {
    if (s.id !== sceneId) return s;
    const list = (s.elements[cat] ?? []).filter(x => !same(x, item));
    const elements = { ...s.elements }; if (list.length) elements[cat] = list; else delete elements[cat];
    return { ...s, elements };
  }) };
}
/** Tag a name as cast: joins the cast list if new, joins the scene. */
export function addCast(board: Board, sceneId: string, name: string): Board {
  const n = clean(name).toUpperCase(); if (!n) return board;
  let castList = board.castList; let m = castList.find(c => c.name === n);
  if (!m) { m = { id: castList.length + 1, name: n }; castList = [...castList, m]; }
  const id = m.id;
  return { ...board, castList, scenes: board.scenes.map(s => s.id !== sceneId || s.cast.some(c => c.name === n) ? s : { ...s, cast: [...s.cast, { id, name: n }].sort((a, b) => (a.id ?? 0) - (b.id ?? 0)) }) };
}
export function removeCast(board: Board, sceneId: string, name: string): Board {
  return { ...board, scenes: board.scenes.map(s => s.id !== sceneId ? s : { ...s, cast: s.cast.filter(c => c.name !== name) }) };
}
