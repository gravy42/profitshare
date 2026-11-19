// Every project that comes in from outside goes through checkProject(): these are the files a filmmaker could hand
// it, good and bad, and what each one gets back. Only invented names and numbers (the sample film is SALT FLAT).
import { describe, expect, it } from 'vitest';
import { sampleDemo, sampleProject, blankProject } from '../data/seed';
import {
  checkBoard,
  checkProject,
  readProjectText,
  repairNote,
  EMPTY_FILE,
  NOT_A_PROJECT,
  NOT_JSON,
} from './openProject';
import { applyDeal, withDeal } from './deal';
import { adoptBoardDays, syncCastDaysFromBoard } from './board';
import { topSheet } from './budget';
import { defaultCalendar } from './calendar';
import { defaultCallSheets } from './callsheet';
import { defaultPitch } from './pitch';
import type { Project } from './types';

/** The sample as a file holds it: plain JSON, nothing shared with the seed data. */
const file = (p: Project = sampleDemo()): Record<string, any> => JSON.parse(JSON.stringify(p));
const reason = (raw: unknown) => {
  const r = checkProject(raw);
  return r.ok ? 'OPENED' : r.reason;
};
const opened = (raw: unknown) => {
  const r = checkProject(raw);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
};
const RAW_ERROR = /undefined|TypeError|Cannot read|is not a function|null \(/;

describe('a file that is not a project is refused in plain words', () => {
  it('an empty file, text that is not JSON, and JSON that was cut off', () => {
    expect(readProjectText('')).toEqual({ ok: false, reason: EMPTY_FILE });
    expect(readProjectText('  \n ')).toEqual({ ok: false, reason: 'This file is empty.' });
    expect(readProjectText('SALT FLAT budget, draft 2')).toEqual({ ok: false, reason: NOT_JSON });
    const whole = JSON.stringify(sampleDemo());
    expect(readProjectText(whole.slice(0, Math.floor(whole.length / 2)))).toEqual({
      ok: false,
      reason: 'This file cannot be read as a project. It may have been cut off.',
    });
  });
  it('a list, a number, a word, null, an empty object', () => {
    for (const text of [
      '[]',
      '[{"schemaVersion":1}]',
      '7',
      '"SALT FLAT"',
      'null',
      'true',
      '{}',
      '{"name":"SALT FLAT"}',
    ])
      expect(readProjectText(text), text).toEqual({ ok: false, reason: 'This file is not a ProfitShare project.' });
    expect(NOT_A_PROJECT).toBe('This file is not a ProfitShare project.');
  });
  it('a file from a newer ProfitShare says so, and says what to do', () => {
    expect(reason({ ...file(), schemaVersion: 2 })).toBe(
      'This file was made by a newer version of ProfitShare (format 2). Reload this page to get the latest version, then open it again.',
    );
    expect(reason({ schemaVersion: 3 })).toBe(
      'This file was made by a newer version of ProfitShare (format 3). Reload this page to get the latest version, then open it again.',
    );
    for (const v of [0, -1, '1', null, [1], { v: 1 }, true])
      expect(reason({ ...file(), schemaVersion: v }), String(v)).toBe(NOT_A_PROJECT);
  });
});

describe('the core a budget cannot exist without', () => {
  it('a bare {"schemaVersion":1} names what is missing', () => {
    expect(readProjectText('{"schemaVersion":1}')).toEqual({
      ok: false,
      reason: 'This project file is missing its budget lines, chart of accounts, budget categories and 8 other parts.',
    });
  });
  it('one part missing is named on its own', () => {
    const missing = (k: string) => {
      const f = file();
      delete f[k];
      return reason(f);
    };
    expect(missing('lines')).toBe('This project file is missing its budget lines.');
    expect(missing('accounts')).toBe('This project file is missing its chart of accounts.');
    expect(missing('categories')).toBe('This project file is missing its budget categories.');
    expect(missing('fringes')).toBe('This project file is missing its fringe rates.');
    expect(missing('participants')).toBe('This project file is missing its points schedule.');
    expect(missing('tiers')).toBe('This project file is missing its points tiers.');
    expect(missing('waterfall')).toBe('This project file is missing its waterfall terms.');
    expect(missing('sag')).toBe('This project file is missing its SAG-AFTRA settings.');
    expect(missing('board')).toBe('This project file is missing its stripboard.');
    expect(missing('shootDays')).toBe('This project file is missing its number of shoot days.');
    expect(missing('contingencyPct')).toBe('This project file is missing its contingency percentage.');
    expect(reason({ ...file(), lines: null })).toBe('This project file is missing its budget lines.');
  });
  it('a part of the wrong type is named', () => {
    expect(reason({ ...file(), board: 'x' })).toBe(
      'This project file cannot be opened. ProfitShare could not read its stripboard.',
    );
    expect(reason({ ...file(), participants: 7 })).toBe(
      'This project file cannot be opened. ProfitShare could not read its points schedule.',
    );
    expect(reason({ ...file(), lines: {}, board: 'x', participants: 7 })).toBe(
      'This project file cannot be opened. ProfitShare could not read its budget lines, points schedule and stripboard.',
    );
    expect(reason({ schemaVersion: 1, lines: null, board: 'x', participants: 7 })).toMatch(
      /^This project file is missing its budget lines, /,
    );
    expect(reason({ ...file(), shootDays: '12' })).toBe(
      'This project file cannot be opened. ProfitShare could not read its number of shoot days.',
    );
    expect(reason({ ...file(), name: 7 })).toBe(
      'This project file cannot be opened. ProfitShare could not read its project name.',
    );
    expect(reason({ ...file(), waterfall: { ...file().waterfall, poolPct: 'half' } })).toBe(
      'This project file cannot be opened. ProfitShare could not read its waterfall terms (the trouble is with the pool percentage).',
    );
    expect(reason({ ...file(), sag: { targetTier: 'GOLD', dic: false, includeContingency: true } })).toBe(
      'This project file cannot be opened. ProfitShare could not read its SAG-AFTRA settings (the trouble is with the target tier).',
    );
    expect(reason({ ...file(), board: { ...file().board, strips: null } })).toBe(
      'This project file cannot be opened. Its stripboard is missing its strips.',
    );
  });
  it('one line, scene or strip that cannot be read is pointed at', () => {
    const f = file();
    f.lines[2].rate = '450';
    expect(reason(f)).toBe(
      'This project file has a budget line that cannot be read (number 3 in the file). The trouble is with its rate.',
    );
    const g = file();
    g.lines[0] = 'Director';
    expect(reason(g)).toBe('This project file has a budget line that cannot be read (number 1 in the file).');
    const h = file();
    h.board.scenes[4].eighths = null;
    expect(reason(h)).toBe(
      'This project file has a scene on the stripboard that cannot be read (number 5 in the file). The trouble is with its page count.',
    );
    const i = file();
    i.board.strips[1] = { type: 'intermission', id: 's' };
    expect(reason(i)).toBe(
      'This project file has a strip on the stripboard that cannot be read (number 2 in the file).',
    );
    const j = file();
    j.lines[1].payType = 'barter';
    expect(reason(j)).toBe(
      'This project file has a budget line that cannot be read (number 2 in the file). The trouble is with its pay type.',
    );
    const k = file();
    k.participants[0].id = 12;
    expect(reason(k)).toBe(
      'This project file has an entry on the points schedule that cannot be read (number 1 in the file). The trouble is with its identifier.',
    );
  });
  it('numbers that are not finite are not numbers', () => {
    expect(JSON.parse('1e999')).toBe(Infinity); // what a file can really carry
    const f = JSON.parse(JSON.stringify(sampleDemo()).replace('"contingencyPct":10', '"contingencyPct":1e999'));
    expect(f.contingencyPct).toBe(Infinity);
    expect(reason(f)).toBe(
      'This project file cannot be opened. ProfitShare could not read its contingency percentage.',
    );
    const g = file();
    g.lines[0].amount = NaN;
    expect(reason(g)).toMatch(
      /budget line that cannot be read \(number 1 in the file\)\. The trouble is with its amount\./,
    );
    const h = file();
    h.fringes[0].rate = -Infinity;
    expect(reason(h)).toMatch(/fringe rate that cannot be read/);
  });
  it('a word left out of a line is an empty word, not a refusal: nothing is lost', () => {
    const f = file();
    delete f.lines[0].description;
    delete f.lines[0].tags;
    delete f.board.scenes[0].synopsis;
    f.lines[1].notes = null;
    delete f.currency;
    const r = opened(f);
    expect(r.repaired).toEqual([]);
    expect(r.project.lines[0].description).toBe('');
    expect(r.project.lines[0].tags).toEqual([]);
    expect(r.project.board.scenes[0].synopsis).toBe('');
    expect('notes' in r.project.lines[1]).toBe(false);
    expect(r.project.currency).toBe('USD');
    expect(r.project.lines[2]).toBe(f.lines[2]); // the lines that were fine are the very ones from the file
  });
});

describe('a good file comes back exactly as it was', () => {
  it('the sample, the sample with a pitch, and a blank project: the same object, nothing altered', () => {
    for (const p of [sampleProject(), sampleDemo(), blankProject(), blankProject({ chartOfAccounts: 'empty' })]) {
      const f = file(p),
        before = JSON.stringify(f);
      const r = opened(f);
      expect(r.repaired).toEqual([]);
      expect(r.project).toBe(f);
      expect(r.project).toEqual(JSON.parse(before));
      expect(JSON.stringify(f)).toBe(before);
    }
  });
  it('the sample as the app holds it once opened (deal terms filled in, days from the board) still opens unchanged', () => {
    const live = syncCastDaysFromBoard(adoptBoardDays(withDeal(sampleDemo())));
    const saved = JSON.stringify(live, null, 1); // what Save writes
    const r = readProjectText(saved);
    expect(r.ok && r.repaired).toEqual([]);
    expect(r.ok && r.project).toEqual(JSON.parse(saved));
    expect(r.ok && JSON.stringify(r.project, null, 1)).toBe(saved); // and saving it again writes the same file
    expect(topSheet(applyDeal((r as { project: Project }).project)).cashBudget).toBe(
      topSheet(applyDeal(live)).cashBudget,
    );
  });
  it('every optional part filled in is left alone too', () => {
    const f = file();
    f.dayHours = 10;
    f.notes = 'Salt Flat, draft 2';
    f.deal = withDeal(sampleProject()).deal;
    f.locations = [{ id: 'loc_1', name: 'Wendover', days: 7, outsideLaZone: true, minWage: 16.5 }];
    f.calendar = {
      ...defaultCalendar(f as Project),
      from: '2027-03',
      to: '2027-05',
      dayOne: '2027-03-08',
      events: [
        { id: 'ev_1', date: '2027-03-01', end: '2027-03-05', label: 'Prep', kind: 'prep' },
        { id: 'ev_2', date: '2027-03-08', label: '', kind: 'shoot', dayIndex: 1 },
      ],
    };
    f.callSheets = {
      ...defaultCallSheets(),
      company: 'Salt Flat Pictures',
      contacts: [{ role: 'UPM', name: 'Ines Okafor', phone: '555 0100' }],
      locations: [
        {
          id: 'cs_1',
          name: 'The flats',
          sets: 'SALT FLAT',
          address: '',
          parking: '',
          hospital: '',
          notes: '',
          lat: 40.7,
          lng: -113.9,
        },
      ],
      days: {
        1: {
          crewCall: '06:00',
          cast: { 1: { status: 'SW', call: '06:30' } },
          depts: { Camera: '06:00' },
          crew: { p_dp: 'O/C' },
          extras: [
            { id: 'x_1', kind: 'standin', name: 'Rae', role: 'for MARA', call: '07:00', onSet: '08:00', note: '' },
          ],
        },
      },
    };
    f.incentives = {
      startDate: '2027-03-08',
      ca: {
        enabled: true,
        excludedCategories: ['1100'],
        caSharePct: 90,
        outOfZonePct: 50,
        localHirePct: 10,
        vfx: false,
        trainees: 1,
        monetize: 'transfer',
        transferCents: 90,
        bridge: true,
        bridgeCostPct: 8,
        auditCost: 15000,
      },
      federal: {
        enabled: false,
        includeAtl: true,
        independent: true,
        rural: false,
        transferCents: 90,
        bridge: false,
        bridgeCostPct: 8,
      },
      perks: { permits: 2500 },
    };
    f.somethingNewer = { kept: true }; // a field this version does not know
    f.pitch.somethingNewer = [1, 2, 3];
    const before = JSON.stringify(f);
    const r = opened(f);
    expect(r.repaired).toEqual([]);
    expect(r.project).toBe(f);
    expect(JSON.stringify(r.project)).toBe(before);
  });
});

describe('settings of the report deck, which was removed', () => {
  /** A file as the app saved it while the report deck existed: its four slide rules, and its tick on a look book picture. */
  const now = file(); // one copy to compare with: the sample makes new ids each time it is built
  const old = (
    rules: Record<string, unknown> = { layout: 'plain', eyebrow: true, bleed: 0.45, lookSlides: 5 },
    slide: unknown = true,
  ) => {
    const f = file(now as Project);
    f.pitch.design.deck = { ...f.pitch.design.deck, ...rules };
    f.pitch.lookbook = f.pitch.lookbook.map((i: object, n: number) => (n === 0 ? { ...i, slide } : i));
    return f;
  };
  it('a file that has them opens with nothing reported, and without them', () => {
    const f = old(),
      before = JSON.stringify(f);
    const r = opened(f);
    expect(r.repaired).toEqual([]);
    expect(repairNote(r.repaired)).toBe('');
    expect(r.project.pitch!.design!.deck).toEqual(now.pitch.design.deck); // the cover, the closing picture and the sign-off are kept
    expect(r.project.pitch!.lookbook).toEqual(now.pitch.lookbook);
    expect(r.project).toEqual(now); // and nothing else in the file moved
    expect(JSON.stringify(f)).toBe(before); // the file that was read is not written on
    expect(JSON.stringify(r.project)).not.toMatch(/"(lookSlides|bleed|slide)":|"layout":"plain"/);
  });
  it('whatever they hold, they are forgotten quietly: they were never a reason to mend the file', () => {
    const r = opened(old({ layout: 7, eyebrow: 'yes', bleed: null, lookSlides: [] }, 'on'));
    expect(r.repaired).toEqual([]);
    expect(r.project).toEqual(now);
  });
  it('a deck with only those settings still gets its sign-off', () => {
    const f = file();
    f.pitch.design.deck = { layout: 'split', eyebrow: false, bleed: 0.55 };
    const r = opened(f);
    expect(r.repaired).toEqual([]);
    expect(r.project.pitch!.design!.deck).toEqual({ signoff: '' });
  });
});

describe('a part with defaults that cannot be read is reset, and the rest opens', () => {
  it('each optional part of the wrong type goes, by name', () => {
    const cases: [string, unknown, string][] = [
      ['dayHours', 11, 'the length of the shooting day'],
      ['notes', { a: 1 }, 'the project notes'],
      ['deal', 'cash', 'the deal terms'],
      ['incentives', [], 'the incentives'],
      ['locations', 'Wendover', 'the shoot locations'],
      ['calendar', 7, 'the calendar'],
      ['pitch', 'x', 'the pitch'],
      ['callSheets', [1], 'the call sheets'],
    ];
    for (const [key, junk, label] of cases) {
      const f = file(),
        lines = JSON.stringify(f.lines);
      f[key] = junk;
      const r = opened(f);
      expect(r.repaired, key).toEqual([label]);
      expect(key in r.project, key).toBe(false);
      expect(JSON.stringify(r.project.lines)).toBe(lines);
      expect(f[key]).toBe(junk); // the file's own object is not touched
      expect(topSheet(applyDeal(r.project)).cashBudget).toBe(topSheet(applyDeal(sampleDemo())).cashBudget);
    }
  });
  it('all of them at once: one sentence for the user', () => {
    const r = opened({ ...file(), calendar: 'March', callSheets: 5, pitch: { ...file().pitch, lookbook: 'pictures' } });
    expect(r.repaired).toEqual(['the calendar', 'the pitch', 'the call sheets']);
    expect(repairNote(r.repaired)).toBe(
      'Some of it could not be read and was left out or set back to its default: the calendar, the pitch, the call sheets. Everything else is as it was saved.',
    );
    expect(repairNote([])).toBe('');
  });
  it('inside the pitch, only the piece that is wrong is reset', () => {
    const f = file();
    const good = f.pitch.comps.length;
    f.pitch.lookbook = 'pictures';
    f.pitch.comps.push('Dune Song', { id: 7, title: 'Nine Miles' });
    f.pitch.audience = 4;
    f.pitch.feePct = 'twenty';
    f.pitch.slides = { 0: 'cover' };
    f.pitch.design.fontFiles = 'Courier';
    const r = opened(f);
    expect(r.repaired).toEqual(['the pitch']);
    const pitch = r.project.pitch!;
    expect('lookbook' in pitch).toBe(false);
    expect(pitch.comps).toHaveLength(good);
    expect(pitch.audience).toEqual(defaultPitch().audience);
    expect(pitch.feePct).toBe(defaultPitch().feePct);
    expect('slides' in pitch).toBe(false);
    expect('fontFiles' in pitch.design!).toBe(false);
    expect(pitch.design!.colors).toBe(f.pitch.design.colors);
    expect(pitch.logline).toBe(f.pitch.logline);
    expect(pitch.sections).toBe(f.pitch.sections);
    expect(pitch.team).toBe(f.pitch.team);
  });
  it('a design system without its colours is no design system; the pitch stays', () => {
    const f = file();
    f.pitch.design.colors = { bg: 3 };
    const r = opened(f);
    expect(r.repaired).toEqual(['the pitch']);
    expect('design' in r.project.pitch!).toBe(false);
    expect(r.project.pitch!.lookbook).toBe(f.pitch.lookbook);
  });
  it('deal terms, calendar and call sheets: the unreadable term goes back to its default', () => {
    const f = file();
    f.deal = {
      pay: { model: 'barter', crewCustomRate: '400', premiums: { producers: 'points', script: 'gift' } },
      producers: 'two',
      nonShoot: { enabled: true, cashHourly: 18, rest: 'points' },
    };
    f.calendar = {
      from: 'March',
      to: '2027-05',
      workDays: 'weekdays',
      skipHolidays: true,
      events: [
        { id: 'ev_1', date: '2027-03-01', label: 'Prep', kind: 'prep' },
        { id: 'ev_2', date: 'the 8th', label: 'Day 1', kind: 'shoot' },
        null,
      ],
    };
    f.callSheets = {
      company: 'Salt Flat Pictures',
      contacts: 'Ines',
      locations: [],
      crewCall: 7,
      shootingCall: '08:00',
      lunch: '13:00',
      wrap: '19:00',
      days: { 1: { cast: 'everyone', depts: { Camera: '06:00', Sound: 6 } }, 2: 'tbd' },
    };
    const r = opened(f);
    expect(r.repaired).toEqual(['the deal terms', 'the calendar', 'the call sheets']);
    expect(r.project.deal).toEqual({
      pay: { premiums: { producers: 'points' } },
      nonShoot: { enabled: true, cashHourly: 18, rest: 'points' },
    });
    expect(withDeal(r.project).deal!.pay).toMatchObject({
      model: 'as-budgeted',
      crewCustomRate: 400,
      premiums: { producers: 'points', script: 'cash', allowances: 'cash' },
    });
    expect(r.project.calendar).toEqual({
      from: '',
      to: '2027-05',
      workDays: [1, 2, 3, 4, 5],
      skipHolidays: true,
      events: [{ id: 'ev_1', date: '2027-03-01', label: 'Prep', kind: 'prep' }],
    });
    expect(r.project.callSheets).toEqual({
      company: 'Salt Flat Pictures',
      contacts: [],
      locations: [],
      crewCall: '07:00',
      shootingCall: '08:00',
      lunch: '13:00',
      wrap: '19:00',
      days: { 1: { cast: {}, depts: { Camera: '06:00' } } },
    });
  });
  it('fields this version does not know are kept, in the core and in the parts', () => {
    const f = file();
    f.fromTheFuture = { a: [1, 2] };
    f.lines[0].colour = 'teal';
    f.board.scenes[0].weather = 'wind';
    f.pitch.mood = 'dry';
    f.calendar = { ...defaultCalendar(f as Project), zoom: 3 };
    const r = opened(f);
    expect(r.repaired).toEqual([]);
    expect(r.project).toBe(f);
  });
});

describe('hostile shapes', () => {
  it('the input is never changed, whatever is in it', () => {
    const f = file();
    f.calendar = 7;
    f.pitch.lookbook = [null, 5];
    f.lines[0].notes = 9;
    f.board.scenes[0].elements.constructor = ['x'];
    delete f.lines[1].tags;
    const frozen = (v: any): any => {
      if (v && typeof v === 'object') {
        Object.values(v).forEach(frozen);
        Object.freeze(v);
      }
      return v;
    };
    const before = JSON.stringify(f);
    const r = opened(frozen(f)); // a frozen file: any write would throw
    expect(JSON.stringify(f)).toBe(before);
    expect(r.repaired).toEqual(['a detail on a budget line', 'a tag on a scene', 'the calendar', 'the pitch']);
  });
  it('__proto__ and constructor keys do not reach any prototype', () => {
    const text = JSON.stringify(sampleDemo()).replace(
      '{"schemaVersion":1,',
      '{"schemaVersion":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},',
    );
    const r = readProjectText(text);
    expect(r.ok).toBe(true);
    const p = (r as { project: Project }).project as unknown as Record<string, unknown>;
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(p, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((p as { polluted?: unknown }).polluted).toBeUndefined();
    // deeper down, and as a tag category or a call sheet day
    const f = JSON.parse(
      JSON.stringify(sampleDemo()).replace(
        '"elements":{',
        '"elements":{"__proto__":["x"],"constructor":["y"],"toString":["z"],',
      ),
    );
    f.callSheets = {
      ...defaultCallSheets(),
      days: JSON.parse(
        '{"__proto__":{"cast":{},"depts":{}},"hasOwnProperty":{"cast":{},"depts":{}},"1":{"cast":{},"depts":{}}}',
      ),
    };
    f.incentives = { perks: JSON.parse('{"__proto__":5,"valueOf":5,"permits":100}') };
    const r2 = opened(f);
    const el = r2.project.board.scenes
      .map(s => s.elements)
      .find(e =>
        Object.keys(f.board.scenes[r2.project.board.scenes.findIndex(x => x.elements === e)].elements).includes(
          'constructor',
        ),
      )!;
    expect(Object.keys(el).some(k => k in Object.prototype)).toBe(false);
    expect(typeof el.toString).toBe('function');
    expect(Object.keys(r2.project.callSheets!.days)).toEqual(['1']);
    expect(r2.project.incentives!.perks).toEqual({ permits: 100 });
    expect(({} as Record<string, unknown>).cast).toBeUndefined();
  });
  it('a very long list is read once and answered, not choked on', () => {
    const f = file();
    const line = f.lines[0];
    f.lines = Array.from({ length: 200_000 }, (_, i) => ({ ...line, id: `L${i}` }));
    f.lines[150_000] = { ...line, id: 'L150000', rate: 'x' };
    const t = Date.now();
    expect(reason(f)).toBe(
      'This project file has a budget line that cannot be read (number 150001 in the file). The trouble is with its rate.',
    );
    f.lines[150_000] = { ...line, id: 'L150000' };
    expect(opened(f).project.lines).toBe(f.lines);
    f.lines = new Array(1_000_000).fill(7);
    expect(reason(f)).toBe('This project file has a budget line that cannot be read (number 1 in the file).');
    expect(Date.now() - t).toBeLessThan(5000);
  });
  it('nesting far deeper than any project is refused, not a stack overflow', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 5000; i++) deep = { d: deep };
    expect(reason({ ...file(), extra: deep })).toBe(NOT_A_PROJECT);
    let list: unknown = 1;
    for (let i = 0; i < 5000; i++) list = [list];
    expect(reason({ ...file(), extra: list })).toBe(NOT_A_PROJECT);
  });
  it('no refusal is ever a raw error, whatever takes the place of any part', () => {
    const junk: unknown[] = [null, 7, 'x', [], {}, true, [null], [[]], { length: 3 }, { id: {} }, -0, 1e999];
    const f = file();
    const keys = [
      'schemaVersion',
      ...Object.keys(f),
      'deal',
      'incentives',
      'locations',
      'calendar',
      'callSheets',
      'dayHours',
    ];
    for (const k of keys)
      for (const j of junk) {
        const r = checkProject({ ...f, [k]: j });
        if (!r.ok) {
          expect(r.reason, `${k}`).not.toMatch(RAW_ERROR);
          expect(r.reason).toMatch(/^This (project )?file .*\.$/);
          expect(r.reason).not.toContain('!');
        }
      }
    for (const part of ['board', 'waterfall', 'sag', 'pitch'] as const)
      for (const k of Object.keys(f[part]))
        for (const j of junk) {
          const r = checkProject({ ...f, [part]: { ...f[part], [k]: j } });
          if (!r.ok) expect(r.reason, `${part}.${k}`).not.toMatch(RAW_ERROR);
        }
    for (const j of junk) expect(reason(j)).toBe(NOT_A_PROJECT);
  });
});

describe('a stripboard on its own', () => {
  it('a kept board is read with the same care', () => {
    const board = file().board;
    expect(checkBoard(board)).toBe(board);
    for (const junk of [
      null,
      7,
      'x',
      [],
      {},
      { scenes: [], strips: [] },
      { ...board, scenes: [null] },
      { ...board, targetEighthsPerDay: 'many' },
    ])
      expect(checkBoard(junk)).toBeNull();
  });
});
