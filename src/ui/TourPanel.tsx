// The two-minute tour: an invitation on the Start screen and a small panel of steps that stays in the corner while
// the person clicks around the sample film. It is not an overlay: nothing is covered or locked, and the app works
// as usual underneath. The steps and their wording live in tour.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { TOUR_STEPS, clampStep, dismissTourCard, isLastStep, nextStep, prevStep, tourCardDismissed, type TourStep } from './tour';
import { GLOSSARY, glossaryAnchor } from './glossary';

export interface TourState {
  open: boolean;
  step: number;
  cardGone: boolean;            // the invitation has been dismissed (or the tour finished) in this browser
  start: () => void;
  close: () => void;
  finish: () => void;
  dismissCard: () => void;
  go: (i: number) => void;
}

/** Where the tour is. Only the dismissal is remembered between visits; a reload closes the panel, which is one click to reopen. */
export function useTour(): TourState {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [cardGone, setCardGone] = useState(tourCardDismissed);
  const dismissCard = useCallback(() => { dismissTourCard(); setCardGone(true); }, []);
  return {
    open, step, cardGone, dismissCard,
    start: useCallback(() => { setStep(0); setOpen(true); }, []),
    close: useCallback(() => setOpen(false), []),
    // someone who has walked the tour to the end does not need inviting again
    finish: useCallback(() => { dismissTourCard(); setCardGone(true); setOpen(false); }, []),
    go: useCallback((i: number) => setStep(clampStep(i)), []),
  };
}

/** The invitation on the Start screen: one line, one button, one × that is remembered. */
export function TourCard({ onTake, onDismiss }: { onTake: () => void; onDismiss: () => void }) {
  return (
    <div className="notice row tourcard" role="region" aria-label="Two-minute tour">
      <span><b>New here?</b> Take the two-minute tour. It walks an invented film from budget to pitch deck in six steps.</span>
      <button type="button" className="btn small primary" onClick={onTake}>Take the tour</button>
      <button type="button" className="x" title="Do not show this again" aria-label="No thanks, do not show the tour invitation again" onClick={onDismiss}>×</button>
    </div>
  );
}

/** Point at a part of the page for a few seconds: scroll it into view and ring it. The tab may still be drawing
 *  (the Pitch tab loads its deck late), so look for it a few times before giving up quietly. */
export function spotlight(selector: string | undefined): void {
  if (!selector || typeof document === 'undefined') return;
  let tries = 0;
  const look = () => {
    const [css, words] = selector.split(' >> ');
    const el = [...document.querySelectorAll<HTMLElement>(css)].find(x => !words || (x.textContent ?? '').includes(words)) ?? null;
    if (!el) { if (++tries < 25) window.setTimeout(look, 120); return; }
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView?.({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    document.querySelectorAll('.tour-spot').forEach(x => x.classList.remove('tour-spot'));
    el.classList.add('tour-spot');
    window.setTimeout(() => el.classList.remove('tour-spot'), 4500);
  };
  window.setTimeout(look, 60);   // after the tab has had a chance to draw
}

const termName = new Map(GLOSSARY.map(t => [t.id, t.term]));

export function TourPanel({ tour, onGo, otherProject }: {
  tour: TourState;
  /** Do what the step's button promises: load the sample, or switch tab. */
  onGo: (step: TourStep) => void;
  /** The title of the film that is open when it is not the sample, so the panel can say whose numbers these are. */
  otherProject: string | null;
}) {
  const s = TOUR_STEPS[clampStep(tour.step)];
  const last = isLastStep(tour.step);
  const head = useRef<HTMLHeadingElement>(null);
  // Folded, the panel is one line: for when it sits on the very thing a step asks you to press (a phone, mostly).
  const [folded, setFolded] = useState(false);
  // The panel sits at the end of the page, a long way from the button that opened it: put the keyboard and the
  // screen reader on the step's title when it opens and each time the step changes.
  useEffect(() => { head.current?.focus({ preventScroll: true }); }, [tour.step]);
  useEffect(() => { setFolded(false); }, [tour.step]);   // a new step is something to read
  return (
    <>
      <div className="tour-room" aria-hidden="true" />{/* room at the foot of the page so the panel never sits on the last lines */}
      <aside className={`tour${folded ? ' folded' : ''}`} role="region" aria-label="Two-minute tour" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); tour.close(); } }}>
        <div className="tour-top">
          <span className="tour-count">Step {clampStep(tour.step) + 1} of {TOUR_STEPS.length}</span>
          <span className="tour-keys">
            <button type="button" className="btn small" aria-expanded={!folded} aria-controls="tour-step" onClick={() => setFolded(f => !f)}>{folded ? 'Show the step' : 'Tuck away'}</button>
            <button type="button" className="x" title="Close the tour (Esc)" aria-label="Close the tour" onClick={tour.close}>×</button>
          </span>
        </div>
        <h2 ref={head} tabIndex={-1}>{s.title}</h2>
        <div id="tour-step" hidden={folded}>
        {s.body.map((line, i) => <p key={i}>{line}</p>)}
        {otherProject !== null && s.id !== 'sample' && <p className="tour-note">You have {otherProject || 'your own film'} open, not the sample. These steps are written for Salt Flat; step 1 opens it beside yours, and yours stays saved.</p>}
        <p className="tour-terms">Words here: {s.terms.map((id, i) => <span key={id}>{i > 0 && ', '}<a href={`#${glossaryAnchor(id)}`}>{termName.get(id) ?? id}</a></span>)}</p>
        <div className="tour-btns">
          <button type="button" className="btn small primary" aria-label={s.goName} onClick={() => onGo(s)}>{s.go}</button>
          <span className="spacer" />
          <button type="button" className="btn small" disabled={tour.step === 0} onClick={() => tour.go(prevStep(tour.step))}>Back</button>
          {last
            ? <button type="button" className="btn small" onClick={tour.finish}>Done</button>
            : <button type="button" className="btn small" onClick={() => tour.go(nextStep(tour.step))}>Next</button>}
        </div>
        </div>
      </aside>
    </>
  );
}
