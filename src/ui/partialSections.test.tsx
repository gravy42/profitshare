// @vitest-environment jsdom
// "Passes the first check, breaks one tab": an optional part that is an object of the right type with its needed
// pieces missing (callSheets: { brand: true } and nothing else). Each such file must open, with the part filled out
// to its defaults, and every tab must draw. The tabs are drawn for real here, effects and all.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sampleDemo } from '../data/seed';
import { checkProject } from '../engine/openProject';
import { applyDeal, dealControlledIds, withDeal } from '../engine/deal';
import { adoptBoardDays, syncCastDaysFromBoard } from '../engine/board';
import { defaultCallSheets } from '../engine/callsheet';
import { defaultPitch } from '../engine/pitch';
import type { Project } from '../engine/types';
import { TopSheetView } from './TopSheetView';
import { PointsView } from './PointsView';
import { SagView } from './SagView';
import { IncentivesView } from './IncentivesView';
import { CalendarView } from './CalendarView';
import { BreakdownsView } from './BreakdownsView';
import { PitchView } from './PitchView';
import { CallSheetsView } from './CallSheetsView';
import { BoardView } from './BoardView';
import { DealView } from './DealView';

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
const noop = () => {};
/** Every tab drawn the way App draws it; a tab that cannot be drawn throws (there is no boundary here to hide it). */
function drawEveryTab(opened: Project): string[] {
  const raw = syncCastDaysFromBoard(adoptBoardDays(withDeal(opened))), eff = applyDeal(raw);
  const tabs: [string, React.ReactNode][] = [
    ['deal', <DealView raw={raw} eff={eff} setProject={noop} />], ['topsheet', <TopSheetView project={eff} raw={raw} controlled={dealControlledIds(raw, eff)} setProject={noop} />],
    ['board', <BoardView project={eff} raw={raw} setProject={noop} />], ['calendar', <CalendarView project={eff} setProject={noop} />], ['callsheets', <CallSheetsView project={eff} setProject={noop} />],
    ['breakdowns', <BreakdownsView project={eff} setProject={noop} />], ['points', <PointsView project={eff} setProject={noop} />], ['sag', <SagView project={eff} />],
    ['incentives', <IncentivesView project={eff} setProject={noop} />], ['pitch', <PitchView project={eff} setProject={noop} />],
  ];
  const failed: string[] = [];
  for (const [name, node] of tabs) {
    const box = document.createElement('div'); document.body.appendChild(box); const root = createRoot(box);
    try { act(() => { root.render(node); }); if (!box.innerHTML) failed.push(`${name}: drew nothing`); } catch (e) { failed.push(`${name}: ${(e as Error).message}`); }
    try { act(() => root.unmount()); } catch { /* already down */ }
    box.remove();
  }
  return failed;
}
const file = (): Record<string, any> => JSON.parse(JSON.stringify(sampleDemo()));
const open = (f: unknown) => { const r = checkProject(f); if (!r.ok) throw new Error(`refused: ${r.reason}`); return r; };

describe('an optional part with its needed pieces missing', () => {
  it('callSheets: { brand: true } opens, keeps the setting, and the Call sheets tab draws', () => {
    const r = open({ ...file(), callSheets: { brand: true } });
    expect(r.repaired).toEqual([]);                                   // nothing was unreadable; the rest was simply not there
    expect(r.project.callSheets).toEqual({ ...defaultCallSheets(), brand: true });
    expect(drawEveryTab(r.project)).toEqual([]);
  });
  it('the control: the same file taken in without the check does break the Call sheets tab, and only that one', () => {
    const failed = drawEveryTab({ ...file(), callSheets: { brand: true } } as unknown as Project);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/^callsheets: /);
  });
  const partial: [string, (f: Record<string, any>) => void, string[], (p: Project) => void][] = [
    ['callSheets: {}', f => { f.callSheets = {}; }, [], p => expect(p.callSheets).toEqual(defaultCallSheets())],
    ['a call sheet day that is {}', f => { f.callSheets = { ...defaultCallSheets(), days: { 1: {}, 2: { extras: [{}] } } }; }, ['the call sheets'], p => expect(p.callSheets!.days).toEqual({ 1: { cast: {}, depts: {} }, 2: { cast: {}, depts: {}, extras: [] } })],
    ['call sheet locations and contacts of {}', f => { f.callSheets = { brand: true, locations: [{}, { id: 'a' }], contacts: [{}] }; }, ['the call sheets'], p => { expect(p.callSheets!.locations).toEqual([{ id: 'a', name: '', sets: '', address: '', parking: '', hospital: '', notes: '' }]); expect(p.callSheets!.contacts).toEqual([{ role: '', name: '', phone: '' }]); }],
    ['calendar: {}', f => { f.calendar = {}; }, [], p => expect(p.calendar).toEqual({ from: '', to: '', workDays: [1, 2, 3, 4, 5], skipHolidays: true, events: [] })],
    ['calendar with only a first day', f => { f.calendar = { dayOne: '2027-03-08' }; }, [], p => expect(p.calendar!.dayOne).toBe('2027-03-08')],
    ['calendar events of {}', f => { f.calendar = { from: '2027-03', to: '2027-04', events: [{}, { id: 'e' }, { id: 'e2', date: '2027-03-09', kind: 'shoot' }] }; }, ['the calendar'], p => expect(p.calendar!.events).toEqual([{ id: 'e2', date: '2027-03-09', kind: 'shoot', label: '' }])],
    ['incentives: {}', f => { f.incentives = {}; }, [], p => expect(p.incentives).toEqual({})],
    ['incentives with only a switch on', f => { f.incentives = { ca: { enabled: true }, federal: { enabled: true } }; }, [], p => expect(p.incentives!.ca.enabled).toBe(true)],
    ['deal: {}', f => { f.deal = {}; }, [], p => expect(p.deal).toEqual({})],
    ['deal with only a pay model', f => { f.deal = { pay: { model: 'everyone-at-scale' } }; }, [], p => expect(withDeal(p).deal!.producers.days).toBeGreaterThan(0)],
    ['pitch: {}', f => { f.pitch = {}; }, [], p => expect(p.pitch).toEqual(defaultPitch())],
    ['pitch with only a logline', f => { f.pitch = { logline: 'A surveyor walks out onto the salt.' }; }, [], p => expect(p.pitch).toEqual({ ...defaultPitch(), logline: 'A surveyor walks out onto the salt.' })],
    ['pitch.design: {}', f => { f.pitch.design = {}; }, ['the pitch'], p => expect('design' in p.pitch!).toBe(false)],
    ['pitch.design with colours and faces only', f => { f.pitch.design = { colors: f.pitch.design.colors, fonts: f.pitch.design.fonts }; }, [], p => expect(p.pitch!.design).toMatchObject({ name: '', notes: '' })],
    ['pitch.design.deck: {}', f => { f.pitch.design.deck = {}; }, [], p => expect(p.pitch!.design!.deck).toEqual({ layout: 'split', eyebrow: false, bleed: 0.55, signoff: '' })],
    ['pitch.design.fontFiles of {}', f => { f.pitch.design.fontFiles = [{}, { id: 'f' }]; }, ['the pitch'], p => expect(p.pitch!.design!.fontFiles).toEqual([])],
    ['lookbook, research, team, comps, revenue and sections of {}', f => { for (const k of ['lookbook', 'research', 'team', 'comps', 'revenue', 'sections']) f.pitch[k] = [{}, { id: 'x' }]; }, ['the pitch'],
      p => { expect(p.pitch!.lookbook).toEqual([]); expect(p.pitch!.research).toEqual([]); expect(p.pitch!.revenue).toEqual([]); expect(p.pitch!.team).toEqual([{ id: 'x', name: '', role: '', bio: '' }]); expect(p.pitch!.sections).toEqual([{ id: 'x', heading: '', body: '' }]); expect(p.pitch!.comps).toEqual([{ id: 'x', title: '', year: '', distributor: '', budget: null, domestic: null, worldwide: null, note: '', source: '' }]); }],
    ['slides, recipients and movement of {}', f => { f.pitch.slides = [{}, { id: 's' }, { layout: 'cover' }]; f.pitch.recipients = [{}, { id: 'r' }]; f.pitch.deckMotion = {}; }, [], () => {}],
    ['pitch.audience: {}', f => { f.pitch.audience = {}; }, [], p => expect(p.pitch!.audience).toEqual({ primary: '', secondary: '', notes: '' })],
    ['locations of {}', f => { f.locations = [{}, { id: 'l', name: 'Wendover' }, { id: 'm', name: 'Knolls', days: 5, outsideLaZone: true, minWage: 16 }]; }, ['the shoot locations'], p => expect(p.locations).toEqual([{ id: 'm', name: 'Knolls', days: 5, outsideLaZone: true, minWage: 16 }])],
  ];
  for (const [name, change, repaired, check] of partial) it(`${name}: opens, and every tab draws`, () => {
    const f = file(); change(f);
    const before = JSON.stringify(f);
    const r = open(f);
    expect(r.repaired).toEqual(repaired);
    check(r.project);
    expect(JSON.stringify(f)).toBe(before);
    expect(drawEveryTab(r.project)).toEqual([]);
  });
  it('the core is different: a partial one is refused, with the reason', () => {
    const reason = (f: unknown) => { const r = checkProject(f); return r.ok ? 'OPENED' : r.reason; };
    expect(reason({ ...file(), sag: {} })).toBe('This project file cannot be opened. ProfitShare could not read its SAG-AFTRA settings (the trouble is with the target tier).');
    expect(reason({ ...file(), sag: { targetTier: 'MLB' } })).toBe('This project file cannot be opened. ProfitShare could not read its SAG-AFTRA settings (the trouble is with the Diversity in Casting setting).');
    expect(reason({ ...file(), waterfall: {} })).toBe('This project file cannot be opened. ProfitShare could not read its waterfall terms (the trouble is with the model).');
    expect(reason({ ...file(), board: {} })).toBe('This project file cannot be opened. Its stripboard is missing its scenes, strips and cast list.');
    expect(reason({ ...file(), board: { scenes: [], strips: [], castList: [] } })).toBe('This project file cannot be opened. Its stripboard is missing its pages-per-day target.');
    expect(reason({ ...file(), lines: [{}] })).toBe('This project file has a budget line that cannot be read (number 1 in the file). The trouble is with its identifier.');
    expect(reason({ ...file(), participants: [{ id: 'p', followsElements: [{ category: 'constructor', item: 'x' }] }] })).toMatch(/entry on the points schedule that cannot be read/);
  });
  it('a person who follows a tag named like something every object has loses that rule, not the file', () => {
    const f = file(); f.participants[0].followsElements = [{ category: 'constructor', item: 'x' }];
    const r = open(f);
    expect(r.repaired).toEqual(['a detail on a person in the points schedule']);
    expect('followsElements' in r.project.participants[0]).toBe(false);
    expect(drawEveryTab(r.project)).toEqual([]);
  });
});
