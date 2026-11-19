// What the browser remembers about each project's copies in files: when one was last made, whether the project has
// changed since, and when the quiet reminder is due. The clock is handed in throughout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteSlot, noteDownloaded, readIndex, readSlot, saveSlot, savedProjectList, type KV } from './store';
import { COPIES_KEY, REMIND_CHANGED_AFTER, REMIND_NEVER_AFTER, REMIND_QUIET_FOR, ago, askToKeepStorage, copyState, copyWords, markOf, markOfText, noteFileCopy, noteSlotSaved, noteUntouched, quietReminder, readFileCopies, reminderFor, resetKeepAsk } from './fileCopies';
import { sampleDemo, sampleProject } from './data/seed';
import { readProjectText } from './engine/openProject';

const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); }, get length() { return m.size; }, key: i => [...m.keys()][i] ?? null }; };
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T10:00:00Z');
const at = (ms: number) => vi.setSystemTime(new Date(ms));
beforeEach(() => { vi.useFakeTimers(); at(T0); });
afterEach(() => { vi.useRealTimers(); });

describe('the mark of a project', () => {
  it('is the same for the project in memory, the text in its slot, and the project read back from the slot', () => {
    const kv = mem(), raw0 = sampleDemo();
    saveSlot('a', raw0, kv);
    expect(markOfText(kv.getItem('profitshare.project.a')!)).toBe(markOf(raw0));
    // the app only ever saves a project that has been through the reader; from then on, reading and saving again changes nothing
    const first = readSlot('a', kv); if (!first.ok) throw new Error(first.reason);
    saveSlot('a', first.project, kv);
    const mark = readFileCopies(kv).a.mark;
    expect(markOfText(kv.getItem('profitshare.project.a')!)).toBe(mark);
    const again = readSlot('a', kv);
    expect(again.ok && markOf(again.project)).toBe(mark);
    // and so does the same project coming back from a downloaded file
    const fromFile = readProjectText(JSON.stringify(first.project, null, 1));
    expect(fromFile.ok && markOf(fromFile.project)).toBe(mark);
  });
  it('does not change when a picture moves out of the slot, and does when the picture is another one', () => {
    const p = sampleProject();
    const withPic = (id: string, dataUrl: string) => ({ ...p, pitch: { ...p.pitch!, lookbook: [{ id, name: 'a', dataUrl }] } });
    expect(markOf(withPic('i1', 'data:image/png;base64,AAAA'))).toBe(markOf(withPic('i1', 'idb:i1')));
    expect(markOf(withPic('i2', 'data:image/png;base64,AAAA'))).not.toBe(markOf(withPic('i1', 'data:image/png;base64,AAAA')));
  });
  it('changes with any edit, and text that is not a project still has one', () => {
    const p = sampleProject();
    expect(markOf({ ...p, name: 'Salt Flats' })).not.toBe(markOf(p));
    expect(markOfText('{"cut off')).not.toBe(markOfText('{"cut of'));
  });
});

describe('the record kept beside the list of projects', () => {
  it('a new project has never been saved to a file; Save notes it; an edit after that shows as changed', () => {
    const kv = mem(), p = sampleProject();
    saveSlot('a', p, kv);
    expect(copyState(readFileCopies(kv).a)).toBe('never');
    expect(copyWords(readFileCopies(kv).a, T0)).toBe('Never saved to a file');

    at(T0 + DAY); noteFileCopy('a', markOf(p), kv, Date.now());
    expect(copyState(readFileCopies(kv).a)).toBe('safe');
    expect(copyWords(readFileCopies(kv).a, T0 + 4 * DAY)).toBe('Saved to a file 3 days ago');

    at(T0 + 2 * DAY); saveSlot('a', { ...p, name: 'Salt Flat II' }, kv);
    const r = readFileCopies(kv).a;
    expect(copyState(r)).toBe('changed');
    expect(r.since).toBe(new Date(T0 + 2 * DAY).toISOString());
    expect(copyWords(r, T0 + 4 * DAY)).toBe('Changed since you last saved it to a file (3 days ago)');

    // a later edit does not move the clock: it runs from the first change that is in no file
    at(T0 + 5 * DAY); saveSlot('a', { ...p, name: 'Salt Flat III' }, kv);
    expect(readFileCopies(kv).a.since).toBe(new Date(T0 + 2 * DAY).toISOString());
    // and undoing back to what the file holds is not a change at all
    saveSlot('a', p, kv);
    expect(copyState(readFileCopies(kv).a)).toBe('safe');
  });
  it('saving again with nothing changed (opening a project does this) leaves the record alone', () => {
    const kv = mem(), p = sampleProject();
    saveSlot('a', p, kv); noteFileCopy('a', markOf(p), kv, T0);
    const before = kv.getItem(COPIES_KEY);
    at(T0 + 9 * DAY); saveSlot('a', p, kv);
    expect(kv.getItem(COPIES_KEY)).toBe(before);
  });
  it('is never inside the project: the slot and the downloaded text know nothing of it', () => {
    const kv = mem(), p = sampleProject();
    saveSlot('a', p, kv); noteDownloaded('a', kv, T0);
    expect(kv.getItem('profitshare.project.a')).toBe(JSON.stringify(p));
    expect(Object.keys(readIndex(kv)[0]).sort()).toEqual(['cashBudget', 'id', 'lines', 'name', 'savedAt', 'scenes', 'shootDays', 'version']);
  });
  it('a download from the slot (download all, the crash screen) notes the project as it is saved', () => {
    const kv = mem();
    const p = sampleProject();
    saveSlot('a', p, kv);
    noteDownloaded('a', kv, T0 + DAY);
    expect(readFileCopies(kv).a).toMatchObject({ fileAt: new Date(T0 + DAY).toISOString(), fileMark: markOf(p) });
    expect(copyState(readFileCopies(kv).a)).toBe('safe');
    noteDownloaded('gone', kv, T0);   // nothing saved under that id: nothing noted
    expect(readFileCopies(kv).gone).toBeUndefined();
  });
  it('a project opened from a file is noted as held by that file', () => {
    const kv = mem(), p = sampleProject();
    saveSlot('a', p, kv); noteFileCopy('a', markOf(p), kv, T0, 'opened');
    expect(copyWords(readFileCopies(kv).a, T0 + 2 * DAY)).toBe('Opened from a file 2 days ago');
    saveSlot('a', { ...p, version: 'v9' }, kv);
    expect(copyWords(readFileCopies(kv).a, T0 + 2 * DAY)).toBe('Changed since you last opened it from a file (2 days ago)');
  });
  it('a project from before records were kept starts its clock at its last save, not today', () => {
    const kv = mem(), p = sampleProject();
    saveSlot('old', p, kv); kv.removeItem(COPIES_KEY);
    at(T0 + 30 * DAY); saveSlot('old', p, kv);
    expect(readFileCopies(kv).old.since).toBe(new Date(T0).toISOString());
  });
  it('deleting a project takes its record with it', () => {
    const kv = mem();
    saveSlot('a', sampleProject(), kv); saveSlot('b', sampleProject(), kv);
    deleteSlot('a', kv);
    expect(Object.keys(readFileCopies(kv))).toEqual(['b']);
  });
  for (const [what, text] of [['cut off', '{"a":{"mark":"x","fi'], ['a list', '[1,2]'], ['a word', '"hello"'], ['rows that are not rows', '{"a":null,"b":7,"c":{"mark":5},"d":{"mark":"m","fileAt":12}}']] as const) {
    it(`records that cannot be read (${what}) read as nothing known, and the next save starts them again`, () => {
      const kv = mem();
      saveSlot('a', sampleProject(), kv);
      kv.setItem(COPIES_KEY, text);
      const read = readFileCopies(kv);
      expect(read.a).toBeUndefined();
      if (read.d) expect(read.d).toEqual({ mark: 'm' });
      expect(copyWords(read.a, T0)).toBe('Never saved to a file');
      expect(reminderFor(read.a, T0 + 99 * DAY)).toBeNull();
      saveSlot('a', sampleProject(), kv);
      expect(copyState(readFileCopies(kv).a)).toBe('never');
    });
  }
  it('with the list of projects itself unreadable, the projects are still found and can still be noted', () => {
    const kv = mem();
    saveSlot('a', sampleProject(), kv); saveSlot('b', { ...sampleProject(), name: 'Dune Song' }, kv);
    kv.setItem('profitshare.projects', '[{"id":"a","na');
    expect(savedProjectList(kv).map(p => p.id).sort()).toEqual(['a', 'b']);
    noteDownloaded('b', kv, T0);
    expect(copyState(readFileCopies(kv).b)).toBe('safe');
  });
});

describe('how long ago, in words', () => {
  it('reads as a person would say it', () => {
    const iso = new Date(T0).toISOString();
    expect(ago(iso, T0 + 20_000)).toBe('just now');
    expect(ago(iso, T0 + 60_000)).toBe('1 minute ago');
    expect(ago(iso, T0 + 3 * 3600_000)).toBe('3 hours ago');
    expect(ago(iso, T0 + DAY)).toBe('1 day ago');
    expect(ago(iso, T0 + 90 * DAY)).toBe('3 months ago');
    expect(ago(iso, T0 + 800 * DAY)).toBe('2 years ago');
    expect(ago(iso, T0 - DAY)).toBe('just now');   // a clock that went backwards
    expect(ago('not a date', T0)).toBe('');
  });
});

describe('the reminder', () => {
  const never = (kv: KV) => { saveSlot('a', sampleProject(), kv); return () => readFileCopies(kv).a; };
  it('a project never saved to a file: quiet for two days, then the line', () => {
    const rec = never(mem());
    expect(reminderFor(rec(), T0 + REMIND_NEVER_AFTER - 1)).toBeNull();
    expect(reminderFor(rec(), T0 + REMIND_NEVER_AFTER)).toEqual({ kind: 'never', text: 'This project lives only in this browser. Save a copy to a file.' });
  });
  it('changed since its file: quiet for seven days from the first change, then the line', () => {
    const kv = mem(), p = sampleProject();
    saveSlot('a', p, kv); noteFileCopy('a', markOf(p), kv, T0);
    expect(reminderFor(readFileCopies(kv).a, T0 + 400 * DAY)).toBeNull();   // a file holds everything: never
    at(T0 + DAY); saveSlot('a', { ...p, name: 'Changed' }, kv);
    const r = readFileCopies(kv).a;
    expect(reminderFor(r, T0 + DAY + REMIND_CHANGED_AFTER - 1)).toBeNull();
    expect(reminderFor(r, T0 + DAY + REMIND_CHANGED_AFTER)).toMatchObject({ kind: 'changed', text: 'This project has changed since you last saved it to a file, 8 days ago. The changes live only in this browser. Save a copy to a file.' });
  });
  it('dismissing holds for three days, then it may come back; saving a copy ends it', () => {
    const kv = mem(), rec = never(kv), due = T0 + 3 * DAY;
    expect(reminderFor(rec(), due)).not.toBeNull();
    quietReminder('a', kv, due);
    expect(reminderFor(rec(), due + REMIND_QUIET_FOR - 1)).toBeNull();
    expect(reminderFor(rec(), due + REMIND_QUIET_FOR)).not.toBeNull();
    noteFileCopy('a', rec().mark, kv, due + REMIND_QUIET_FOR);
    expect(reminderFor(rec(), due + 50 * DAY)).toBeNull();
    expect(rec().quietUntil).toBeUndefined();
  });
  it('never for the sample nobody has touched; the first change starts its clock then, not when it was opened', () => {
    const kv = mem(), p = sampleDemo();
    saveSlot('s', p, kv); noteUntouched('s', markOf(p), kv, T0);
    expect(reminderFor(readFileCopies(kv).s, T0 + 365 * DAY)).toBeNull();
    expect(copyWords(readFileCopies(kv).s, T0)).toBe('Never saved to a file (nothing changed yet)');
    at(T0 + 10 * DAY); saveSlot('s', { ...p, name: 'My film' }, kv);
    expect(reminderFor(readFileCopies(kv).s, T0 + 10 * DAY)).toBeNull();   // no nagging on the very first edit
    expect(reminderFor(readFileCopies(kv).s, T0 + 10 * DAY + REMIND_NEVER_AFTER)).toMatchObject({ kind: 'never' });
  });
  it('nothing known, or a date that is not one: no line', () => {
    expect(reminderFor(undefined, T0)).toBeNull();
    expect(reminderFor({ mark: 'm', since: 'soon' }, T0)).toBeNull();
  });
  it('noteSlotSaved takes the clock it is given', () => {
    const kv = mem();
    noteSlotSaved('x', 'm1', kv, T0 + 5 * DAY);
    expect(readFileCopies(kv).x).toEqual({ mark: 'm1', since: new Date(T0 + 5 * DAY).toISOString() });
  });
});

describe('asking the browser to keep its store', () => {
  beforeEach(() => resetKeepAsk());
  it('asks once, remembers that it asked, and never asks again', async () => {
    const kv = mem(), persist = vi.fn(async () => true), persisted = vi.fn(async () => false);
    expect(await askToKeepStorage(kv, { persist, persisted })).toBe(true);
    expect(await askToKeepStorage(kv, { persist, persisted })).toBeNull();   // same visit
    resetKeepAsk();
    expect(await askToKeepStorage(kv, { persist, persisted })).toBeNull();   // a later visit
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it('does not ask when the store is already kept', async () => {
    const persist = vi.fn(async () => true);
    expect(await askToKeepStorage(mem(), { persist, persisted: async () => true })).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });
  it('a browser without it, or one that throws, is passed over quietly', async () => {
    expect(await askToKeepStorage(mem(), undefined)).toBeNull();
    resetKeepAsk(); expect(await askToKeepStorage(mem(), {})).toBeNull();
    resetKeepAsk(); expect(await askToKeepStorage(mem(), { persist: async () => { throw new Error('no'); } })).toBeNull();
  });
});
