// @vitest-environment jsdom
// A pop-out for someone on the keyboard: focus goes in when it opens, Tab stays inside, and focus goes back to the
// button that opened it when it shuts. And the thing that is pressed without being a button answers Enter and Space.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pressKey, useModalFocus } from './modalFocus';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

function Popout({ onClose }: { onClose: () => void }) {
  const card = useModalFocus();
  return <div ref={card} role="dialog" aria-label="Day out of days"><button id="one">Number by scenes</button><button id="two" onClick={onClose}>Close</button><button disabled>Off</button></div>;
}
function Page() {
  const [open, setOpen] = useState(false);
  return <div><button id="opener" onClick={() => setOpen(true)}>Pop out</button><button id="under">Under the pop-out</button>{open && <Popout onClose={() => setOpen(false)} />}</div>;
}

let root: Root | undefined; let host: HTMLElement | undefined;
const draw = () => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(<Page />)); };
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; });
const tab = (shift = false) => { const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }); act(() => { document.activeElement!.dispatchEvent(e); }); return e.defaultPrevented; };
const el = (id: string) => document.getElementById(id) as HTMLElement;

describe('useModalFocus', () => {
  it('moves focus into the pop-out when it opens', () => {
    draw(); el('opener').focus(); act(() => el('opener').click());
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
  });
  it('keeps Tab inside: forward from the last stop goes to the first, back from the first goes to the last', () => {
    draw(); el('opener').focus(); act(() => el('opener').click());
    el('two').focus(); expect(tab()).toBe(true); expect(document.activeElement).toBe(el('one'));
    expect(tab(true)).toBe(true); expect(document.activeElement).toBe(el('two'));   // the disabled button is not a stop
    el('one').focus(); expect(tab()).toBe(false);   // in the middle the browser moves focus itself
  });
  it('pulls focus back in if it has got out to the page underneath', () => {
    draw(); el('opener').focus(); act(() => el('opener').click());
    el('under').focus(); expect(tab()).toBe(true); expect(document.activeElement).toBe(el('one'));
  });
  it('hands focus back to the button that opened it when it shuts', () => {
    draw(); el('opener').focus(); act(() => el('opener').click());
    act(() => el('two').click());
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(el('opener'));
  });
});

describe('pressKey', () => {
  const key = (k: string, target: EventTarget, currentTarget: EventTarget) => ({ key: k, target, currentTarget, preventDefault: vi.fn() });
  it('presses on Enter and on Space, and stops the page scrolling', () => {
    const press = vi.fn(); const chip = new EventTarget();
    const enter = key('Enter', chip, chip), space = key(' ', chip, chip);
    pressKey(press)(enter); pressKey(press)(space);
    expect(press).toHaveBeenCalledTimes(2); expect(space.preventDefault).toHaveBeenCalled();
  });
  it('leaves other keys alone, and keys typed into something inside it', () => {
    const press = vi.fn(); const chip = new EventTarget(), inside = new EventTarget();
    pressKey(press)(key('a', chip, chip)); pressKey(press)(key('Enter', inside, chip));
    expect(press).not.toHaveBeenCalled();
  });
});
