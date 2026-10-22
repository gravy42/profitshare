import { describe, it, expect } from 'vitest';
import { sampleProject } from '../data/seed';
import { buildSheet, castStatus, departmentOf, locationFor, locationsFromBoard, newLocation, setGroup, sunrise, sunset, fmtTime, addMinutes } from './callsheet';
import { shootDays } from './board';

describe('call sheets', () => {
  it('reads the day from the board, the cast with SAG status, the crew by department, and keeps what is typed', () => {
    const p = sampleProject();
    const days = shootDays(p.board);
    const s = buildSheet(p, 1)!;
    expect(s.dayCount).toBe(days.length);
    expect(s.scenes.map(x => x.number)).toEqual(days[0].scenes.map(x => x.number));
    expect(s.cast.map(c => c.castId)).toEqual(days[0].castIds.filter(id => p.board.castList.some(c => c.id === id)));
    expect(s.cast.every(c => c.call === '07:00' && c.onSet === '08:00')).toBe(true);     // the defaults
    expect(s.cast.every(c => ['SW', 'W', 'WF', 'SWF'].includes(c.status))).toBe(true);
    expect(s.depts.length).toBeGreaterThan(0);
    expect(s.advance.length).toBe(days.length > 1 ? days[1].scenes.length : 0);
    const typed = { ...p, callSheets: { company: 'Out To Lunch', contacts: [], locations: [], crewCall: '06:30', shootingCall: '07:30', lunch: '12:30', wrap: '18:30', days: { 1: { crewCall: '05:00', weather: 'Rain', cast: { [s.cast[0].castId]: { pickup: '04:15', note: 'drives self' } }, depts: { Camera: '04:30' } } } } };
    const t = buildSheet(typed, 1)!;
    expect(t.crewCall).toBe('05:00'); expect(t.shootingCall).toBe('07:30'); expect(t.weather).toBe('Rain');
    expect(t.cast[0]).toMatchObject({ pickup: '04:15', call: '05:00', note: 'drives self' });
    expect(t.depts.find(d => d.dept === 'Camera')?.call).toBe('04:30');
    expect(buildSheet(p, 99)).toBeNull();
  });
  it('codes the SAG day and sorts crew into departments', () => {
    expect(castStatus([2, 3, 5], 2)).toBe('SW'); expect(castStatus([2, 3, 5], 3)).toBe('W'); expect(castStatus([2, 3, 5], 5)).toBe('WF'); expect(castStatus([4], 4)).toBe('SWF'); expect(castStatus([4], 1)).toBe('');
    expect(departmentOf('Director of Photography')).toBe('Camera'); expect(departmentOf('Gaffer')).toBe('Grip & Electric'); expect(departmentOf('1st AD')).toBe('Production');
    expect(departmentOf('Key Hair')).toBe('Hair & Makeup'); expect(departmentOf('Costume Designer')).toBe('Wardrobe'); expect(departmentOf('Composer')).toBe('Other'); expect(departmentOf('Property Master')).toBe('Art'); expect(departmentOf('Craft Service')).toBe('Catering & Craft');
  });
  it('groups sets into locations and finds the location for a set', () => {
    expect(setGroup("SAM'S HOUSE - KITCHEN")).toBe("SAM'S HOUSE");
    const p = sampleProject();
    const locs = locationsFromBoard(p.board, []);
    expect(locs.length).toBeGreaterThan(0);
    expect(new Set(locs.map(l => l.name)).size).toBe(locs.length);
    expect(locationsFromBoard(p.board, locs)).toHaveLength(locs.length);                 // nothing added twice
    const home = newLocation({ name: 'The Penn house', sets: "SAM'S HOUSE, SAM'S STREET", address: '1 Elm St' });
    expect(locationFor("SAM'S HOUSE - KITCHEN", [home])?.id).toBe(home.id);
    expect(locationFor("sam's street", [home])?.id).toBe(home.id);
    expect(locationFor('DINER', [home])).toBeUndefined();
  });
  it('gives sunrise and sunset to the minute and formats times', () => {
    // Los Angeles, March 8 2027 (standard time): the almanac says about 6:11 AM and 5:53 PM
    const r = sunrise('2027-03-08', 34.05, -118.24)!, s = sunset('2027-03-08', 34.05, -118.24)!;
    expect(r).toMatch(/^6:(0[89]|1[0-5]) AM$/); expect(s).toMatch(/^5:(4[89]|5[0-7]) PM$/);   // the approximation is within a few minutes of the almanac
    expect(sunrise('2027-06-21', 89.9, 0)).toBeNull();
    expect(fmtTime('07:00')).toBe('7:00 AM'); expect(fmtTime('13:30')).toBe('1:30 PM'); expect(fmtTime('00:15')).toBe('12:15 AM');
    expect(addMinutes('07:00', -30)).toBe('06:30'); expect(addMinutes('23:50', 20)).toBe('00:10');
  });
});
