import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { Project } from '../engine/types';
import { withPitch, defaultDesign, defaultDeckRules } from '../engine/pitch';
import { deckSlides, type Slide } from '../engine/deck';
import { money } from './format';
import { shortDate } from '../engine/calendar';

const CASE_LABEL: Record<string, string> = { low: 'Low', mid: 'Mid', high: 'High' };
/** A source line shows where a finding came from, not the whole address. */
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** The design system as CSS variables on the deck root; the app's own fonts fill in when none are set. */
export function deckStyle(p: Project): CSSProperties {
  const d = withPitch(p).pitch!.design ?? defaultDesign();
  return {
    '--dk-bg': d.colors.bg, '--dk-ink': d.colors.ink, '--dk-accent': d.colors.accent, '--dk-accent2': d.colors.accent2, '--dk-muted': d.colors.muted, '--dk-line': d.line ?? d.colors.muted,
    '--dk-title': d.fonts.title || 'var(--font-title, inherit)', '--dk-body': d.fonts.body || 'var(--font-body, inherit)',
    '--dk-bleed': `${Math.round((d.deck?.bleed ?? 0.55) * 100)}%`,
  } as CSSProperties;
}

/** The slides, 16:9, as one DOM for both the on-screen preview and the print. */
export function Deck({ p, byline, preview }: { p: Project; byline?: string; preview?: boolean }) {
  const slides = deckSlides(p, byline);
  const design = withPitch(p).pitch!.design;
  const rules = design?.deck ?? defaultDeckRules();
  const n = slides.length;
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = root.current; if (!el) return; fitSlides(el); void document.fonts?.ready.then(() => fitSlides(el)); });
  const signoff = rules?.signoff?.trim();
  return (
    <div className={`deck ${preview ? 'preview' : ''} ${rules?.eyebrow ? 'eyebrows' : ''}`} style={deckStyle(p)} ref={root}>
      {slides.map((s, i) => {
        const photo = s.image;
        const hero = (s.kind === 'images' && s.images.length === 1) || (s.kind === 'title' && s.art);   // a cover picture fills the slide the way a look slide does
        return (
          <section className={`slide s-${s.kind} ${photo ? 'split' : ''} ${hero ? 'hero' : ''}`} key={i}>
            {hero && s.kind === 'images' && <div className="photo"><img src={s.images[0].dataUrl} alt={s.images[0].caption} /></div>}
            {photo && <div className="photo"><img src={photo.dataUrl} alt={photo.caption} /></div>}
            <div className="body">
              {design?.logoDataUrl && s.kind !== 'title' && s.kind !== 'closing' && <img className="logo" src={design.logoDataUrl} alt="" />}
              <SlideBody s={s} />
              {s.kind !== 'closing' && <footer><span>{i === n - 1 && signoff ? signoff : p.name}</span><span>{i + 1} / {n}</span></footer>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Text that runs past a slide's footer is set smaller until it fits (down to 70%), through the --fit variable the
 *  body sizes read. Measured in the browser, so the preview and the PDF render get the same size. */
export function fitSlides(root: HTMLElement) {
  for (const slide of root.querySelectorAll<HTMLElement>('.slide')) {
    const body = slide.querySelector<HTMLElement>(':scope > .body'); const footer = body?.querySelector<HTMLElement>(':scope > footer');
    if (!body || !footer || footer.getBoundingClientRect().height === 0) continue;   // a look slide or a cover hides its footer
    slide.style.setProperty('--fit', '1');
    const content = [...body.children].filter(c => c !== footer && !c.classList.contains('logo')) as HTMLElement[];
    const overflows = () => { const limit = footer.getBoundingClientRect().top - 6; return content.some(c => c.getBoundingClientRect().bottom > limit); };
    for (let fit = 1; fit > 0.7 && overflows(); fit -= 0.05) slide.style.setProperty('--fit', fit.toFixed(2));
  }
}

/** An eyebrow deck turns a heading into its label: "The plan" → "THE PLAN:". */
const H2 = ({ children }: { children: string }) => <h2>{children}<span className="colon">:</span></h2>;

function SlideBody({ s }: { s: Slide }) {
  switch (s.kind) {
    case 'title': return s.art ? (
      <div className="center closing">{s.logline && <p className="signoff caption logline">{s.logline}</p>}</div>   // the art carries the title and the byline; only the logline goes on the band
    ) : (
      <div className="center">
        <h1>{s.title}</h1>
        {s.logline && <p className="logline">{s.logline}</p>}
        <p className="byline">{s.byline || s.version}</p>
      </div>
    );
    case 'text': return (<><H2>{s.heading}</H2><div className="prose">{s.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</div></>);
    case 'closing': return (<div className="center closing"><p className="signoff">{s.signoff || s.title}</p></div>);
    case 'images': if (s.images.length === 1) return (<div className="center closing">{(s.images[0].caption || s.images[0].credit) && <p className="signoff caption">{s.images[0].caption}{s.images[0].credit ? <span className="credit"> · {s.images[0].credit}</span> : null}</p>}</div>); return (
      <>
        <H2>{s.heading}</H2>
        <div className={`grid g${Math.min(4, Math.max(1, s.images.length))}`}>
          {s.images.map(img => <figure key={img.id}><img src={img.dataUrl} alt={img.caption} />{(img.caption || img.credit) && <figcaption>{img.caption}{img.credit ? <span className="credit"> · {img.credit}</span> : null}</figcaption>}</figure>)}
        </div>
      </>
    );
    case 'audience': return (
      <>
        <H2>Who it's for</H2>
        <div className="cols">
          <div><h3>Primary</h3><p>{s.primary}</p></div>
          <div><h3>Secondary</h3><p>{s.secondary}</p></div>
          <div><h3>How we reach them</h3><p>{s.notes}</p></div>
        </div>
      </>
    );
    case 'comps': return (
      <>
        <H2>Comparable films</H2>
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
        <H2>The plan</H2>
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
        <H2>The numbers</H2>
        <div className="cols two">
          <table>
            <tbody>
              {s.sections.map(x => <tr key={x.name}><td className="l">{x.name}</td><td>{money(x.total)}</td></tr>)}
              <tr><td className="l">Contingency</td><td>{money(s.contingency)}</td></tr>
              <tr className="total"><td className="l">Budget to raise</td><td>{money(s.cashBudget)}</td></tr>
            </tbody>
          </table>
          <div className="stats vertical">
            <div><b>{money(s.investors)}</b><span>investors put in{s.grants || s.incentives ? `, after ${[s.grants ? `${money(s.grants)} in sponsorship and grants` : '', s.incentives ? `${money(s.incentives)} in credits` : ''].filter(Boolean).join(' and ')}` : ''}</span></div>
            <div><b>{money(s.pointsValue)}</b><span>wages and fees traded for points</span></div>
            {s.deferred > 0 && <div><b>{money(s.deferred)}</b><span>deferred, paid from first proceeds</span></div>}
          </div>
        </div>
      </>
    );
    case 'deal': return (
      <>
        <H2>The deal</H2>
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
    case 'team': return (<><H2>The team</H2><div className={`cols ${s.members.length > 3 ? 'wrap' : ''}`}>{s.members.map(m => <div key={m.name}><h3>{m.name}</h3><p className="muted">{m.role}</p><p>{m.bio}</p></div>)}</div></>);
    case 'research': return (<><H2>What the research says</H2><div className={`cols two wrap findings ${s.wide ? 'wide' : ''}`}>{s.items.map((r, i) => <div key={i} className="finding"><h3>{r.title}</h3><p className="detail">{r.body}</p>{r.url && <p className="muted small src">{host(r.url)}</p>}</div>)}</div></>);
    case 'ask': return (
      <>
        <H2>The ask</H2>
        <div className={`cols ${s.sources.length > 1 ? 'two' : ''}`}>
          <div>
            <p className="big">{money(s.cashBudget)}<span className="of"> to make the film</span></p>
            {s.sources.length > 1 && (
              <table className="stack">
                <tbody>
                  {s.sources.map(f => <tr key={f.label} className={f.label === 'Investors' ? 'investors' : ''}><td className="l">{f.label}<span className="terms">{f.terms}</span></td><td>{money(f.amount)}</td></tr>)}
                </tbody>
              </table>
            )}
            {s.without.length > 0 && <p className="contingent">The investor ask of {money(s.investors)} assumes the rest of the stack lands: {s.without.map(w => `${w.label} it is ${money(w.investors)}`).join('; ')}.</p>}
          </div>
          <div className="prose">{s.body ? s.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>) : <p className="muted">[add: what you are raising, on what terms, and how to reach you]</p>}</div>
        </div>
      </>
    );
  }
}
