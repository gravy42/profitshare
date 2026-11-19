// @vitest-environment jsdom
// "Download all my projects" and the way back: what is in the .zip and what its files are called, reading it again
// within limits, several files opened at once each becoming a project of its own, and the reminder line on the page.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { allProjectsZipName, downloadAllProjects, projectsZip, readProjectsZip } from './backups';
import { readIndex, resetCrashState, saveSlot, useProject, type KV } from './store';
import { copyState, markOf, noteFileCopy, readFileCopies, resetKeepAsk } from './fileCopies';
import { readProjectText } from './engine/openProject';
import { BackupReminder } from './ui/BackupReminder';
import { StartView } from './ui/StartView';
import { blankProject, sampleProject } from './data/seed';

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); }, get length() { return m.size; }, key: i => [...m.keys()][i] ?? null }; };
const DAY = 24 * 60 * 60 * 1000;
/** Stands in for the browser's download: each file it was asked to save. */
function downloads(): { name: string; blob: Blob }[] {
  const got: { name: string; blob: Blob }[] = []; let last: Blob | null = null;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = (b: Blob) => { last = b; return 'blob:x'; };
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { got.push({ name: this.download, blob: last! }); });
  return got;
}
const bytesOf = (b: Blob) => new Promise<Uint8Array>((done, fail) => { const r = new FileReader(); r.onload = () => done(new Uint8Array(r.result as ArrayBuffer)); r.onerror = () => fail(r.error); r.readAsArrayBuffer(b); });
let root: Root | null = null; let box: HTMLElement | null = null;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetCrashState(); resetKeepAsk(); });
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.restoreAllMocks(); });
const draw = (node: React.ReactNode): HTMLElement => { box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); act(() => { root!.render(node); }); return box; };
const button = (el: HTMLElement, name: string) => [...el.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent) === name)!;

describe('the .zip of every project', () => {
  it('holds each project as its own file, readable as the project it was', () => {
    const a = sampleProject(), b = { ...blankProject({ name: 'Dune Song' }), version: 'v2' };
    const zip = projectsZip([{ name: 'Salt_Flat.profitshare.json', text: JSON.stringify(a) }, { name: 'Dune_Song_v2.profitshare.json', text: JSON.stringify(b) }], new Date(2026, 10, 18));
    const inside = unzipSync(zip);
    expect(Object.keys(inside)).toEqual(['Salt_Flat.profitshare.json', 'Dune_Song_v2.profitshare.json']);
    expect(JSON.parse(strFromU8(inside['Dune_Song_v2.profitshare.json']))).toEqual(JSON.parse(JSON.stringify(b)));
    const r = readProjectText(strFromU8(inside['Salt_Flat.profitshare.json']));
    expect(r.ok && r.project.name).toBe(a.name);
  });
  it('never writes a folder or two files of one name, whatever it is handed', () => {
    const zip = projectsZip([{ name: '../up/evil.profitshare.json', text: '{}' }, { name: 'Same.profitshare.json', text: '1' }, { name: 'same.profitshare.json', text: '2' }, { name: '', text: '3' }]);
    const names = Object.keys(unzipSync(zip));
    expect(names).toEqual(['_up_evil.profitshare.json', 'Same.profitshare.json', 'same_2.profitshare.json', 'project.profitshare.json']);
    expect(names.every(n => !/[\\/]/.test(n))).toBe(true);
  });
  it('is named for the day it was made', () => {
    expect(allProjectsZipName(new Date(2026, 0, 5))).toBe('ProfitShare-projects-2026-01-05.zip');
  });
  it('reads back: project files only, from folders too, and nothing a computer adds on its own', () => {
    const zip = zipSync({ 'a.profitshare.json': strToU8('{"a":1}'), 'folder/b.json': strToU8('{"b":2}'), 'notes.txt': strToU8('hello'), '__MACOSX/._a.profitshare.json': strToU8('junk.json'), '.hidden.json': strToU8('{}') });
    expect(readProjectsZip(zip)).toEqual([{ name: 'a.profitshare.json', text: '{"a":1}' }, { name: 'b.json', text: '{"b":2}' }]);
  });
  it('refuses, in plain words, a file that is not a .zip and one that holds too much', () => {
    expect(() => readProjectsZip(strToU8('this is not a zip'))).toThrow('This .zip could not be read. It may be damaged, or locked with a password.');
    const zip = zipSync({ 'a.json': strToU8('x'.repeat(5000)), 'b.json': strToU8('y'.repeat(5000)), 'c.json': strToU8('z') });
    expect(() => readProjectsZip(zip, { files: 2, fileBytes: 1e6, totalBytes: 1e6 })).toThrow(/more than ProfitShare will unpack/);
    expect(() => readProjectsZip(zip, { files: 9, fileBytes: 4000, totalBytes: 1e6 })).toThrow(/more than ProfitShare will unpack/);
    expect(() => readProjectsZip(zip, { files: 9, fileBytes: 1e6, totalBytes: 9000 })).toThrow(/more than ProfitShare will unpack/);
    expect(readProjectsZip(zip, { files: 3, fileBytes: 5000, totalBytes: 10001 })).toHaveLength(3);
  });
});

describe('Download all my projects', () => {
  it('several projects: one .zip, safe and unique names, each noted as saved to a file', async () => {
    const kv = mem(), got = downloads(), now = new Date(2026, 10, 18, 9, 0);
    saveSlot('a', sampleProject(), kv);
    saveSlot('b', { ...sampleProject(), name: 'Nine Miles / Draft: "2"', version: 'v2' }, kv);
    saveSlot('c', sampleProject(), kv);
    const r = await downloadAllProjects(kv, now);
    expect(r).toMatchObject({ count: 3, fileName: 'ProfitShare-projects-2026-11-18.zip' });
    expect(r.said).toBe('3 projects downloaded in ProfitShare-projects-2026-11-18.zip. Look in your Downloads folder, and keep it somewhere safe.');
    expect(got.map(g => g.name)).toEqual(['ProfitShare-projects-2026-11-18.zip']);
    const inside = readProjectsZip(await bytesOf(got[0].blob));
    const names = inside.map(f => f.name);
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(3);
    expect(names.every(n => /^[\w-]+\.profitshare\.json$/.test(n))).toBe(true);
    expect(names).toContain('Nine_Miles_Draft_2__v2.profitshare.json');
    for (const f of inside) expect(readProjectText(f.text).ok).toBe(true);
    expect(['a', 'b', 'c'].map(id => copyState(readFileCopies(kv)[id]))).toEqual(['safe', 'safe', 'safe']);
    expect(readFileCopies(kv).a.fileAt).toBe(now.toISOString());
  });
  it('one project: just its file', async () => {
    const kv = mem(), got = downloads();
    saveSlot('a', sampleProject(), kv);
    const r = await downloadAllProjects(kv, new Date(2026, 10, 18));
    expect(got.map(g => g.name)).toEqual([r.fileName]);
    expect(r.fileName).toMatch(/\.profitshare\.json$/);
    expect(readProjectText(strFromU8(await bytesOf(got[0].blob))).ok).toBe(true);
  });
  it('a saved copy that cannot be read goes in exactly as it is; an unreadable list still finds every project', async () => {
    const kv = mem(), got = downloads();
    saveSlot('a', sampleProject(), kv); saveSlot('b', { ...sampleProject(), name: 'Dune Song' }, kv);
    kv.setItem('profitshare.project.b', '{"name":"Dune Song","lines":[{"cut');
    kv.setItem('profitshare.projects', 'not a list');
    const r = await downloadAllProjects(kv, new Date(2026, 10, 18));
    expect(r.count).toBe(2);
    const inside = readProjectsZip(await bytesOf(got[0].blob));
    expect(inside.map(f => f.text)).toContain('{"name":"Dune Song","lines":[{"cut');
  });
  it('nothing saved: nothing downloaded, and it says so', async () => {
    const got = downloads();
    expect((await downloadAllProjects(mem())).said).toBe('There was nothing to download.');
    expect(got).toEqual([]);
  });
  it('the button in the Projects panel downloads, says where it went, and the table says what is in a file', async () => {
    const got = downloads();
    saveSlot('a', sampleProject()); saveSlot('b', { ...sampleProject(), name: 'Dune Song' });
    const noop = () => {}; let now = Date.now();
    const view = () => <StartView onBlank={noop} onImportBudget={noop} onOpen={noop} onSample={noop} onScript={noop} starter={{ tier: 'MLB', rates: 'ballpark', pagesPerDay: 5, crew: 'lean', dayHours: 12 }} setStarter={noop}
      projects={readIndex()} activeId="a" onOpenProject={noop} onDeleteProject={noop} copies={readFileCopies(localStorage)} onCopiesChanged={() => act(() => root!.render(view()))} now={() => now} />;
    const el = draw(view());
    expect([...el.querySelectorAll('td.filecopy')].map(td => td.textContent)).toEqual(['Never saved to a file', 'Never saved to a file']);
    expect(el.textContent).toContain('a file you save is the copy that is safe');
    await act(async () => { button(el, 'Download all my projects').click(); await new Promise(r => setTimeout(r, 20)); });
    expect(got).toHaveLength(1);
    expect(el.querySelector('.backup-said')!.textContent).toMatch(/^2 projects downloaded in ProfitShare-projects-/);
    now += 3 * DAY; act(() => root!.render(view()));
    expect([...el.querySelectorAll('td.filecopy')].map(td => td.textContent)).toEqual(['Saved to a file 3 days ago', 'Saved to a file 3 days ago']);
  });
});

describe('opening several project files at once', () => {
  it('each becomes a project of its own; nothing already in the browser is written over', () => {
    saveSlot('mine', { ...sampleProject(), name: 'Already Here' });
    localStorage.setItem('profitshare.activeProject', 'mine');
    const before = localStorage.getItem('profitshare.project.mine');
    let api: ReturnType<typeof useProject> | null = null;
    function Probe() { api = useProject(); return <div id="open">{api.project.name}</div>; }
    const el = draw(<Probe />);
    // the same file twice and another: three files, as the Open dialog or a .zip hands them over
    const files = [sampleProject(), sampleProject(), { ...sampleProject(), name: 'Dune Song' }].map(p => readProjectText(JSON.stringify(p)));
    act(() => { for (const f of files) if (f.ok) api!.replace(f.project, 'file'); });
    const list = readIndex();
    expect(list).toHaveLength(4);
    expect(new Set(list.map(m => m.id)).size).toBe(4);
    expect(list.map(m => m.name).sort()).toEqual(['Already Here', 'Dune Song', sampleProject().name, sampleProject().name].sort());
    expect(localStorage.getItem('profitshare.project.mine')).toBe(before);
    expect(el.querySelector('#open')!.textContent).toBe('Dune Song');
    // each is noted as held by the file it came from; the one that was here already is not
    const copies = readFileCopies(localStorage);
    expect(list.filter(m => m.id !== 'mine').every(m => copies[m.id].from === 'opened' && copyState(copies[m.id]) === 'safe')).toBe(true);
    expect(copyState(copies.mine)).toBe('never');
  });
  it('Save from the hook downloads the open project and notes it', () => {
    const got = downloads();
    saveSlot('mine', sampleProject()); localStorage.setItem('profitshare.activeProject', 'mine');
    let api: ReturnType<typeof useProject> | null = null;
    function Probe() { api = useProject(); return <div>{copyState(api.copies.mine)}</div>; }
    const el = draw(<Probe />);
    expect(el.textContent).toBe('never');
    act(() => api!.saveToFile());
    expect(got).toHaveLength(1);
    expect(el.textContent).toBe('safe');
  });
});

describe('the reminder line', () => {
  const T0 = Date.parse('2026-11-01T10:00:00Z');
  it('is not there while the project is young, appears when it is due, and its buttons do what they say', () => {
    const copy = { mark: 'm', since: new Date(T0).toISOString() };
    const save = vi.fn(), dismiss = vi.fn(); let now = T0 + DAY;
    const line = () => <BackupReminder copy={copy} onSave={save} onDismiss={dismiss} now={() => now} />;
    const el = draw(line());
    expect(el.textContent).toBe('');
    now = T0 + 2 * DAY; act(() => root!.render(line()));
    expect(el.querySelector('.backup-reminder span')!.textContent).toBe('This project lives only in this browser. Save a copy to a file.');
    act(() => button(el, 'Save a copy').click()); expect(save).toHaveBeenCalledTimes(1);
    act(() => button(el, 'Dismiss this reminder for a few days').click()); expect(dismiss).toHaveBeenCalledTimes(1);
  });
  it('dismissed through the hook, it stays away; and it never shows for a file-held project', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(T0));
    try {
      saveSlot('mine', sampleProject()); localStorage.setItem('profitshare.activeProject', 'mine');
      vi.setSystemTime(new Date(T0 + 5 * DAY));
      let api: ReturnType<typeof useProject> | null = null;
      function Probe() { api = useProject(); return <BackupReminder copy={api.copies[api.activeId!]} onSave={api.saveToFile} onDismiss={api.quietBackupReminder} />; }
      const el = draw(<Probe />);
      expect(el.querySelector('.backup-reminder')).not.toBeNull();
      act(() => button(el, 'Dismiss this reminder for a few days').click());
      expect(el.querySelector('.backup-reminder')).toBeNull();
      act(() => { noteFileCopy('mine', markOf(sampleProject()), localStorage, Date.now()); api!.refreshCopies(); });
      vi.setSystemTime(new Date(T0 + 60 * DAY)); act(() => api!.refreshCopies());
      expect(el.querySelector('.backup-reminder')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
