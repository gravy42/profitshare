// @vitest-environment jsdom
// The small pre-launch changes: which AI model is used when nobody chose one, the sentence beside the key, the
// notice once the SAG-AFTRA rates are past their date, and the links on the About tab. Lists of models are made up
// here and the one request the key field makes is stubbed: nothing leaves this file.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODEL,
  listModels,
  aiSettings,
  forgetAi,
  knownModels,
  modelFamily,
  newestSuitable,
  rememberModels,
  resolveModel,
  saveAiSettings,
  type AiModel,
} from '../ai';
import { SAG_RATES, SAG_TIERS, longDate, sagRatesNotice, sagRatesOutOfDate } from '../engine/sag';
import { sampleDemo } from '../data/seed';
import { applyDeal } from '../engine/deal';
import { AiKeyFields } from './AiKey';
import { SagView } from './SagView';
import { DealView } from './DealView';
import { CODE_URL, Feedback, ISSUES_URL, WhatItIs } from './AboutExtras';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root | null = null;
let box: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  box?.remove();
  root = null;
  box = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
const tick = (ms = 20) =>
  act(async () => {
    await new Promise(r => setTimeout(r, ms));
  });

// Invented ids in the shape the list uses: a family word and a date. Newest first, as the list arrives.
const LIST: AiModel[] = [
  { id: 'claude-opus-9-1', name: 'Opus 9.1', created: '2031-05-01T00:00:00Z' },
  { id: 'claude-sonnet-9', name: 'Sonnet 9', created: '2031-03-01T00:00:00Z' },
  { id: 'claude-haiku-9', name: 'Haiku 9', created: '2031-02-01T00:00:00Z' },
  { id: 'claude-sonnet-8-5', name: 'Sonnet 8.5', created: '2030-09-01T00:00:00Z' },
];

describe('the model used when the person has not chosen one', () => {
  it("is the fallback when the key's list is not known", () => {
    expect(newestSuitable([])).toBe(DEFAULT_MODEL);
    expect(aiSettings()).toEqual({ key: '', picked: '', model: DEFAULT_MODEL });
  });
  it("reads the family off the fallback's own id", () => {
    expect(modelFamily(DEFAULT_MODEL)).toBe('sonnet');
  });
  it("is the newest of the fallback's family, not the newest of all", () => {
    expect(newestSuitable(LIST)).toBe('claude-sonnet-9');
  });
  it('goes by the created date, whatever order the list is in', () => {
    expect(newestSuitable([...LIST].reverse())).toBe('claude-sonnet-9');
  });
  it("goes by the list's own order when a date is missing", () => {
    expect(newestSuitable(LIST.map(({ created: _c, ...m }) => m))).toBe('claude-sonnet-9');
    expect(
      newestSuitable([
        { id: 'claude-sonnet-8-5', name: 'a' },
        { id: 'claude-sonnet-9', name: 'b', created: '2031-03-01T00:00:00Z' },
      ]),
    ).toBe('claude-sonnet-8-5');
  });
  it('takes the newest of everything when the list has none of that family', () => {
    expect(newestSuitable(LIST.filter(m => !m.id.includes('sonnet')))).toBe('claude-opus-9-1');
  });
  it("follows the list once it is known, and a new key forgets the old key's list", () => {
    saveAiSettings({ key: 'sk-ant-one', picked: '' });
    rememberModels(LIST);
    expect(aiSettings().model).toBe('claude-sonnet-9');
    saveAiSettings({ key: 'sk-ant-two', picked: '' });
    expect(knownModels()).toEqual([]);
    expect(aiSettings().model).toBe(DEFAULT_MODEL);
  });
});

describe('a model the person chose', () => {
  it('is never swapped for a newer one', () => {
    expect(resolveModel('claude-sonnet-8-5', LIST)).toEqual({ model: 'claude-sonnet-8-5', note: '' });
    saveAiSettings({ key: 'sk-ant-one', picked: 'claude-haiku-9' });
    rememberModels(LIST);
    expect(aiSettings()).toMatchObject({ picked: 'claude-haiku-9', model: 'claude-haiku-9' });
  });
  it('is used as typed when there is no list to check it against', () => {
    expect(resolveModel('my-own-model', [])).toEqual({ model: 'my-own-model', note: '' });
  });
  it('that has left the list is said so, and the newest suitable one is used', () => {
    const r = resolveModel('claude-sonnet-7', LIST);
    expect(r.model).toBe('claude-sonnet-9');
    expect(r.note).toBe(
      "The model you chose, claude-sonnet-7, is no longer on this key's list, so Sonnet 9 is used instead. Choose another from the list if you prefer.",
    );
  });
  it('from before this change: the old default is not a choice, anything else is', () => {
    localStorage.setItem('profitshare.ai.model', 'claude-sonnet-4-5');
    rememberModels(LIST);
    expect(aiSettings()).toMatchObject({ picked: '', model: 'claude-sonnet-9' });
    localStorage.setItem('profitshare.ai.model', 'claude-haiku-9');
    expect(aiSettings()).toMatchObject({ picked: 'claude-haiku-9', model: 'claude-haiku-9' });
  });
  it('choosing the old default by hand now counts', () => {
    saveAiSettings({ key: 'k', picked: 'claude-sonnet-4-5' });
    rememberModels([...LIST, { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', created: '2025-09-29T00:00:00Z' }]);
    expect(aiSettings().model).toBe('claude-sonnet-4-5');
  });
  it('Forget clears the key, the choice and the list', () => {
    saveAiSettings({ key: 'k', picked: 'claude-haiku-9' });
    rememberModels(LIST);
    forgetAi();
    expect(aiSettings()).toEqual({ key: '', picked: '', model: DEFAULT_MODEL });
    expect(knownModels()).toEqual([]);
  });
});

function KeyHarness() {
  const [s, setS] = useState(aiSettings());
  return (
    <>
      <AiKeyFields settings={s} onChange={setS} />
      <output>{s.model}</output>
    </>
  );
}
function draw(node: React.ReactNode): HTMLElement {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => {
    root!.render(node);
  });
  return box;
}

describe('the key and model fields', () => {
  it('say where the key is kept and where it goes', () => {
    expect(draw(<KeyHarness />).textContent).toContain(
      'Your key is kept in this browser, not encrypted, and is sent only to Anthropic when you press an AI button. Use a key with a spending limit.',
    );
  });
  it('a list entry with no id is left out, and an answer that is not a list gives a plain sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: [{ display_name: 'no id' }, { id: 'claude-sonnet-9' }, null, { id: 7 }] }),
            { status: 200 },
          ),
      ),
    );
    expect((await listModels('k')).map(m => m.id)).toEqual(['claude-sonnet-9']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { not: 'a list' } }), { status: 200 })),
    );
    await expect(listModels('k')).rejects.toThrow(
      'Anthropic answered, but not with a list of models. Type a model id instead.',
    );
  });
  it('Test the key brings the list back, and the newest suitable model is used without anyone choosing', async () => {
    saveAiSettings({ key: 'sk-ant-test-key', picked: '' });
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: LIST.map(m => ({ id: m.id, display_name: m.name, created_at: m.created })) }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchStub);
    const el = draw(<KeyHarness />);
    expect(el.querySelector('output')!.textContent).toBe(DEFAULT_MODEL);
    act(() => {
      [...el.querySelectorAll('button')].find(b => b.textContent === 'Test the key')!.click();
    });
    await tick();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(el.querySelector('output')!.textContent).toBe('claude-sonnet-9');
    const select = el.querySelector('select')!;
    expect(select.value).toBe('');
    expect(select.options[0].textContent).toBe('Newest for this key: Sonnet 9');
    expect(localStorage.getItem('profitshare.ai.model.picked')).toBe(''); // nothing was written down as the person's choice
  });
  it('a stored choice that is no longer in the list is said beside the picker', async () => {
    saveAiSettings({ key: 'sk-ant-test-key', picked: 'claude-sonnet-7' });
    rememberModels(LIST);
    const el = draw(<KeyHarness />);
    expect(el.querySelector('[role="status"]')!.textContent).toContain(
      "The model you chose, claude-sonnet-7, is no longer on this key's list, so Sonnet 9 is used instead.",
    );
    expect(el.querySelector('output')!.textContent).toBe('claude-sonnet-9');
  });
  it('a choice from the list is kept and shown', () => {
    saveAiSettings({ key: 'sk-ant-test-key', picked: '' });
    rememberModels(LIST);
    const el = draw(<KeyHarness />);
    const select = el.querySelector('select')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'claude-haiku-9');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(el.querySelector('output')!.textContent).toBe('claude-haiku-9');
    expect(el.querySelector('[role="status"]')).toBeNull();
  });
});

describe('SAG-AFTRA rates going out of date', () => {
  const before = new Date(2027, 5, 30, 23, 59),
    onTheDay = new Date(2027, 6, 1, 0, 0),
    later = new Date(2028, 0, 15);
  const TEXT =
    'These SAG-AFTRA rates took effect 1 July 2026 and were due to rise on 1 July 2027. Check the current rates before you rely on these.';
  it('every tier carries the one date', () => {
    expect(SAG_TIERS.every(t => t.effective === SAG_RATES.asOf)).toBe(true);
    expect(longDate(SAG_RATES.asOf)).toBe('1 July 2026');
  });
  it('says nothing before the next known change', () => {
    expect(sagRatesOutOfDate(before)).toBe(false);
    expect(sagRatesNotice(before)).toBeNull();
    expect(sagRatesNotice(new Date(2026, 10, 18))).toBeNull();
  });
  it('speaks on the day and after it', () => {
    expect(sagRatesNotice(onTheDay)).toBe(TEXT);
    expect(sagRatesNotice(later)).toBe(TEXT);
  });
  it('the SAG tier tab and the Deal tab show it only once the day has come', () => {
    const raw = sampleDemo(),
      eff = applyDeal(raw);
    expect(renderToStaticMarkup(<SagView project={eff} today={before} />)).not.toContain('were due to rise');
    expect(renderToStaticMarkup(<SagView project={eff} today={onTheDay} />)).toContain(TEXT);
    expect(renderToStaticMarkup(<DealView raw={raw} eff={eff} setProject={() => {}} today={before} />)).not.toContain(
      'were due to rise',
    );
    // twice on the Deal tab: under the table of tiers and under the target tier menu, the two places a tier is chosen
    expect(
      renderToStaticMarkup(<DealView raw={raw} eff={eff} setProject={() => {}} today={onTheDay} />).split(TEXT).length -
        1,
    ).toBe(2);
  });
});

describe('the About tab additions', () => {
  it('the two links open in a new tab and say what a report should use', () => {
    box = document.createElement('div');
    box.innerHTML = renderToStaticMarkup(<Feedback />);
    document.body.appendChild(box);
    const links = [...box.querySelectorAll('a')];
    expect(links.map(a => [a.textContent, a.getAttribute('href'), a.target, a.rel])).toEqual([
      ['Report a problem or suggest something', ISSUES_URL, '_blank', 'noreferrer'],
      ['Read the code', CODE_URL, '_blank', 'noreferrer'],
    ]);
    expect(ISSUES_URL).toBe('https://github.com/gravy42/profitshare/issues/new/choose');
    expect(CODE_URL).toBe('https://github.com/gravy42/profitshare');
    expect(box.textContent).toContain('the sample film, not a real budget');
  });
  it('what it is and what it is not carries the five points, with no long dashes', () => {
    const text = renderToStaticMarkup(<WhatItIs />);
    for (const s of [
      'US dollars, California rules',
      'SAG-AFTRA low-budget theatrical tiers',
      'Built for a laptop',
      'Not legal, tax or financial advice',
      'figures are illustrative',
      'securities rules',
      'attorney',
    ])
      expect(text).toContain(s);
    expect(text + renderToStaticMarkup(<Feedback />)).not.toMatch(/[—–]/);
  });
});
