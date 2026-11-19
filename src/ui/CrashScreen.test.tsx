// @vitest-environment jsdom
// The screen that stands in when the whole page cannot be drawn. A component that throws on purpose stands in for a
// view that a project broke; it holds the real store hook, so "which project was open" is the real answer.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppBoundary } from './CrashScreen';
import { crashedIds, resetCrashState, saveSlot, useProject } from '../store';
import { sampleProject } from '../data/seed';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root | null = null;
let box: HTMLElement | null = null;
let logged: ReturnType<typeof vi.spyOn>;
const armed = { on: true };
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetCrashState();
  armed.on = true;
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  saveSlot('good', sampleProject());
  saveSlot('trouble', { ...sampleProject(), name: 'Nine Miles', version: 'v2' });
  localStorage.setItem('profitshare.activeProject', 'trouble');
});
afterEach(() => {
  act(() => root?.unmount());
  box?.remove();
  root = null;
  box = null;
  vi.restoreAllMocks();
});

/** Stands in for the app: opens what the store says to open, and cannot draw "Nine Miles". */
function Probe() {
  const s = useProject();
  if (armed.on && s.activeId === 'trouble') throw new Error('Cannot draw scene 12');
  return (
    <div id="probe" data-open={s.activeId ?? 'none'}>
      {s.startNote}
      <button type="button" onClick={() => s.openProject('trouble')}>
        open trouble
      </button>
    </div>
  );
}
function draw(reload?: () => void): HTMLElement {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => {
    root!.render(
      <AppBoundary reload={reload}>
        <Probe />
      </AppBoundary>,
    );
  });
  return box;
}
const button = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent) === name)!;
const settle = (ms = 0) =>
  act(async () => {
    await new Promise(r => setTimeout(r, ms));
  });
/** Stands in for the browser's download: the file names it was asked to save. */
function downloads(): string[] {
  const names: string[] = [];
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return names;
}

describe('the crash screen', () => {
  it('stands in for the page: what happened, that nothing was deleted, three ways on, and the details', () => {
    const el = draw();
    const alert = el.querySelector('[role="alert"]')!;
    expect(alert).toBeTruthy();
    expect(el.querySelector('#probe')).toBeNull();
    expect(alert.textContent).toContain('ProfitShare ran into a problem while drawing “Nine Miles” and had to stop.');
    expect(alert.textContent).toContain('The projects saved in this browser have not been deleted.');
    expect(alert.textContent).not.toContain('!');
    for (const name of ['Download every saved project', 'Go to the start screen', 'Reload']) {
      const b = button(el, name);
      expect(b, name).toBeTruthy();
      expect(b.type).toBe('button');
      expect(b.disabled).toBe(false);
      expect(b.tabIndex).toBe(0);
      expect(b.className).toContain('btn');
    }
    expect(document.activeElement).toBe(el.querySelector('h2')); // focus is on the screen, so Tab goes to its buttons
    const details = el.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Details');
    expect(details.querySelector('pre')!.textContent).toContain('Error: Cannot draw scene 12');
    expect(
      logged.mock.calls.some(
        (c: unknown[]) =>
          c[0] === 'ProfitShare could not draw the page' && (c[1] as Error).message === 'Cannot draw scene 12',
      ),
    ).toBe(true);
    expect([...el.querySelectorAll('.crash-list td:first-child')].map(td => td.textContent)).toEqual([
      'Nine Miles (was open)',
      'SALT FLAT',
    ]);
    expect(el.innerHTML).not.toMatch(/ on[a-z]+="/); // no inline handlers
  });
  it('nothing saved is touched, and the project is marked so no tab opens it again by itself', () => {
    const before = localStorage.getItem('profitshare.project.trouble');
    draw();
    expect(localStorage.getItem('profitshare.project.trouble')).toBe(before);
    expect(localStorage.getItem('profitshare.projects')).toContain('Nine Miles');
    expect(crashedIds()).toEqual(['trouble']);
  });
  it('Download every saved project hands over each one, the one that crashed included', async () => {
    const names = downloads();
    const el = draw();
    act(() => {
      button(el, 'Download every saved project').click();
    });
    await settle(700);
    expect(names).toEqual(['Nine_Miles_v2.profitshare.json', 'SALT_FLAT_Draft_3.profitshare.json']);
    expect(el.querySelector('[role="status"]')!.textContent).toMatch(/^2 project files downloaded\./);
    act(() => {
      button(el, 'Download SALT FLAT').click();
    });
    await settle(50);
    expect(names).toHaveLength(3);
    expect(names[2]).toBe('SALT_FLAT_Draft_3.profitshare.json');
    expect(el.querySelector('[role="status"]')!.textContent).toMatch(/^1 project file downloaded\./);
  });
  it('Go to the start screen: the app again with no project open, a line saying why, the project still under Projects', () => {
    const el = draw();
    act(() => {
      button(el, 'Go to the start screen').click();
    });
    const probe = el.querySelector('#probe') as HTMLElement;
    expect(probe).toBeTruthy();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(probe.dataset.open).toBe('none');
    expect(probe.textContent).toContain(
      'ProfitShare ran into a problem while “Nine Miles” was open, so it has not been opened again. It is still saved here, under Projects, unchanged.',
    );
    expect(JSON.parse(localStorage.getItem('profitshare.projects')!).map((m: { id: string }) => m.id)).toEqual([
      'trouble',
      'good',
    ]);
    // opening it by hand is still possible; if it fails again, the screen comes back (no loop, no lock-out)
    act(() => {
      button(el, 'open trouble').click();
    });
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    act(() => {
      button(el, 'Go to the start screen').click();
    });
    expect((el.querySelector('#probe') as HTMLElement).dataset.open).toBe('none');
  });
  it('Reload asks the browser to reload, and what comes up after a reload is a page that works', () => {
    const reload = vi.fn();
    const el = draw(reload);
    act(() => {
      button(el, 'Reload').click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    // the reload itself: the page is gone and drawn again from what the browser holds
    act(() => root!.unmount());
    box!.remove();
    resetCrashState();
    const again = draw();
    expect(again.querySelector('[role="alert"]')).toBeNull();
    expect((again.querySelector('#probe') as HTMLElement).dataset.open).toBe('none');
    expect(again.textContent).toContain('so it has not been opened again');
    // and a second reload, or a new tab later: the project that crashed is passed over, another one opens
    act(() => root!.unmount());
    box!.remove();
    resetCrashState();
    sessionStorage.clear();
    const later = draw();
    expect((later.querySelector('#probe') as HTMLElement).dataset.open).toBe('good');
    expect(later.querySelector('[role="alert"]')).toBeNull();
  });
  it('once the project draws again, it is no longer passed over', () => {
    const el = draw();
    act(() => {
      button(el, 'Go to the start screen').click();
    });
    armed.on = false; // the fault is gone (an update fixed it)
    act(() => {
      button(el, 'open trouble').click();
    });
    expect((el.querySelector('#probe') as HTMLElement).dataset.open).toBe('trouble');
    expect(crashedIds()).toEqual([]);
  });
  it('draws even when nothing the browser holds can be read', () => {
    localStorage.setItem('profitshare.projects', '{"not":"a list"');
    localStorage.setItem('profitshare.crashed', '{{');
    const Always = () => {
      throw 'a thrown string';
    };
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    act(() => {
      root!.render(
        <AppBoundary>
          <Always />
        </AppBoundary>,
      );
    });
    const alert = box.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('ProfitShare ran into a problem while drawing the page and had to stop.');
    // the list of projects is unreadable, so it is rebuilt from the projects themselves: both can still be downloaded
    expect(alert.textContent).toContain('SALT FLAT');
    expect(alert.textContent).toContain('Nine Miles');
    expect(button(box, 'Download every saved project').disabled).toBe(false);
    expect(box.querySelector('pre')!.textContent).toContain('a thrown string');
  });
});
