import { useEffect, useRef } from 'react';

// what the Tab key stops on
const STOPS = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/** A pop-out that behaves like a dialog for someone on the keyboard: focus moves into it when it opens, Tab goes round
 *  inside it and not into the page underneath, and when it closes focus goes back to whatever opened it. Put the
 *  returned ref on the pop-out's card. (Escape is each pop-out's own business: they already close on it.) */
export function useModalFocus<T extends HTMLElement = HTMLDivElement>() {
  const card = useRef<T>(null);
  useEffect(() => {
    const el = card.current; if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // a field inside may already have asked for focus; otherwise the card itself takes it, so the next Tab lands inside
    if (!el.contains(document.activeElement)) { if (!el.hasAttribute('tabindex')) el.tabIndex = -1; el.focus({ preventScroll: true }); }
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // checkVisibility leaves out what sits inside a shut fold, which cannot take focus
      const stops = [...el.querySelectorAll<HTMLElement>(STOPS)].filter(x => x.checkVisibility?.() ?? true);
      if (!stops.length) { e.preventDefault(); return; }
      const first = stops[0], last = stops[stops.length - 1], here = document.activeElement;
      const outside = !el.contains(here);
      if (e.shiftKey && (here === first || here === el || outside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (here === last || outside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', on, true);
    return () => { document.removeEventListener('keydown', on, true); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return card;
}

/** For something that is pressed but is not a button (a table cell, a chip): Enter and Space press it, as they would a
 *  button. Keys typed into a field inside it are left alone. */
export function pressKey(press: () => void) {
  return (e: { key: string; target: EventTarget; currentTarget: EventTarget; preventDefault: () => void }) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault(); press();
  };
}
