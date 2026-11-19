// The glossary, as a section under About. Every word and definition comes from glossary.ts; this file only draws
// them, filters them as someone types, and brings a linked term (#glossary-points) into view.
import { useEffect, useMemo, useRef, useState } from 'react';
import { GLOSSARY, GLOSSARY_GROUPS, GLOSSARY_NOTE, glossaryAnchor, glossaryIdFromHash, searchGlossary, type GlossaryTerm } from './glossary';

const byId = new Map(GLOSSARY.map(t => [t.id, t]));

export function Glossary({ onTour }: { onTour: () => void }) {
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState<string | null>(null);   // the term a link pointed at, marked so the eye finds it
  const section = useRef<HTMLDivElement>(null);
  const found = useMemo(() => searchGlossary(query), [query]);

  // A link to a term can arrive three ways: the page opened on it, a link in the tour or in another definition was
  // pressed, or the address was edited. All three end here. A search that is hiding the term is cleared first.
  useEffect(() => {
    const arrive = () => {
      const id = glossaryIdFromHash(location.hash);
      if (id === null) return;
      setQuery(''); setHit(id || null);
      // after the list has been redrawn without the search
      window.setTimeout(() => {
        const el = id ? document.getElementById(glossaryAnchor(id)) : section.current;
        el?.scrollIntoView?.({ block: id ? 'center' : 'start' });
        if (id) el?.focus({ preventScroll: true });
      }, 0);
    };
    arrive();
    window.addEventListener('hashchange', arrive);
    return () => window.removeEventListener('hashchange', arrive);
  }, []);

  const entry = (t: GlossaryTerm) => (
    <div key={t.id} id={glossaryAnchor(t.id)} tabIndex={-1} className={`gl-entry${hit === t.id ? ' hit' : ''}`}>
      <dt>
        {t.term}
        <a className="gl-link" href={`#${glossaryAnchor(t.id)}`} title="A link to this word" aria-label={`Link to ${t.term}`}>#</a>
      </dt>
      <dd>
        {t.text}
        {(t.also?.length || t.see?.length) ? <div className="gl-more">
          {t.also && t.also.length > 0 && <span className="gl-also">Also called: {t.also.join(', ')}. </span>}
          {t.see && t.see.length > 0 && <span className="gl-see">See {t.see.map((id, i) => <span key={id}>{i > 0 && ', '}<a href={`#${glossaryAnchor(id)}`}>{byId.get(id)?.term ?? id}</a></span>)}.</span>}
        </div> : null}
      </dd>
    </div>
  );

  return (
    <div className="panel glossary" id="glossary" ref={section}>
      <h2>Guide and glossary</h2>
      <div className="row gl-tour">
        <span className="help">New here? The two-minute tour walks an invented film from budget to pitch deck.</span>
        <button type="button" className="btn small" onClick={onTour}>Take the two-minute tour</button>
      </div>
      <p className="notice gl-note">{GLOSSARY_NOTE}</p>
      <div className="row gl-search">
        <div className="ctl">
          <label htmlFor="glossary-search">Find a word</label>
          <input id="glossary-search" type="search" value={query} placeholder="points, recoup, DOOD…" autoComplete="off" onChange={e => { setQuery(e.target.value); setHit(null); }} />
        </div>
        <span className="hint" role="status" aria-live="polite">{query.trim() ? `${found.length} of ${GLOSSARY.length} words` : `${GLOSSARY.length} words`}</span>
        {query && <button type="button" className="btn small" onClick={() => setQuery('')}>Show all</button>}
      </div>
      {query.trim()
        ? (found.length
          ? <dl className="gl-list">{found.map(entry)}</dl>
          : <p className="help">No word here matches “{query.trim()}”. Try a shorter word, or press Show all.</p>)
        : GLOSSARY_GROUPS.map(g => (
          <section key={g.id} aria-labelledby={`glossary-group-${g.id}`}>
            <h3 id={`glossary-group-${g.id}`}>{g.title}</h3>
            {g.intro && <p className="help">{g.intro}</p>}
            <dl className="gl-list">{GLOSSARY.filter(t => t.group === g.id).map(entry)}</dl>
          </section>
        ))}
    </div>
  );
}
