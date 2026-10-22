import { Fragment, useState, type CSSProperties } from 'react';
import type { CallContact, CallExtra, CallSheetDay, Location, PitchDesign, Project } from '../engine/types';
import { shootDays } from '../engine/board';
import { shootDates, shortDate, withCalendar } from '../engine/calendar';
import { DEFAULT_BANNER, INSTRUCTION_DEPTS, buildSheet, fmtTime, locationsFromBoard, newExtra, newLocation, withCallSheets, type Sheet } from '../engine/callsheet';
import { PrintPortal } from './print';

type SetProject = (f: (p: Project) => Project) => void;
type CS = NonNullable<Project['callSheets']>;

const TimeInput = ({ value, placeholder, onChange, width = 92 }: { value: string; placeholder?: string; onChange: (v: string) => void; width?: number }) => (
  <input type="time" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={{ width }} title={placeholder ? `blank = ${fmtTime(placeholder)}` : undefined} />
);

/** Call sheets: one per shoot day, drawn from the board, the calendar, the cast and crew, and the locations table;
 *  what a day needs typed is kept on that day, so moving the board never loses a call time. Prints one page a day. */
export function CallSheetsView({ project, setProject }: { project: Project; setProject: SetProject }) {
  const p = withCallSheets(project); const cs = p.callSheets!;
  const set = (f: (c: CS) => CS) => setProject(q => { const w = withCallSheets(q); return { ...w, callSheets: f(w.callSheets!) }; });
  const days = shootDays(p.board); const dates = shootDates(p.board, withCalendar(p).calendar!);
  const [dayIndex, setDayIndex] = useState(1);
  const [printing, setPrinting] = useState<'day' | 'all' | null>(null);
  const [prodOpen, setProdOpen] = useState(!cs.company && cs.contacts.length === 0);   // open until filled in; a fold the person toggles stays where they put it
  const [locOpen, setLocOpen] = useState(cs.locations.length === 0);
  const sheet = buildSheet(p, dayIndex);
  const over: CallSheetDay = cs.days[dayIndex] ?? { cast: {}, depts: {} };
  const setDay = (f: (d: CallSheetDay) => CallSheetDay) => set(c => ({ ...c, days: { ...c.days, [dayIndex]: f(c.days[dayIndex] ?? { cast: {}, depts: {} }) } }));
  type DayText = 'crewCall' | 'shootingCall' | 'rehearsal' | 'lunch' | 'wrap' | 'weather' | 'notes' | 'safety' | 'meals' | 'parking' | 'basecamp' | 'bathrooms' | 'lunchAt' | 'trucks' | 'hospital' | 'bulletins' | 'quote' | 'instructions';
  const field = (k: DayText, v: string) => setDay(d => { const n = { ...d }; if (v === '') delete n[k]; else n[k] = v; return n; });
  const setCrew = (id: string, v: string) => setDay(d => { const n = { ...(d.crew ?? {}) }; if (v === '') delete n[id]; else n[id] = v; return { ...d, crew: n }; });
  const setExtra = (id: string, patch: Partial<CallExtra>) => setDay(d => ({ ...d, extras: (d.extras ?? []).map(e => e.id === id ? { ...e, ...patch } : e) }));
  const addExtra = (kind: CallExtra['kind']) => setDay(d => ({ ...d, extras: [...(d.extras ?? []), newExtra(kind)] }));
  const dropExtra = (id: string) => setDay(d => ({ ...d, extras: (d.extras ?? []).filter(e => e.id !== id) }));
  const copyLogistics = () => { const prev = cs.days[dayIndex - 1]; if (!prev) return; setDay(d => ({ ...d, parking: prev.parking, basecamp: prev.basecamp, bathrooms: prev.bathrooms, lunchAt: prev.lunchAt, trucks: prev.trucks, hospital: prev.hospital })); };
  const design = p.pitch?.design;
  const [crewOpen, setCrewOpen] = useState(false);
  const setCast = (id: number, k: 'status' | 'pickup' | 'call' | 'makeup' | 'wardrobe' | 'onSet' | 'note', v: string) => setDay(d => { const c = { ...(d.cast[id] ?? {}) }; if (v === '') delete c[k]; else c[k] = v; return { ...d, cast: { ...d.cast, [id]: c } }; });
  const setDept = (dept: string, v: string) => setDay(d => { const n = { ...d.depts }; if (v === '') delete n[dept]; else n[dept] = v; return { ...d, depts: n }; });
  const setLoc = (id: string, patch: Partial<Location>) => set(c => ({ ...c, locations: c.locations.map(l => l.id === id ? { ...l, ...patch } : l) }));
  const setContact = (i: number, patch: Partial<CallContact>) => set(c => ({ ...c, contacts: c.contacts.map((x, k) => k === i ? { ...x, ...patch } : x) }));
  const num = (v: string): number | undefined => { const n = parseFloat(v); return v.trim() === '' || isNaN(n) ? undefined : n; };

  if (!days.length) return <div className="panel"><h2>Call sheets</h2><p className="help">Nothing to call yet: the stripboard has no shoot days. Break the board into days and come back; each day gets a sheet.</p></div>;

  return (
    <div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Call sheets</h2>
          <span className="row">
            <button className="btn small" onClick={() => setPrinting('day')}>Print day {dayIndex}</button>
            <button className="btn small primary" onClick={() => setPrinting('all')}>Print all {days.length} days</button>
          </span>
        </div>
        <p className="help">One sheet per shoot day. The scenes, sets, pages and cast come from the stripboard, the date from the Calendar, the actors and crew from the Points schedule (an actor is matched by cast number, crew are sorted into departments by role), and the addresses from the Locations table below. Type what the day needs and it stays with that day; a blank field means the default. Print saves a PDF, two pages a day: the front with the schedule, the cast and the advance, the back with every crew call, so it prints double-sided.</p>
      </div>

      <details className="panel fold" open={prodOpen} onToggle={e => setProdOpen((e.target as HTMLDetailsElement).open)}>
        <summary><h2>Production <span className="hint">{cs.company || 'company'} · {cs.contacts.length} contacts · crew call {fmtTime(cs.crewCall)}</span></h2></summary>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="ctl"><label>Production company</label><input value={cs.company} placeholder="Out To Lunch Entertainment" onChange={e => set(c => ({ ...c, company: e.target.value }))} style={{ width: 240 }} /></div>
          <div className="ctl"><label>Crew call (default)</label><TimeInput value={cs.crewCall} onChange={v => set(c => ({ ...c, crewCall: v || '07:00' }))} /></div>
          <div className="ctl"><label>Shooting call</label><TimeInput value={cs.shootingCall} onChange={v => set(c => ({ ...c, shootingCall: v || '08:00' }))} /></div>
          <div className="ctl"><label>Lunch</label><TimeInput value={cs.lunch} onChange={v => set(c => ({ ...c, lunch: v || '13:00' }))} /></div>
          <div className="ctl"><label>Est. wrap</label><TimeInput value={cs.wrap} onChange={v => set(c => ({ ...c, wrap: v || '19:00' }))} /></div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="ctl" style={{ flex: 1 }}><label>The line under the header (safety meeting, forced calls, visitors)</label><input value={cs.banner ?? DEFAULT_BANNER} onChange={e => set(c => ({ ...c, banner: e.target.value }))} /></div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="ctl"><label>Basecamp (default)</label><input value={cs.basecamp ?? ''} placeholder="same as parking" onChange={e => set(c => ({ ...c, basecamp: e.target.value }))} /></div>
          <div className="ctl"><label>Bathrooms</label><input value={cs.bathrooms ?? ''} placeholder="at basecamp" onChange={e => set(c => ({ ...c, bathrooms: e.target.value }))} /></div>
          <div className="ctl"><label>Lunch at</label><input value={cs.lunchAt ?? ''} placeholder="basecamp" onChange={e => set(c => ({ ...c, lunchAt: e.target.value }))} /></div>
          <div className="ctl"><label>Working trucks</label><input value={cs.trucks ?? ''} placeholder="crew parking" onChange={e => set(c => ({ ...c, trucks: e.target.value }))} /></div>
          <div className="ctl"><label>Rehearsal (default)</label><TimeInput value={cs.rehearsal ?? ''} placeholder={cs.crewCall} onChange={v => set(c => ({ ...c, rehearsal: v || undefined }))} /></div>
        </div>
        {design && <label className="row" style={{ marginTop: 10, gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!cs.brand} onChange={e => set(c => ({ ...c, brand: e.target.checked }))} /> Style the sheet with the design system from the Pitch tab{design.name ? ` (${design.name})` : ''}: its colours on the header and the call band, its title face, its logo</label>}
        <h3 style={{ margin: '12px 0 4px' }}>Contacts on the header</h3>
        <table className="compact">
          <thead><tr><th className="l">Role</th><th className="l">Name</th><th className="l">Phone</th><th></th></tr></thead>
          <tbody>
            {cs.contacts.map((x, i) => <tr key={i}>
              <td><input value={x.role} placeholder="1st AD" onChange={e => setContact(i, { role: e.target.value })} /></td>
              <td><input value={x.name} onChange={e => setContact(i, { name: e.target.value })} /></td>
              <td><input value={x.phone} placeholder="818-" onChange={e => setContact(i, { phone: e.target.value })} /></td>
              <td><button className="x" aria-label="remove contact" onClick={() => set(c => ({ ...c, contacts: c.contacts.filter((_, k) => k !== i) }))}>×</button></td>
            </tr>)}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn small" onClick={() => set(c => ({ ...c, contacts: [...c.contacts, { role: '', name: '', phone: '' }] }))}>Add contact</button>
          {cs.contacts.length === 0 && <button className="btn small ghost" onClick={() => set(c => ({ ...c, contacts: ['Director', 'Producer', 'UPM', '1st AD', '2nd AD'].map(role => ({ role, name: '', phone: '' })) }))}>Add the usual five</button>}
        </div>
      </details>

      <details className="panel fold" open={locOpen} onToggle={e => setLocOpen((e.target as HTMLDetailsElement).open)}>
        <summary><h2>Locations <span className="hint">{cs.locations.length} · {cs.locations.filter(l => l.address.trim()).length} with an address</span></h2></summary>
        <p className="help small">A location covers the sets shot there: list them with commas ("SAM'S HOUSE, SAM'S STREET"); a set on the board whose name starts with one of them, like SAM'S HOUSE - KITCHEN, belongs to it. Latitude and longitude (from the pin in Maps) give the sheet sunrise and sunset for the day with no network.</p>
        <table className="compact locs">
          <thead><tr><th className="l">Location</th><th className="l">Sets on the board</th><th className="l">Address</th><th className="l">Parking</th><th className="l">Nearest hospital</th><th className="l">Lat</th><th className="l">Lng</th><th className="l">Notes</th><th></th></tr></thead>
          <tbody>
            {cs.locations.map(l => <tr key={l.id}>
              <td><input value={l.name} onChange={e => setLoc(l.id, { name: e.target.value })} /></td>
              <td><input value={l.sets} onChange={e => setLoc(l.id, { sets: e.target.value })} /></td>
              <td><input value={l.address} placeholder="street, city, zip" onChange={e => setLoc(l.id, { address: e.target.value })} /></td>
              <td><input value={l.parking} onChange={e => setLoc(l.id, { parking: e.target.value })} /></td>
              <td><input value={l.hospital} onChange={e => setLoc(l.id, { hospital: e.target.value })} /></td>
              <td><input value={l.lat ?? ''} placeholder="34.05" style={{ width: 70 }} onChange={e => setLoc(l.id, { lat: num(e.target.value) })} /></td>
              <td><input value={l.lng ?? ''} placeholder="-118.24" style={{ width: 76 }} onChange={e => setLoc(l.id, { lng: num(e.target.value) })} /></td>
              <td><input value={l.notes} onChange={e => setLoc(l.id, { notes: e.target.value })} /></td>
              <td><button className="x" aria-label="remove location" onClick={() => set(c => ({ ...c, locations: c.locations.filter(x => x.id !== l.id) }))}>×</button></td>
            </tr>)}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn small" onClick={() => set(c => ({ ...c, locations: [...c.locations, newLocation()] }))}>Add location</button>
          <button className="btn small" onClick={() => set(c => ({ ...c, locations: locationsFromBoard(p.board, c.locations) }))} title="One location per set group on the board (SAM'S HOUSE for every SAM'S HOUSE - … set); the ones you have are kept">Add one for each set on the board</button>
        </div>
      </details>

      <div className="panel">
        <div className="row daypick">
          {days.map(d => { const date = dates.get(d.index); return <button key={d.index} className={`btn small ${d.index === dayIndex ? 'primary' : ''}`} onClick={() => setDayIndex(d.index)}>Day {d.index}{date ? ` · ${shortDate(date)}` : ''}</button>; })}
        </div>
        {sheet && <>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="ctl"><label>Crew call</label><TimeInput value={over.crewCall ?? ''} placeholder={cs.crewCall} onChange={v => field('crewCall', v)} /></div>
            <div className="ctl"><label>Shooting call</label><TimeInput value={over.shootingCall ?? ''} placeholder={cs.shootingCall} onChange={v => field('shootingCall', v)} /></div>
            <div className="ctl"><label>Lunch</label><TimeInput value={over.lunch ?? ''} placeholder={cs.lunch} onChange={v => field('lunch', v)} /></div>
            <div className="ctl"><label>Est. wrap</label><TimeInput value={over.wrap ?? ''} placeholder={cs.wrap} onChange={v => field('wrap', v)} /></div>
            <div className="ctl"><label>Rehearsal</label><TimeInput value={over.rehearsal ?? ''} placeholder={cs.rehearsal || sheet.crewCall} onChange={v => field('rehearsal', v)} /></div>
            <div className="ctl" style={{ flex: 1 }}><label>Weather</label><input value={over.weather ?? ''} placeholder={sheet.sunrise ? `sunrise ${sheet.sunrise}, sunset ${sheet.sunset}` : 'high 72, low 55, clear'} onChange={e => field('weather', e.target.value)} /></div>
          </div>
          <h3 style={{ margin: '12px 0 4px' }}>Where things are <span className="hint">parking and hospital come from the day's first location unless typed here</span> {dayIndex > 1 && cs.days[dayIndex - 1] && <button className="btn small ghost" onClick={copyLogistics}>Same as day {dayIndex - 1}</button>}</h3>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {([['parking', 'Crew parking'], ['basecamp', 'Basecamp'], ['bathrooms', 'Bathrooms'], ['lunchAt', 'Lunch'], ['trucks', 'Working trucks'], ['hospital', 'Hospital']] as [DayText, string][]).map(([k, label]) =>
              <div className="ctl" key={k} style={{ flex: '1 1 30%' }}><label>{label}</label><input value={over[k] ?? ''} placeholder={sheet.logistics[k as keyof Sheet['logistics']] || (k === 'basecamp' || k === 'trucks' ? 'same as parking' : '')} onChange={e => field(k, e.target.value)} /></div>)}
          </div>
          <h3 style={{ margin: '12px 0 4px' }}>Cast · {sheet.cast.length}</h3>
          <table className="compact">
            <thead><tr><th>#</th><th className="l">Character</th><th className="l">Actor</th><th>Status</th><th>Pickup</th><th>Report</th><th>Hair / makeup</th><th>Wardrobe</th><th>Ready on set</th><th className="l">Note</th></tr></thead>
            <tbody>
              {sheet.cast.map(c => { const o = over.cast[c.castId] ?? {}; return <tr key={c.castId}>
                <td>{c.castId}</td><td className="l">{c.name}</td><td className="l">{c.actor || <span className="muted">[cast number {c.castId} on the Points schedule]</span>}</td>
                <td><input value={o.status ?? ''} placeholder={c.status} style={{ width: 52, textAlign: 'center' }} onChange={e => setCast(c.castId, 'status', e.target.value.toUpperCase())} /></td>
                <td><TimeInput value={o.pickup ?? ''} onChange={v => setCast(c.castId, 'pickup', v)} /></td>
                <td><TimeInput value={o.call ?? ''} placeholder={sheet.crewCall} onChange={v => setCast(c.castId, 'call', v)} /></td>
                <td><TimeInput value={o.makeup ?? ''} placeholder={sheet.crewCall} onChange={v => setCast(c.castId, 'makeup', v)} /></td>
                <td><TimeInput value={o.wardrobe ?? ''} placeholder={o.makeup ?? sheet.crewCall} onChange={v => setCast(c.castId, 'wardrobe', v)} /></td>
                <td><TimeInput value={o.onSet ?? ''} placeholder={sheet.shootingCall} onChange={v => setCast(c.castId, 'onSet', v)} /></td>
                <td><input value={o.note ?? ''} placeholder="drives self; fitting at lunch" onChange={e => setCast(c.castId, 'note', e.target.value)} /></td>
              </tr>; })}
            </tbody>
          </table>
          <h3 style={{ margin: '12px 0 4px' }}>Stunts, stand-ins, background <span className="hint">background the tags name is listed on its own; add a row to give it a call</span></h3>
          <table className="compact">
            <thead><tr><th className="l">Kind</th><th className="l">Name</th><th className="l">Role / doubles</th><th>Report</th><th>Ready on set</th><th className="l">Note</th><th></th></tr></thead>
            <tbody>
              {(over.extras ?? []).map(e => <tr key={e.id}>
                <td><select value={e.kind} onChange={ev => setExtra(e.id, { kind: ev.target.value as CallExtra['kind'] })}><option value="stunt">Stunt</option><option value="standin">Stand-in / double</option><option value="background">Background</option></select></td>
                <td><input value={e.name} placeholder={e.kind === 'background' ? '12 diner patrons' : 'name'} onChange={ev => setExtra(e.id, { name: ev.target.value })} /></td>
                <td><input value={e.role} placeholder={e.kind === 'stunt' ? 'Sam stunt double' : e.kind === 'standin' ? 'stands in for Sam' : 'Sc 12'} onChange={ev => setExtra(e.id, { role: ev.target.value })} /></td>
                <td><TimeInput value={e.call} placeholder={sheet.crewCall} onChange={v => setExtra(e.id, { call: v })} /></td>
                <td><TimeInput value={e.onSet} placeholder={sheet.shootingCall} onChange={v => setExtra(e.id, { onSet: v })} /></td>
                <td><input value={e.note} placeholder="report to crew parking" onChange={ev => setExtra(e.id, { note: ev.target.value })} /></td>
                <td><button className="x" aria-label="remove row" onClick={() => dropExtra(e.id)}>×</button></td>
              </tr>)}
              {sheet.extras.filter(e => e.id.startsWith('tag_')).map(e => <tr key={e.id} className="muted"><td>Background (tag)</td><td>{e.name}</td><td>{e.role}</td><td colSpan={4}><button className="btn small ghost" onClick={() => setDay(d => ({ ...d, extras: [...(d.extras ?? []), { ...newExtra('background'), name: e.name, role: e.role }] }))}>Give it a call time</button></td></tr>)}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 6 }}><button className="btn small" onClick={() => addExtra('stunt')}>Add stunt</button><button className="btn small" onClick={() => addExtra('standin')}>Add stand-in</button><button className="btn small" onClick={() => addExtra('background')}>Add background</button></div>
          <h3 style={{ margin: '12px 0 4px' }}>Crew calls by department <span className="hint">the back of the sheet; a person's own call below</span></h3>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            {sheet.depts.map(d => <div className="ctl" key={d.dept}><label>{d.dept} <span className="hint">{d.people.length}</span></label><TimeInput value={over.depts[d.dept] ?? ''} placeholder={sheet.crewCall} onChange={v => setDept(d.dept, v)} /></div>)}
            {sheet.depts.length === 0 && <p className="help small">No crew on the Points schedule yet; add them there with their roles and they sort into departments here.</p>}
          </div>
          {sheet.crewCount > 0 && <details open={crewOpen} onToggle={e => setCrewOpen((e.target as HTMLDetailsElement).open)}>
            <summary className="small">Each person's call ({sheet.crewCount}); blank means the department's, O/C means on call</summary>
            <table className="compact">
              <thead><tr><th className="l">Department</th><th className="l">Role</th><th className="l">Name</th><th className="l">Call</th></tr></thead>
              <tbody>{sheet.depts.flatMap(d => d.people.map(x => <tr key={x.id}><td>{d.dept}</td><td>{x.role}</td><td>{x.name !== x.role ? x.name : ''}</td><td><span className="row" style={{ gap: 4 }}><input value={over.crew?.[x.id] ?? ''} placeholder={d.call} style={{ width: 80 }} onChange={e => setCrew(x.id, e.target.value)} /><button className="btn small ghost" onClick={() => setCrew(x.id, over.crew?.[x.id] === 'O/C' ? '' : 'O/C')}>O/C</button></span></td></tr>))}</tbody>
            </table>
          </details>}
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
            <div className="ctl" style={{ flex: 1 }}><label>Special instructions, one a line, "Department: what" <span className="hint">the scene tags fill the rest ({INSTRUCTION_DEPTS.slice(0, 6).join(', ')}…)</span></label><textarea rows={3} value={over.instructions ?? ''} placeholder={'Camera: freedom mounts on the car\nProduction: safety vests, lead/follow car'} onChange={e => field('instructions', e.target.value)} /></div>
            <div className="ctl" style={{ flex: 1 }}><label>Safety bulletins for today's work</label><textarea rows={3} value={over.bulletins ?? ''} placeholder="#8 Camera cars · #8A Process trailers / towed vehicles" onChange={e => field('bulletins', e.target.value)} /></div>
            <div className="ctl" style={{ flex: 1 }}><label>Quote of the day</label><textarea rows={3} value={over.quote ?? ''} placeholder="Survival requires a dose of delusion." onChange={e => field('quote', e.target.value)} /></div>
          </div>
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
            <div className="ctl" style={{ flex: 1 }}><label>Notes</label><textarea rows={3} value={over.notes ?? ''} placeholder="Set is hot at 7:30. Company moves after lunch. Wrap out all gear tonight." onChange={e => field('notes', e.target.value)} /></div>
            <div className="ctl" style={{ flex: 1 }}><label>Safety</label><textarea rows={3} value={over.safety ?? ''} placeholder="Skating sequence: coordinator on set; helmets for doubles. Nearest hospital on the sheet." onChange={e => field('safety', e.target.value)} /></div>
            <div className="ctl" style={{ flex: 1 }}><label>Meals</label><textarea rows={3} value={over.meals ?? ''} placeholder="Breakfast at crew call; lunch at 13:00 by the truck." onChange={e => field('meals', e.target.value)} /></div>
          </div>
          <h3 style={{ margin: '14px 0 6px' }}>The sheet as it prints: front, then back</h3>
          <div className="sheetwrap"><CallSheetPage s={sheet} design={sheet.brand ? design : undefined} /></div>
        </>}
      </div>

      {printing && <PrintPortal title={`${p.name} · Call sheet${printing === 'all' ? 's' : ` day ${dayIndex}`}`} onDone={() => setPrinting(null)}>
        {(printing === 'all' ? days.map(d => d.index) : [dayIndex]).map(i => { const s = buildSheet(p, i); return s ? <CallSheetPage key={i} s={s} print design={s.brand ? design : undefined} /> : null; })}
      </PrintPortal>}
    </div>
  );
}

/** The sheet itself, front and back, the way a feature prints it: the front carries the calls, where things are,
 *  the scenes with company moves, the cast, stunts, stand-ins and background, the special instructions by department
 *  and two days of advance; the back is every crew call by department with the hospital, the safety bulletins and
 *  the quote of the day. The same markup prints and previews; `design` dresses it in the pitch's brand. */
export function CallSheetPage({ s, print, design }: { s: Sheet; print?: boolean; design?: PitchDesign }) {
  const tbd = (v: string, what: string) => v.trim() || (print ? '' : <span className="muted">[add: {what}]</span>);
  const contacts = s.contacts.filter(c => !print || c.name.trim() || c.phone.trim());
  const by = (re: RegExp) => contacts.find(c => re.test(c.role));
  const upm = by(/upm|unit production|line producer/i), ad1 = by(/1st ad|first ad|1st assistant/i), ad2 = by(/2nd ad|second ad|2nd assistant/i);
  const who = (c?: CallContact) => (c ? `${c.name}${c.phone ? ` · ${c.phone}` : ''}` : '');
  // a placeholder crew list has the role for a name; the role is shown once
  const named = (x: { name: string; role: string }) => x.name.trim() && x.name.trim().toLowerCase() !== x.role.trim().toLowerCase() ? x.name : '';
  const t = (v: string) => (v ? fmtTime(v) : '');
  const style = design ? ({ '--cs-bg': design.colors.bg, '--cs-ink': design.colors.ink, '--cs-accent': design.colors.accent, '--cs-on-accent': design.colors.bg, '--cs-title': design.fonts.title || 'inherit' } as CSSProperties) : undefined;
  const stunts = s.extras.filter(e => e.kind === 'stunt'), standins = s.extras.filter(e => e.kind === 'standin'), background = s.extras.filter(e => e.kind === 'background');
  // three columns balanced by head count: each department goes to the column that is shortest so far
  const deptCols: Sheet['depts'][] = [[], [], []]; const height = [0, 0, 0];
  for (const d of s.depts) { const k = height.indexOf(Math.min(...height)); deptCols[k].push(d); height[k] += d.people.length + 1.6; }
  const cls = `callsheet ${design ? 'brand' : ''}`;
  return (
    <>
      <div className={`${cls} front`} style={style}>
        <header className="cshead">
          <div className="who">
            {design?.logoDataUrl && <img className="logo" src={design.logoDataUrl} alt="" />}
            <div className="co">{tbd(s.company, 'production company')}</div>
            <div className="title">{s.title}</div>
            <div className="small">{s.version}</div>
            {contacts.filter(c => /producer|director/i.test(c.role) && !/assistant|\bad\b/i.test(c.role)).map((c, i) => <div key={i} className="small"><b>{c.role}:</b> {c.name}{c.phone ? ` · ${c.phone}` : ''}</div>)}
          </div>
          <div className="callbox">
            <div className="lbl">General crew call</div>
            <div className="big">{fmtTime(s.crewCall)}</div>
            <div className="small">See back for individual call times</div>
            <div className="trio"><span><b>Rehearsal</b><br />{t(s.rehearsal || s.crewCall)}</span><span><b>Shooting call</b><br />{fmtTime(s.shootingCall)}</span><span><b>Lunch</b><br />{fmtTime(s.lunch)}</span></div>
          </div>
          <div className="when">
            <div className="date">{s.dateText}</div>
            <div className="dayof">Day {s.dayIndex} of {s.dayCount}</div>
            <div className="small">{s.weather ? <>Weather: {s.weather}<br /></> : null}{s.sunrise ? <>Sunrise {s.sunrise} · Sunset {s.sunset}</> : (print ? null : <span className="muted">[add coordinates to the location for sunrise and sunset]</span>)}</div>
            <div className="small">Est. wrap {fmtTime(s.wrap)}</div>
          </div>
        </header>
        <div className="banner">{s.banner}</div>
        <div className="strip">
          {([['Crew parking', s.logistics.parking], ['Basecamp', s.logistics.basecamp || s.logistics.parking], ['Bathrooms', s.logistics.bathrooms || 'at basecamp'], ['Lunch', s.logistics.lunchAt || 'at basecamp'], ['Working trucks', s.logistics.trucks || s.logistics.parking], ['Hospital', s.logistics.hospital]] as [string, string][]).map(([k, v]) => <div key={k}><h4>{k}</h4><div>{tbd(v, k.toLowerCase())}</div></div>)}
        </div>
        <table className="sched">
          <colgroup><col style={{ width: '6%' }} /><col style={{ width: '45%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '7%' }} /><col style={{ width: '20%' }} /></colgroup>
          <thead><tr><th>Scene</th><th className="l">Set / description</th><th className="l">Cast</th><th>D/N</th><th>Pages</th><th className="l">Location</th></tr></thead>
          <tbody>
            {s.scenes.map((x, i) => <Fragment key={i}>
              {i > 0 && x.location?.id !== s.scenes[i - 1].location?.id && (x.location || s.scenes[i - 1].location) && <tr className="move"><td colSpan={6}>Company move</td></tr>}
              <tr><td>{x.number}</td><td className="l"><b>{x.ie}. {x.set}</b>{x.synopsis && <span className="syn"> {x.synopsis}</span>}</td><td className="l">{x.castIds.join(', ')}</td><td>{x.tod}</td><td>{x.pages}</td><td className="l">{x.location ? <><b>{x.location.name}</b>{x.location.address && (i === 0 || x.location.id !== s.scenes[i - 1].location?.id) && <div className="small">{x.location.address}</div>}</> : ''}</td></tr>
            </Fragment>)}
            <tr className="sub"><td colSpan={4} className="l">Total</td><td>{s.pages}</td><td /></tr>
          </tbody>
        </table>
        <table className="cast">
          <thead><tr><th>#</th><th className="l">Cast</th><th className="l">Role</th><th>Status</th>{s.cast.some(c => c.pickup) && <th>Pickup</th>}<th>Report</th><th>Hair / makeup</th><th>Wardrobe</th><th>Ready on set</th><th className="l">Notes</th></tr></thead>
          <tbody>
            {s.cast.map(c => <tr key={c.castId}><td>{c.castId}</td><td className="l">{c.actor}</td><td className="l">{c.name}</td><td>{c.status}</td>{s.cast.some(x => x.pickup) && <td>{t(c.pickup)}</td>}<td>{fmtTime(c.call)}</td><td>{fmtTime(c.makeup)}</td><td>{fmtTime(c.wardrobe)}</td><td>{fmtTime(c.onSet)}</td><td className="l">{c.note}</td></tr>)}
            {stunts.length > 0 && <tr className="band"><td colSpan={10} className="l">Stunts</td></tr>}
            {stunts.map((e, i) => <tr key={e.id}><td>{`${i + 1}X`}</td><td className="l">{e.name}</td><td className="l">{e.role}</td><td>SW</td>{s.cast.some(x => x.pickup) && <td />}<td>{t(e.call || s.crewCall)}</td><td /><td /><td>{t(e.onSet || s.shootingCall)}</td><td className="l">{e.note}</td></tr>)}
          </tbody>
        </table>
        <div className="twocol">
          <div>
            <table className="extras">
              <thead><tr><th className="l">Stand-ins / photo doubles</th><th>In</th><th className="l">Notes</th></tr></thead>
              <tbody>{standins.map(e => <tr key={e.id}><td className="l">{e.name}{e.role ? ` (${e.role})` : ''}</td><td>{t(e.call || s.crewCall)}</td><td className="l">{e.note}</td></tr>)}{standins.length === 0 && <tr><td colSpan={3} className="l muted">none</td></tr>}</tbody>
            </table>
            <table className="extras">
              <thead><tr><th className="l">Background</th><th>In</th><th>Ready on set</th><th className="l">Notes</th></tr></thead>
              <tbody>{background.map(e => <tr key={e.id}><td className="l">{e.name}{e.role ? ` · ${e.role}` : ''}</td><td>{t(e.call)}</td><td>{t(e.onSet)}</td><td className="l">{e.note}</td></tr>)}{background.length === 0 && <tr><td colSpan={4} className="l muted">none</td></tr>}</tbody>
            </table>
          </div>
          <div>
            <table className="instr">
              <thead><tr><th colSpan={2} className="l">Special instructions</th></tr></thead>
              <tbody>{s.instructions.map(x => <tr key={x.dept}><td className="l dept">{x.dept}</td><td className="l">{x.items.join(' · ')}</td></tr>)}{s.instructions.length === 0 && <tr><td colSpan={2} className="l muted">{print ? '' : 'tags on the day\'s scenes and lines typed for the day land here'}</td></tr>}</tbody>
            </table>
            {s.safety && <p className="small"><b>Safety:</b> {s.safety}</p>}
            {s.meals && <p className="small"><b>Meals:</b> {s.meals}</p>}
          </div>
        </div>
        {s.advance.length > 0 && <table className="advance">
          <thead><tr><th colSpan={6} className="l band">Advance schedule</th></tr></thead>
          <tbody>
            {s.advance.map(a => <Fragment key={a.dayIndex}>
              <tr className="dayrow"><td colSpan={6} className="l"><b>Shoot day {a.dayIndex}</b>{a.date ? ` · ${shortDate(a.date)}` : ''} · estimated crew call {fmtTime(a.crewCall)}</td></tr>
              {a.scenes.slice(0, 5).map((x, i) => <tr key={i}><td>{x.number}</td><td className="l">{x.ie}. {x.set}</td><td className="l">{x.castIds.join(', ')}</td><td>{x.tod}</td><td>{x.pages}</td><td className="l">{x.location?.name ?? ''}</td></tr>)}
              {a.scenes.length > 5 && <tr><td colSpan={6} className="l muted">and {a.scenes.length - 5} more</td></tr>}
            </Fragment>)}
          </tbody>
        </table>}
        <footer className="csfoot"><span><b>UPM:</b> {who(upm)}</span><span><b>1st AD:</b> {who(ad1)}</span><span><b>2nd AD:</b> {who(ad2)}</span></footer>
      </div>
      <div className={`${cls} back`} style={style}>
        <header className="backhead"><span className="big">{fmtTime(s.crewCall)}</span><span className="ttl">Crew call</span><span>{s.title} · Day {s.dayIndex} of {s.dayCount} · {s.date ? shortDate(s.date) : ''}</span></header>
        <div className="crewcols">
          {deptCols.map((col, k) => <div key={k}>
            {col.map(d => <table key={d.dept} className="crew">
              <thead><tr><th colSpan={3} className="l">{d.dept}</th></tr></thead>
              <tbody>{d.people.map(x => { const n = named(x); return <tr key={x.id}><td className="l role" colSpan={n ? 1 : 2}>{x.role}</td>{n && <td className="l">{n}</td>}<td className="call">{/^o\/?c$/i.test(x.call) ? 'O/C' : fmtTime(x.call)}</td></tr>; })}{d.people.length === 0 && <tr><td className="l" colSpan={2}>{d.dept}</td><td className="call">{fmtTime(d.call)}</td></tr>}</tbody>
            </table>)}
          </div>)}
        </div>
        <div className="backrow">
          <div><h4>Safety bulletins for today's work</h4><p>{tbd(s.bulletins, 'bulletin numbers')}</p></div>
          <div><h4>Nearest hospital</h4><p>{tbd(s.logistics.hospital, 'hospital')}</p></div>
          <div><h4>Quote of the day</h4><p className="quote">{s.quote ? `“${s.quote}”` : ''}</p></div>
        </div>
        <div className="backrow"><div><h4>Total lunches</h4><p>{s.lunches}</p></div><div style={{ gridColumn: 'span 2' }}><h4>Additional notes</h4><p>{tbd(s.notes, 'notes for the day')}</p></div></div>
        <p className="small muted">All safety bulletins are available from the AD department on request.</p>
      </div>
    </>
  );
}
