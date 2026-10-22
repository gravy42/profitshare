import { useState } from 'react';
import type { CallContact, CallSheetDay, Location, Project } from '../engine/types';
import { shootDays } from '../engine/board';
import { shootDates, shortDate, withCalendar } from '../engine/calendar';
import { buildSheet, fmtTime, locationsFromBoard, newLocation, withCallSheets, type Sheet } from '../engine/callsheet';
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
  const field = (k: 'crewCall' | 'shootingCall' | 'lunch' | 'wrap' | 'weather' | 'notes' | 'safety' | 'meals', v: string) => setDay(d => { const n = { ...d }; if (v === '') delete n[k]; else n[k] = v; return n; });
  const setCast = (id: number, k: 'status' | 'pickup' | 'call' | 'makeup' | 'onSet' | 'note', v: string) => setDay(d => { const c = { ...(d.cast[id] ?? {}) }; if (v === '') delete c[k]; else c[k] = v; return { ...d, cast: { ...d.cast, [id]: c } }; });
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
        <p className="help">One sheet per shoot day. The scenes, sets, pages and cast come from the stripboard, the date from the Calendar, the actors and crew from the Points schedule (an actor is matched by cast number, crew are sorted into departments by role), and the addresses from the Locations table below. Type what the day needs and it stays with that day; a blank field means the default. Print saves a PDF, one page a day.</p>
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
            <div className="ctl" style={{ flex: 1 }}><label>Weather</label><input value={over.weather ?? ''} placeholder={sheet.sunrise ? `sunrise ${sheet.sunrise}, sunset ${sheet.sunset}` : 'high 72, low 55, clear'} onChange={e => field('weather', e.target.value)} /></div>
          </div>
          <h3 style={{ margin: '12px 0 4px' }}>Cast · {sheet.cast.length}</h3>
          <table className="compact">
            <thead><tr><th>#</th><th className="l">Character</th><th className="l">Actor</th><th>Status</th><th>Pickup</th><th>Call</th><th>Makeup</th><th>On set</th><th className="l">Note</th></tr></thead>
            <tbody>
              {sheet.cast.map(c => { const o = over.cast[c.castId] ?? {}; return <tr key={c.castId}>
                <td>{c.castId}</td><td className="l">{c.name}</td><td className="l">{c.actor || <span className="muted">[cast number {c.castId} on the Points schedule]</span>}</td>
                <td><input value={o.status ?? ''} placeholder={c.status} style={{ width: 52, textAlign: 'center' }} onChange={e => setCast(c.castId, 'status', e.target.value.toUpperCase())} /></td>
                <td><TimeInput value={o.pickup ?? ''} onChange={v => setCast(c.castId, 'pickup', v)} /></td>
                <td><TimeInput value={o.call ?? ''} placeholder={sheet.crewCall} onChange={v => setCast(c.castId, 'call', v)} /></td>
                <td><TimeInput value={o.makeup ?? ''} placeholder={sheet.crewCall} onChange={v => setCast(c.castId, 'makeup', v)} /></td>
                <td><TimeInput value={o.onSet ?? ''} placeholder={sheet.shootingCall} onChange={v => setCast(c.castId, 'onSet', v)} /></td>
                <td><input value={o.note ?? ''} placeholder="drives self; fitting at lunch" onChange={e => setCast(c.castId, 'note', e.target.value)} /></td>
              </tr>; })}
            </tbody>
          </table>
          <h3 style={{ margin: '12px 0 4px' }}>Crew calls by department</h3>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            {sheet.depts.map(d => <div className="ctl" key={d.dept}><label>{d.dept} <span className="hint">{d.people.length}</span></label><TimeInput value={over.depts[d.dept] ?? ''} placeholder={sheet.crewCall} onChange={v => setDept(d.dept, v)} /></div>)}
            {sheet.depts.length === 0 && <p className="help small">No crew on the Points schedule yet; add them there with their roles and they sort into departments here.</p>}
          </div>
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
            <div className="ctl" style={{ flex: 1 }}><label>Notes</label><textarea rows={3} value={over.notes ?? ''} placeholder="Set is hot at 7:30. Company moves after lunch. Wrap out all gear tonight." onChange={e => field('notes', e.target.value)} /></div>
            <div className="ctl" style={{ flex: 1 }}><label>Safety</label><textarea rows={3} value={over.safety ?? ''} placeholder="Skating sequence: coordinator on set; helmets for doubles. Nearest hospital on the sheet." onChange={e => field('safety', e.target.value)} /></div>
            <div className="ctl" style={{ flex: 1 }}><label>Meals</label><textarea rows={3} value={over.meals ?? ''} placeholder="Breakfast at crew call; lunch at 13:00 by the truck." onChange={e => field('meals', e.target.value)} /></div>
          </div>
          <h3 style={{ margin: '14px 0 6px' }}>The sheet as it prints</h3>
          <div className="sheetwrap"><CallSheetPage s={sheet} /></div>
        </>}
      </div>

      {printing && <PrintPortal title={`${p.name} · Call sheet${printing === 'all' ? 's' : ` day ${dayIndex}`}`} onDone={() => setPrinting(null)}>
        {(printing === 'all' ? days.map(d => d.index) : [dayIndex]).map(i => { const s = buildSheet(p, i); return s ? <CallSheetPage key={i} s={s} print /> : null; })}
      </PrintPortal>}
    </div>
  );
}

/** The sheet itself: the classic one page. The same markup prints and previews. */
export function CallSheetPage({ s, print }: { s: Sheet; print?: boolean }) {
  const tbd = (v: string, what: string) => v.trim() || (print ? '' : <span className="muted">[add: {what}]</span>);
  const contacts = s.contacts.filter(c => !print || c.name.trim() || c.phone.trim());
  // a placeholder crew list has the role for a name; show each person once, the role in brackets only when it adds something
  const person = (x: { name: string; role: string }) => !x.name.trim() || x.name.trim().toLowerCase() === x.role.trim().toLowerCase() ? x.role : `${x.name} (${x.role})`;
  return (
    <div className="callsheet">
      <header className="cshead">
        <div className="who">
          <div className="co">{tbd(s.company, 'production company')}</div>
          <div className="title">{s.title}</div>
          <div className="muted small">{s.version}</div>
          {contacts.map((c, i) => <div key={i} className="small">{c.role}{c.name ? `: ${c.name}` : ''}{c.phone ? ` · ${c.phone}` : ''}</div>)}
        </div>
        <div className="calls">
          <div className="dayof">Day {s.dayIndex} of {s.dayCount}</div>
          <div className="date">{s.dateText}</div>
          <div className="big">Crew call {fmtTime(s.crewCall)}</div>
          <div>Shooting call {fmtTime(s.shootingCall)} · Lunch {fmtTime(s.lunch)} · Est. wrap {fmtTime(s.wrap)}</div>
          <div className="small">{s.sunrise ? `Sunrise ${s.sunrise} · Sunset ${s.sunset}` : 'Sunrise / sunset: add coordinates to the location'}{s.weather ? ` · ${s.weather}` : ''}</div>
        </div>
      </header>
      <section className="csgrid">
        <div>
          <h4>Locations</h4>
          {s.locations.length === 0 && !print && <p className="muted small">[add: the day's sets to a location in the Locations table]</p>}
          {s.locations.map(l => <div key={l.id} className="loc"><b>{l.name}</b>{l.sets ? <span className="muted"> · {l.sets}</span> : null}<div>{tbd(l.address, 'address')}</div>{l.parking && <div><span className="muted">Parking:</span> {l.parking}</div>}{l.hospital && <div><span className="muted">Hospital:</span> {l.hospital}</div>}{l.notes && <div className="muted">{l.notes}</div>}</div>)}
        </div>
        <div>
          <h4>Notes</h4>
          <p>{tbd(s.notes, 'notes for the day')}</p>
          {s.safety && <><h4>Safety</h4><p>{s.safety}</p></>}
          {s.meals && <><h4>Meals</h4><p>{s.meals}</p></>}
        </div>
      </section>
      <table className="sched">
        <colgroup><col style={{ width: '5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '24%' }} /><col style={{ width: '12%' }} /><col style={{ width: '28%' }} /><col style={{ width: '9%' }} /><col style={{ width: '6%' }} /><col style={{ width: '11%' }} /></colgroup>
        <thead><tr><th>Sc</th><th>I/E</th><th className="l">Set</th><th>D/N</th><th className="l">Synopsis</th><th className="l">Cast</th><th>Pgs</th><th className="l">Loc</th></tr></thead>
        <tbody>
          {s.scenes.map((x, i) => <tr key={i}><td>{x.number}</td><td>{x.ie}</td><td className="l">{x.set}</td><td>{x.tod}</td><td className="l">{x.synopsis}</td><td className="l">{x.castIds.join(', ')}</td><td>{x.pages}</td><td className="l small">{x.location?.name ?? ''}</td></tr>)}
          <tr className="sub"><td colSpan={6} className="l">Total pages</td><td>{s.pages}</td><td /></tr>
        </tbody>
      </table>
      <table className="cast">
        <thead><tr><th>#</th><th className="l">Character</th><th className="l">Actor</th><th>Status</th><th>Pickup</th><th>Call</th><th>Makeup</th><th>On set</th><th className="l">Note</th></tr></thead>
        <tbody>{s.cast.map(c => <tr key={c.castId}><td>{c.castId}</td><td className="l">{c.name}</td><td className="l">{c.actor}</td><td>{c.status}</td><td>{c.pickup ? fmtTime(c.pickup) : ''}</td><td>{fmtTime(c.call)}</td><td>{fmtTime(c.makeup)}</td><td>{fmtTime(c.onSet)}</td><td className="l">{c.note}</td></tr>)}</tbody>
      </table>
      {s.advance.length > 0 && <div className="advance">
        <h4>Advance schedule · Day {s.dayIndex + 1}{s.advanceDate ? ` · ${shortDate(s.advanceDate)}` : ''}</h4>
        <p className="small">{s.advance.slice(0, 12).map(x => `${x.number} ${x.ie} ${x.set} (${x.tod.toLowerCase()}, ${x.pages}, cast ${x.castIds.join(' ') || 'none'})`).join(' · ')}{s.advance.length > 12 ? ` · and ${s.advance.length - 12} more` : ''}</p>
      </div>}
      {/* the crew by department comes last so a long crew list runs onto the back of the sheet and the front keeps the schedule, the cast and the advance */}
      {s.depts.length > 0 && <div className="depts">
        {s.depts.map(d => <div key={d.dept} className="dept"><b>{d.dept}</b> <span className="call">{fmtTime(d.call)}</span><div className="small">{d.people.map(person).join(' · ')}</div></div>)}
      </div>}
    </div>
  );
}
