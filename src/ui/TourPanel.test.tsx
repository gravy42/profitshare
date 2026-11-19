// @vitest-environment jsdom
// The tour and the glossary as a person meets them: the invitation, the steps, the search box, a link to a word.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TourCard, TourPanel, useTour } from './TourPanel';
import { Glossary } from './GlossarySection';
import { TOUR_KEY, TOUR_STEPS, type TourStep } from './tour';
import { GLOSSARY, GLOSSARY_NOTE } from './glossary';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root | null = null;
let box: HTMLElement | null = null;
beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', location.pathname);
});
afterEach(() => {
  act(() => root?.unmount());
  box?.remove();
  root = null;
  box = null;
  vi.useRealTimers();
});

const draw = (ui: React.ReactNode): HTMLElement => {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(ui));
  return box;
};
const button = (el: HTMLElement, name: string | RegExp) => {
  const b = [...el.querySelectorAll('button')].find(x => {
    const n = x.getAttribute('aria-label') ?? x.textContent ?? '';
    return typeof name === 'string' ? n === name : name.test(n);
  });
  if (!b) throw new Error(`no button named ${name}`);
  return b;
};
const press = (b: HTMLElement) =>
  act(() => {
    b.click();
  });
/** Every button and field has a name a screen reader can say. */
const allNamed = (el: HTMLElement) => {
  for (const b of el.querySelectorAll('button'))
    expect((b.getAttribute('aria-label') ?? b.textContent ?? '').trim().length, b.outerHTML).toBeGreaterThan(0);
  for (const i of el.querySelectorAll('input'))
    expect(
      i.getAttribute('aria-label') || (i.id && el.querySelector(`label[for="${i.id}"]`)?.textContent),
      i.outerHTML,
    ).toBeTruthy();
};

/** Stands in for the app: the Start screen's invitation, and the panel when the tour is open. */
function Harness({ went }: { went: (s: TourStep) => void }) {
  const tour = useTour();
  return (
    <>
      {!tour.cardGone && !tour.open && <TourCard onTake={tour.start} onDismiss={tour.dismissCard} />}
      {tour.open && <TourPanel tour={tour} onGo={went} otherProject={null} />}
    </>
  );
}

describe('the invitation', () => {
  it('is there for a new browser, with named buttons', () => {
    const el = draw(<Harness went={() => {}} />);
    expect(el.textContent).toContain('Take the two-minute tour');
    allNamed(el);
  });
  it('goes away with one click and stays away', () => {
    const el = draw(<Harness went={() => {}} />);
    press(button(el, /^No thanks/));
    expect(el.querySelector('.tourcard')).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe('1');
    act(() => root!.unmount());
    box!.remove();
    const again = draw(<Harness went={() => {}} />); // the next visit
    expect(again.querySelector('.tourcard')).toBeNull();
  });
});

describe('the steps panel', () => {
  const open = (went: (s: TourStep) => void = () => {}) => {
    const el = draw(<Harness went={went} />);
    press(button(el, 'Take the tour'));
    return el;
  };

  it('opens on step 1, hides the invitation and puts the keyboard on the step title', () => {
    const el = open();
    expect(el.querySelector('.tourcard')).toBeNull();
    expect(el.querySelector('.tour-count')!.textContent).toBe(`Step 1 of ${TOUR_STEPS.length}`);
    expect(el.querySelector('.tour h2')!.textContent).toBe(TOUR_STEPS[0].title);
    expect(document.activeElement).toBe(el.querySelector('.tour h2'));
    expect((button(el, 'Back') as HTMLButtonElement).disabled).toBe(true);
    allNamed(el);
  });
  it('walks forward and back, and hands the step to the app when its button is pressed', () => {
    const went = vi.fn();
    const el = open(went);
    press(button(el, 'Next'));
    press(button(el, 'Next'));
    expect(el.querySelector('.tour h2')!.textContent).toBe(TOUR_STEPS[2].title);
    press(button(el, 'Back'));
    expect(el.querySelector('.tour h2')!.textContent).toBe(TOUR_STEPS[1].title);
    press(button(el, TOUR_STEPS[1].goName));
    expect(went).toHaveBeenCalledTimes(1);
    expect(went.mock.calls[0][0].id).toBe(TOUR_STEPS[1].id);
  });
  it('ends with Done, which also retires the invitation', () => {
    const el = open();
    for (let i = 1; i < TOUR_STEPS.length; i++) press(button(el, 'Next'));
    expect([...el.querySelectorAll('button')].some(b => b.textContent === 'Next')).toBe(false);
    press(button(el, 'Done'));
    expect(el.querySelector('.tour')).toBeNull();
    expect(el.querySelector('.tourcard')).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe('1');
  });
  it('closes on Esc or its ×, and the invitation is still there next time unless it was dismissed', () => {
    const el = open();
    act(() => {
      el.querySelector('.tour h2')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(el.querySelector('.tour')).toBeNull();
    expect(el.querySelector('.tourcard')).not.toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBeNull();
    press(button(el, 'Take the tour'));
    press(button(el, 'Close the tour'));
    expect(el.querySelector('.tour')).toBeNull();
  });
  it('says so when the film that is open is not the sample', () => {
    function Other() {
      const tour = useTour();
      return tour.open ? (
        <TourPanel tour={tour} onGo={() => {}} otherProject="Nine Miles" />
      ) : (
        <button onClick={tour.start}>go</button>
      );
    }
    const el = draw(<Other />);
    press(button(el, 'go'));
    expect(el.querySelector('.tour-note')).toBeNull(); // step 1 is the one that opens the sample
    press(button(el, 'Next'));
    expect(el.querySelector('.tour-note')!.textContent).toContain('Nine Miles');
  });
  it("links each step's words to the glossary", () => {
    const el = open();
    const links = [...el.querySelectorAll<HTMLAnchorElement>('.tour-terms a')].map(a => a.getAttribute('href'));
    expect(links).toEqual(TOUR_STEPS[0].terms.map(t => `#glossary-${t}`));
  });
});

describe('the glossary', () => {
  const type = (el: HTMLElement, text: string) =>
    act(() => {
      const input = el.querySelector<HTMLInputElement>('#glossary-search')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const entries = (el: HTMLElement) => [...el.querySelectorAll('.gl-entry')].map(e => e.id);

  it('opens with the not-legal-advice line before any word, every word listed, every control named', () => {
    const el = draw(<Glossary onTour={() => {}} />);
    const note = el.querySelector('.gl-note')!;
    expect(note.textContent).toBe(GLOSSARY_NOTE);
    expect(
      note.compareDocumentPosition(el.querySelector('.gl-entry')!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(entries(el)).toHaveLength(GLOSSARY.length);
    expect(new Set(entries(el)).size).toBe(GLOSSARY.length);
    allNamed(el);
    for (const a of el.querySelectorAll('a'))
      expect((a.getAttribute('aria-label') ?? a.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
  it('narrows as you type, says how many are left, and comes back with Show all', () => {
    const el = draw(<Glossary onTour={() => {}} />);
    type(el, 'pari');
    expect(entries(el)).toEqual(['glossary-pari-passu']);
    expect(el.querySelector('[role="status"]')!.textContent).toBe(`1 of ${GLOSSARY.length} words`);
    type(el, 'qwertyuiop');
    expect(entries(el)).toHaveLength(0);
    expect(el.textContent).toContain('No word here matches');
    press(button(el, 'Show all'));
    expect(entries(el)).toHaveLength(GLOSSARY.length);
  });
  it('starts the tour from its own button', () => {
    const onTour = vi.fn();
    const el = draw(<Glossary onTour={onTour} />);
    press(button(el, 'Take the two-minute tour'));
    expect(onTour).toHaveBeenCalledTimes(1);
  });
  it('marks the word a link points at, on arrival and when a link is pressed later, clearing a search that hid it', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '#glossary-points');
    const el = draw(<Glossary onTour={() => {}} />);
    act(() => {
      vi.runAllTimers();
    });
    expect(el.querySelector('.gl-entry.hit')!.id).toBe('glossary-points');
    expect(document.activeElement!.id).toBe('glossary-points');
    type(el, 'stripboard');
    expect(el.querySelector('#glossary-waterfall')).toBeNull();
    history.replaceState(null, '', '#glossary-waterfall');
    act(() => {
      window.dispatchEvent(new Event('hashchange'));
      vi.runAllTimers();
    });
    expect(el.querySelector<HTMLInputElement>('#glossary-search')!.value).toBe('');
    expect(el.querySelector('.gl-entry.hit')!.id).toBe('glossary-waterfall');
  });
});
