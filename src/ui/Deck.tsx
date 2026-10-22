import type { CSSProperties } from 'react';
import type { Project } from '../engine/types';
import { withPitch, defaultDesign } from '../engine/pitch';
import { deckSlides, type Slide } from '../engine/deck';
import { money } from './format';
import { shortDate } from '../engine/calendar';

const CASE_LABEL: Record<string, string> = { low: 'Low', mid: 'Mid', high: 'High' };

/** The design system as CSS variables on the deck root; the app's own fonts fill in when none are set. */
export function deckStyle(p: Project): CSSProperties {
  const d = withPitch(p).pitch!.design ?? defaultDesign();
  return {
    '--dk-bg': d.colors.bg, '--dk-ink': d.colors.ink, '--dk-accent': d.colors.accent, '--dk-accent2': d.colors.accent2, '--dk-muted': d.colors.muted,
    '--dk-title': d.fonts.title || 'var(--font-title, inherit)', '--dk-body': d.fonts.body || 'var(--font-body, inherit)',
  } as CSSProperties;
}

/** The slides, 16:9, as one DOM for both the on-screen preview and the print. */
export function Deck({ p, byline, preview }: { p: Project; byline?: string; preview?: boolean }) {
  const slides = deckSlides(p, byline);
  const design = withPitch(p).pitch!.design;
  const n = slides.length;
  return (
    <div className={`deck ${preview ? 'preview' : ''}`} style={deckStyle(p)}>
      {slides.map((s, i) => (
        <section className={`slide s-${s.kind}`} key={i}>
          {design?.logoDataUrl && s.kind !== 'title' && <img className="logo" src={design.logoDataUrl} alt="" />}
          <SlideBody s={s} />
          <footer><span>{p.name}</span><span>{i + 1} / {n}</span></footer>
        </section>
      ))}
    </div>
  );
}

function SlideBody({ s }: { s: Slide }) {
  switch (s.kind) {
    case 'title': return (
      <div className="center">
        <h1>{s.title}</h1>
        {s.logline && <p className="logline">{s.logline}</p>}
        <p className="byline">{s.byline || s.version}</p>
      </div>
    );
    case 'text': return (<><h2>{s.heading}</h2><div className="prose">{s.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</div></>);
    case 'images': return (
      <>
        <h2>{s.heading}</h2>
        <div className={`grid g${Math.min(4, Math.max(1, s.images.length))}`}>
          {s.images.map(img => <figure key={img.id}><img src={img.dataUrl} alt={img.caption} />{(img.caption || img.credit) && <figcaption>{img.caption}{img.credit ? <span className="credit"> · {img.credit}</span> : null}</figcaption>}</figure>)}
        </div>
      </>
    );
    case 'audience': return (
      <>
        <h2>Who it's for</h2>
        <div className="cols">
          <div><h3>Primary</h3><p>{s.primary}</p></div>
          <div><h3>Secondary</h3><p>{s.secondary}</p></div>
          <div><h3>How we reach them</h3><p>{s.notes}</p></div>
        </div>
      </>
    );
    case 'comps': return (
      <>
        <h2>Comparable films</h2>
        {s.groups.map(g => (
          <div key={g.group} className="compgroup">
            {s.groups.length > 1 && <h3>{g.group}</h3>}
            <table>
              <thead><tr><th className="l">Title</th><th>Year</th><th className="l">Distributor</th><th>Budget</th><th>Worldwide</th><th>×</th></tr></thead>
              <tbody>
                {g.rows.map((r, i) => <tr key={i}><td className="l">{r.title}</td><td>{r.year}</td><td className="l">{r.distributor}</td><td>{r.budget != null ? money(r.budget) : ''}</td><td>{r.worldwide != null ? money(r.worldwide) : ''}</td><td>{r.multiple != null ? `${r.multiple.toFixed(1)}×` : ''}</td></tr>)}
                {g.medianMultiple != null && g.rows.length > 1 && <tr className="sub"><td className="l" colSpan={5}>Median, worldwide over budget</td><td>{g.medianMultiple.toFixed(1)}×</td></tr>}
              </tbody>
            </table>
          </div>
        ))}
      </>
    );
    case 'plan': return (
      <>
        <h2>The plan</h2>
        <div className="stats">
          <div><b>{s.days}</b><span>shoot days{s.first && s.last ? `, ${shortDate(s.first)} to ${shortDate(s.last)}` : ''}</span></div>
          <div><b>{s.scenes}</b><span>scenes{s.parked ? ` (+${s.parked} VFX / second unit)` : ''}</span></div>
          <div><b>{s.cast}</b><span>speaking parts</span></div>
          <div><b>{s.crew}</b><span>crew</span></div>
          <div><b>{s.sets.length}</b><span>sets</span></div>
        </div>
        <p className="muted">SAG-AFTRA {s.tier}; qualifies as {s.qualifies} as drawn.</p>
        {s.sets.length > 0 && <p className="sets">{s.sets.slice(0, 18).join(' · ')}{s.sets.length > 18 ? ` · and ${s.sets.length - 18} more` : ''}</p>}
      </>
    );
    case 'numbers': return (
      <>
        <h2>The numbers</h2>
        <div className="cols two">
          <table>
            <tbody>
              {s.sections.map(x => <tr key={x.name}><td className="l">{x.name}</td><td>{money(x.total)}</td></tr>)}
              <tr><td className="l">Contingency</td><td>{money(s.contingency)}</td></tr>
              <tr className="total"><td className="l">Budget to raise</td><td>{money(s.cashBudget)}</td></tr>
            </tbody>
          </table>
          <div className="stats vertical">
            <div><b>{money(s.investors)}</b><span>investors put in{s.incentives ? `, after ${money(s.incentives)} in incentives` : ''}</span></div>
            <div><b>{money(s.pointsValue)}</b><span>wages and fees traded for points</span></div>
            {s.deferred > 0 && <div><b>{money(s.deferred)}</b><span>deferred, paid from first proceeds</span></div>}
          </div>
        </div>
      </>
    );
    case 'deal': return (
      <>
        <h2>The deal</h2>
        <p className="lead">Investors recoup {s.recoupPct}% first{s.model === 'off-the-gross' ? ' while the pool takes a share from dollar one' : ''}; then {s.poolPct}% of net to the people who made the film, by points, and the rest to the investors.</p>
        <div className="cols two">
          <table>
            <thead><tr><th className="l">Points tier</th><th>×</th><th>People</th></tr></thead>
            <tbody>{s.tiers.map(t => <tr key={t.name}><td className="l">{t.name}</td><td>{t.multiplier}</td><td>{t.people}</td></tr>)}</tbody>
          </table>
          {s.cases.length > 0 && (
            <table>
              <thead><tr><th className="l">Case</th><th>Gross</th><th>Net to film</th><th>To investors</th><th>Return</th></tr></thead>
              <tbody>{s.cases.map(c => <tr key={c.label}><td className="l">{CASE_LABEL[c.label]}</td><td>{money(c.gross)}</td><td>{money(c.net)}</td><td>{money(c.investors)}</td><td>{c.multiple.toFixed(2)}×</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </>
    );
    case 'team': return (<><h2>The team</h2><div className={`cols ${s.members.length > 3 ? 'wrap' : ''}`}>{s.members.map(m => <div key={m.name}><h3>{m.name}</h3><p className="muted">{m.role}</p><p>{m.bio}</p></div>)}</div></>);
    case 'research': return (<><h2>What the research says</h2><div className="cols two wrap">{s.items.map((r, i) => <div key={i}><h3>{r.title}</h3><p>{r.body}</p>{r.url && <p className="muted small">{r.url}</p>}</div>)}</div></>);
    case 'ask': return (<><h2>The ask</h2><p className="big">{money(s.cashBudget)}</p><div className="prose">{s.body ? s.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>) : <p className="muted">[add: what you are raising, on what terms, and how to reach you]</p>}</div></>);
  }
}
