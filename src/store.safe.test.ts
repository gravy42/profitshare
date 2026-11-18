// What the browser holds is outside data too: a saved project that has gone bad must be passed over with a reason and
// left exactly as it is, and a project that took the page down must not be opened again by itself.
import { describe, expect, it } from 'vitest';
import { adoptLegacy, crashBefore, crashedIds, loadSlot, noteCrash, noteDrawn, previousBoard, readIndex, readSlot, savedProjectList, savedProjectText, saveSlot, startingId, startUp, type KV } from './store';
import { blankProject, sampleDemo, sampleProject } from './data/seed';

const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } }; };
const slot = (id: string) => `profitshare.project.${id}`;
/** Two good projects and one whose saved copy has gone bad, the bad one opened last. */
function browser(bad: string) {
  const kv = mem(), tab = mem();
  saveSlot('good', sampleProject(), kv);
  saveSlot('other', blankProject({ name: 'Dune Song' }), kv);
  saveSlot('bad', { ...sampleProject(), name: 'Nine Miles' }, kv);
  kv.setItem(slot('bad'), bad);
  kv.setItem('profitshare.activeProject', 'bad'); tab.setItem('profitshare.tabProject', 'bad');
  return { kv, tab };
}

describe('a saved project that cannot be read', () => {
  const broken: [string, string, RegExp][] = [
    ['cut off', JSON.stringify(sampleProject()).slice(0, 400), /^What this browser saved for it is incomplete\.$/],
    ['no lines', JSON.stringify({ ...sampleProject(), lines: null }), /^The saved copy is missing its budget lines\.$/],
    ['a newer format', JSON.stringify({ ...sampleProject(), schemaVersion: 2 }), /^The saved copy was made by a newer version of ProfitShare \(format 2\)\. Update the app to open it\.$/],
    ['not a project', '[1,2,3]', /^The saved copy is not a ProfitShare project\.$/],
    ['a bad line', JSON.stringify({ ...sampleProject(), lines: [{ id: 'L1' }] }), /^The saved copy has a budget line that cannot be read \(number 1 in the file\)\. The trouble is with its account number\.$/],
  ];
  for (const [what, text, says] of broken) it(`${what}: skipped with a reason, and left in the browser as it is`, () => {
    const { kv, tab } = browser(text);
    const before = new Map(kv.m);
    const r = readSlot('bad', kv);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(says);
    expect(loadSlot('bad', kv)).toBeNull();
    // the tab that had it open starts on the start screen, with no project open (so autosave has nothing to write over it)
    const s = startUp(kv, tab);
    expect(s.id).toBeNull();
    expect(s.note).toMatch(/^“Nine Miles” could not be opened\. .* It has been left as it is in this browser, under Projects\.$/);
    expect(s.note).not.toMatch(/undefined|TypeError|Cannot read/);
    expect(kv.m).toEqual(before);                                  // nothing written, nothing deleted
    expect(readIndex(kv).map(m => m.id)).toEqual(['bad', 'other', 'good']);
    expect(loadSlot('good', kv)?.name).toBe('SALT FLAT');           // and the others still open
  });
  it('a saved project with one optional part gone bad opens, and says what was reset', () => {
    const kv = mem(), tab = mem();
    saveSlot('a', sampleDemo(), kv);
    const raw = JSON.parse(kv.getItem(slot('a'))!); raw.calendar = 'March'; kv.setItem(slot('a'), JSON.stringify(raw));
    const r = readSlot('a', kv);
    expect(r.ok && r.repaired).toEqual(['the calendar']);
    const s = startUp(kv, tab);
    expect(s.id).toBe('a');
    expect(s.project.calendar).toBeUndefined();
    expect(s.note).toBe('Some of this project could not be read and was left out or set back to its default: the calendar. Everything else is as it was saved.');
  });
  it('nothing saved under an id is its own answer', () => {
    expect(readSlot('nope', mem())).toEqual({ ok: false, reason: 'Nothing is saved for this project in this browser.', missing: true });
  });
  it('the old single slot is only adopted when it is a project; otherwise it stays where it is', () => {
    const kv = mem();
    kv.setItem('profitshare.project', JSON.stringify({ schemaVersion: 1 }));
    expect(adoptLegacy(kv)).toBeNull();
    expect([...kv.m.keys()]).toEqual(['profitshare.project']);      // no half-made slot left behind
    expect(startUp(kv, mem()).id).toBeNull();
  });
});

describe('the list of projects, if it has been damaged', () => {
  it('rows that are not rows are left out; missing fields are blanks', () => {
    const kv = mem();
    kv.setItem('profitshare.projects', JSON.stringify([null, 5, 'x', { name: 'no id' }, { id: 7 }, { id: 'a', name: 9, lines: 'many', cashBudget: null }, { id: 'a', name: 'twice' }, { id: 'b', name: 'Dune Song', version: 'v2', savedAt: '2026-11-01T00:00:00.000Z', shootDays: 12, lines: 40, scenes: 26, cashBudget: 1000 }]));
    expect(readIndex(kv)).toEqual([
      { id: 'a', name: 'Untitled', version: '', savedAt: '', shootDays: 0, lines: 0, scenes: 0, cashBudget: 0 },
      { id: 'b', name: 'Dune Song', version: 'v2', savedAt: '2026-11-01T00:00:00.000Z', shootDays: 12, lines: 40, scenes: 26, cashBudget: 1000 },
    ]);
    for (const junk of ['{"a":1}', '7', 'null', '"x"', '[', '']) { kv.setItem('profitshare.projects', junk); expect(readIndex(kv)).toEqual([]); }
  });
});

describe('the board kept before a replace', () => {
  it('is read only when it is a board', () => {
    const kv = mem(), board = sampleProject().board;
    kv.setItem('profitshare.previous-board', JSON.stringify({ when: '2026-11-01T00:00:00.000Z', reason: 'before salt-flat.fdx replaced it', board }));
    expect(previousBoard(kv)?.board.scenes).toHaveLength(26);
    for (const junk of ['{"board":7}', '{"board":{}}', '{"when":"2026-11-01","reason":"x","board":{"scenes":[]}}', '{"when":"x"}', '[]', 'null', '{', JSON.stringify({ when: 1, reason: 2, board: { ...board, scenes: 'none' } })]) {
      kv.setItem('profitshare.previous-board', junk);
      expect(previousBoard(kv), junk).toBeNull();
      expect(kv.getItem('profitshare.previous-board')).toBe(junk);   // passed over, not removed
    }
    kv.setItem('profitshare.previous-board', JSON.stringify({ board }));
    expect(previousBoard(kv)).toMatchObject({ when: '', reason: '' });
  });
});

describe('after the page could not be drawn', () => {
  it('the next start is the start screen, the project is still there, and it is not opened again by itself', () => {
    const kv = mem(), tab = mem();
    saveSlot('good', sampleProject(), kv);
    saveSlot('trouble', { ...sampleProject(), name: 'Nine Miles' }, kv);
    kv.setItem('profitshare.activeProject', 'trouble'); tab.setItem('profitshare.tabProject', 'trouble');
    expect(startingId(kv, tab)).toBe('trouble');
    const before = kv.getItem(slot('trouble'));

    // drawing fails while it is open (the hook records which project is being drawn; here, the tab's own record stands in)
    noteDrawn('trouble', kv, tab);
    const was = noteCrash(kv, tab);
    expect(was.name === '' || was.name === 'Nine Miles').toBe(true);
    // a reload: the start screen, with a line that says why, whichever project the hook had recorded
    expect(crashBefore(tab)).not.toBeNull();
    expect(startingId(kv, tab)).toBeNull();
    const s = startUp(kv, tab);
    expect(s.id).toBeNull();
    expect(s.note).toMatch(/^ProfitShare ran into a problem/);
    expect(s.note).toMatch(/unchanged\.$/);
    expect(kv.getItem(slot('trouble'))).toBe(before);
    expect(readIndex(kv).map(m => m.id)).toEqual(['trouble', 'good']);
    // the start screen draws: the note is used up
    noteDrawn(null, kv, tab);
    expect(crashBefore(tab)).toBeNull();
  });
  it('a project marked as having crashed is passed over on later starts, until it has drawn again', () => {
    const kv = mem(), tab = mem();
    saveSlot('good', sampleProject(), kv);
    saveSlot('trouble', { ...sampleProject(), name: 'Nine Miles' }, kv);
    kv.setItem('profitshare.activeProject', 'trouble');
    kv.setItem('profitshare.crashed', JSON.stringify(['trouble']));
    expect(crashedIds(kv)).toEqual(['trouble']);
    expect(startingId(kv, tab)).toBe('good');                      // a new tab opens the newest project that did not crash
    tab.setItem('profitshare.tabProject', 'trouble');
    expect(startingId(kv, tab)).toBe('good');
    noteDrawn('trouble', kv, tab);                                 // the user opened it from Projects and it drew
    expect(crashedIds(kv)).toEqual([]);
    expect(startingId(kv, tab)).toBe('trouble');
    for (const junk of ['7', '{', '{"a":1}', '[1,null,"x"]']) { kv.setItem('profitshare.crashed', junk); expect(crashedIds(kv).every(x => typeof x === 'string')).toBe(true); }
    kv.setItem('profitshare.crashed', JSON.stringify(['good', 'trouble']));
    expect(startingId(kv, tab)).toBeNull();                        // every project crashed: the start screen
  });
});

describe('downloading everything from the crash screen', () => {
  it('lists every saved project with a file name of its own, readable or not', async () => {
    const { kv } = browser('{"schemaVersion":1,"name":"Nine Mi');
    saveSlot('twin', sampleProject(), kv);
    const list = savedProjectList(kv);
    expect(list.map(p => p.id)).toEqual(['twin', 'bad', 'other', 'good']);
    expect(new Set(list.map(p => p.fileName)).size).toBe(4);
    expect(list.map(p => p.fileName)).toEqual(['SALT_FLAT_Draft_3.profitshare.json', 'Nine_Miles_Draft_3.profitshare.json', 'Dune_Song_v1.profitshare.json', 'SALT_FLAT_Draft_3_2.profitshare.json']);
    expect(await savedProjectText('bad', kv)).toBe('{"schemaVersion":1,"name":"Nine Mi');   // exactly what the browser holds
    const good = await savedProjectText('good', kv);
    expect(JSON.parse(good!).name).toBe('SALT FLAT');
    expect(await savedProjectText('gone', kv)).toBeNull();
    kv.setItem('profitshare.projects', '{"broken":true}');
    expect(savedProjectList(kv)).toEqual([]);
  });
});
