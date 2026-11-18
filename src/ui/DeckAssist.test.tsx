// @vitest-environment jsdom
// Movement and AI assist in the deck builder, with the model's answers stubbed: no request leaves this file. What is
// checked is what a person sees (what is sent is said first, the proposal is in words, nothing changes before Apply)
// and what the request body holds.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleDemo } from '../data/seed';
import { applyDeal } from '../engine/deal';
import { MOTION_SENDS, motionSends } from '../engine/aiMotion';
import { CRITIQUE_SENDS, personSends, PUNCH_SENDS } from '../engine/aiDeck';
import type { Project } from '../engine/types';
import PitchDeck from './PitchDeck';
import { LESS_MOTION } from './DeckAssist';

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Element.prototype.scrollIntoView = () => undefined; });
let root: Root | null = null; let box: HTMLElement | null = null; let project: Project;
beforeEach(() => { localStorage.setItem('profitshare.ai.key', 'sk-ant-test-key'); });
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

function Harness({ ai }: { ai: boolean }) {
  const [p, setP] = useState<Project>(() => applyDeal(sampleDemo()));
  project = p;
  return <PitchDeck project={p} ai={ai} setPitch={f => setP(x => ({ ...x, pitch: f(x.pitch!) }))} onUndo={() => undefined} />;
}
function draw(ai = true): HTMLElement {
  box = document.createElement('div'); document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(<Harness ai={ai} />); });
  return box;
}
const tick = (ms = 20) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const button = (el: ParentNode, text: string | RegExp) => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => (typeof text === 'string' ? b.textContent!.trim() === text : text.test(b.textContent!)))!;
const click = (b: Element) => act(() => { (b as HTMLElement).click(); });
function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
const pick = (el: HTMLElement, id: string) => click([...el.querySelectorAll<HTMLElement>('.pd-row')].find(r => r.dataset.slide === id)!.querySelector('.pd-pick')!);
const slide = (id: string) => project.pitch!.slides!.find(s => s.id === id)!;
const labelled = <T extends HTMLElement>(el: ParentNode, text: string | RegExp): T => { const l = [...el.querySelectorAll('label')].find(x => (typeof text === 'string' ? x.textContent!.trim() === text : text.test(x.textContent!)))!; return document.getElementById(l.htmlFor) as T; };

/** Answers every request to the model with one tool call, and keeps what was sent. */
function model(answer: unknown, opts: { status?: number; fail?: boolean; hang?: boolean; notJson?: boolean } = {}) {
  const sent: { url: string; body: any; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ url, body, headers: init.headers as Record<string, string> });
    if (opts.fail) throw new TypeError('Failed to fetch');
    if (opts.hang) return new Promise<Response>((_ok, no) => { init.signal!.addEventListener('abort', () => no(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))); });
    if (opts.notJson) return new Response('<html>502 Bad Gateway</html>', { status: 200 });
    if (opts.status) return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: opts.status });
    return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: body.tools[0].name, input: answer }] }), { status: 200 });
  }));
  return sent;
}

describe('a slide\'s movement', () => {
  it('is behind Add movement on a slide with none, and open on a slide that has some', () => {
    const el = draw();
    pick(el, 'why');
    expect(el.querySelector('.pd-move')).toBeNull();
    click(button(el, 'Add movement'));
    const move = el.querySelector('.pd-move')!;
    expect(move.textContent).toContain(LESS_MOTION);
    expect(LESS_MOTION).toBe('People who have asked their computer for less motion, and PDFs, see everything at once.');
    for (const label of ['How it arrives', 'One at a time or together']) expect(labelled(move, label)).toBeTruthy();
    expect(move.textContent).toContain('Type out the headline');
    expect(move.textContent).not.toContain('Count up the numbers');           // a slide of words has no numbers to count
    expect(move.textContent).not.toContain('A picture that travels');         // and no timeline to travel along
    pick(el, 'gap');
    expect(el.querySelector('.pd-move')).not.toBeNull();
    expect(el.querySelector('.pd-move')!.textContent).not.toContain('A picture that travels');   // nothing travels along cards
    expect(el.querySelector('.pd-move .pd-marker')).toBeNull();
    expect(labelled<HTMLInputElement>(el.querySelector('.pd-move')!, /^Gap between one part and the next: 140 ms$/).value).toBe('140');
  });
  it('each choice is one change to the slide, in the vocabulary, and nothing else on the slide moves', () => {
    const el = draw();
    pick(el, 'why'); click(button(el, 'Add movement'));
    const before = { ...slide('why') };
    type(labelled<HTMLSelectElement>(el.querySelector('.pd-move')!, 'How it arrives'), 'fade');
    expect(slide('why')).toEqual({ ...before, motion: { entrance: 'fade' } });
    type(labelled<HTMLSelectElement>(el.querySelector('.pd-move')!, 'One at a time or together'), 'reverse');
    click([...el.querySelectorAll<HTMLInputElement>('.pd-checks input')][0]);
    expect(slide('why').motion).toEqual({ entrance: 'fade', order: 'reverse', headline: 'type' });
    type(labelled<HTMLSelectElement>(el.querySelector('.pd-move')!, 'How it arrives'), '');
    type(labelled<HTMLSelectElement>(el.querySelector('.pd-move')!, 'One at a time or together'), '');
    click([...el.querySelectorAll<HTMLInputElement>('.pd-checks input')][0]);
    expect('motion' in slide('why')).toBe(false);   // back to nothing: the key is gone from the file
  });
  it('a picture that travels is chosen from the look book, by id, with where it ends and its size', () => {
    const el = draw();
    pick(el, 'ways');
    expect(el.querySelector('.pd-marker')).toBeNull();   // only the plan has a timeline for a picture to travel along
    pick(el, 'plan'); click(button(el, 'Add movement'));
    expect(el.querySelector('.pd-marker')!.textContent).toContain('A picture that travels along the timeline');
    expect(el.querySelector('.pd-marker')!.textContent).not.toMatch(/the line\b|last card/);
    const thumbs = [...el.querySelectorAll<HTMLButtonElement>('.pd-marker .thumb')];
    expect(thumbs).toHaveLength(12);   // No picture, and the eleven in the look book
    expect(thumbs[0].getAttribute('aria-pressed')).toBe('true');
    click(thumbs[11]);
    expect(slide('plan').motion).toEqual({ marker: { imageId: 'look_mark', path: 'timeline', end: 'stop' } });
    type(labelled<HTMLSelectElement>(el.querySelector('.pd-marker')!, 'Where it ends'), 'settle');
    expect(slide('plan').motion!.marker).toEqual({ imageId: 'look_mark', path: 'timeline', end: 'settle' });
    click(el.querySelectorAll<HTMLButtonElement>('.pd-marker .thumb')[0]);
    expect('motion' in slide('plan')).toBe(false);
  });
  it('the whole deck: calm, brisk or none, and Play says what it did', async () => {
    const el = draw(); await tick(40);
    const pace = labelled<HTMLSelectElement>(el, 'Movement for the whole deck');
    expect(pace.value).toBe('calm');
    type(pace, 'brisk');
    expect(project.pitch!.deckMotion).toEqual({ pace: 'brisk', entrance: 'rise' });
    type(pace, 'none');
    expect(project.pitch!.deckMotion).toEqual({ pace: 'calm', entrance: 'none' });
    type(pace, 'calm');
    expect('deckMotion' in project.pitch!).toBe(false);
    await tick(300);
    click(button(el, /^Play/));
    const said = el.querySelector('.pd-played')!;
    expect(said.getAttribute('aria-live')).toBe('polite');
    expect(said.textContent).toMatch(/^Playing the movement on slide \d+\.$/);
  });
});

describe('movement on request', () => {
  it('is not offered without a key: one line points to AI assist', () => {
    const el = draw(false);
    pick(el, 'gap');
    expect(el.querySelector('.pd-request')).toBeNull();
    expect(el.querySelector('.pd-move .pd-nokey')!.textContent).toBe('With your own Anthropic key you can also describe the movement you want in words: turn it on under AI assist.');
  });
  it('says what is sent before anything is sent, shows the answer in words, and changes nothing until Apply', async () => {
    const sent = model({ entrance: 'drop', order: 'one-by-one', stagger: 120, note: 'I can\'t make it bounce; the closest is drop.' });
    const el = draw();
    pick(el, 'ways');
    const req = el.querySelector('.pd-request')!;
    expect(req.querySelector('.pd-sends')!.textContent).toBe(motionSends('ways'));
    expect(motionSends('ways')).not.toContain('look book');   // cards have nothing a picture travels along, so no captions go
    expect(MOTION_SENDS).toContain('the captions and ids of your look book pictures');
    const field = labelled<HTMLTextAreaElement>(req, 'Describe the movement you want');
    expect(field.getAttribute('aria-describedby')).toBe(req.querySelector('.pd-sends')!.id);
    expect(button(req, 'Suggest movement').disabled).toBe(true);
    expect(sent).toHaveLength(0);
    type(field, 'have the cards bounce in one at a time');
    click(button(req, 'Suggest movement'));
    await tick();
    expect(sent).toHaveLength(1);
    const proposal = el.querySelector('.pd-proposal')!;
    expect([...proposal.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Cards: drop in, one at a time, 120 ms apart.']);
    expect(proposal.querySelector('.pd-note')!.textContent).toBe('Note from the model: I can\'t make it bounce; the closest is drop.');
    expect(el.querySelector('.pd-request [role="status"]')!.textContent).toBe('A suggestion is ready. Nothing changes until you press Apply.');
    expect(slide('ways').motion).toEqual({ order: 'one-by-one', stagger: 160 });   // untouched
    click(button(proposal, 'Apply'));
    expect(slide('ways').motion).toEqual({ entrance: 'drop', order: 'one-by-one', stagger: 120 });
    expect(el.querySelector('.pd-proposal')).toBeNull();
    expect(el.querySelector('.pd-status')!.textContent).toContain('Movement applied to this slide.');
    await tick();
    expect(document.activeElement).toBe(labelled(el.querySelector('.pd-request')!, 'Describe the movement you want'));   // focus is where the person was
  });
  it('sends only the request, the layout\'s name, the vocabulary and the pictures\' ids and captions', async () => {
    const sent = model({ entrance: 'fade' });
    const el = draw();
    pick(el, 'plan'); click(button(el, 'Add movement'));
    expect(el.querySelector('.pd-request .pd-sends')!.textContent).toBe(MOTION_SENDS);
    type(labelled<HTMLTextAreaElement>(el.querySelector('.pd-request')!, 'Describe the movement you want'), 'walk my mark along the timeline');
    click(button(el.querySelector('.pd-request')!, 'Suggest movement'));
    await tick();
    const { url, body, headers } = sent[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('sk-ant-test-key');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'set_movement' });
    expect(body.messages).toHaveLength(1);
    expect(typeof body.messages[0].content).toBe('string');
    expect(body.messages[0].content.startsWith('REQUEST: walk my mark along the timeline\n\nSLIDE LAYOUT: plan (')).toBe(true);
    expect(body.messages[0].content).toContain('look_mark: The film\'s mark: a low sun on the horizon (drawn for the sample)');
    const all = JSON.stringify(body);
    for (const secret of ['data:image', 'base64', 'Audiences are asking', 'Twelve days, one unit', 'Financing closes', 'Sisters, not sidekicks', 'Ada Example', 'Placeholder', 'Wren', 'wren@example.com', '805', '811', '721', 'Dana Okafor', 'Script purchase', 'sk-ant']) expect(all, secret).not.toContain(secret);
  });
  it('Cancel leaves the slide as it was and puts focus back', async () => {
    model({ entrance: 'none', headline: 'type' });
    const el = draw();
    pick(el, 'gap');
    const before = slide('gap').motion;
    type(labelled<HTMLTextAreaElement>(el.querySelector('.pd-request')!, 'Describe the movement you want'), 'type the headline');
    click(button(el.querySelector('.pd-request')!, 'Suggest movement'));
    await tick();
    expect([...el.querySelectorAll('.pd-proposal li')].map(li => li.textContent)).toEqual(['Cards: are simply there.', 'The headline is typed out.']);
    click(button(el.querySelector('.pd-proposal')!, 'Cancel'));
    expect(slide('gap').motion).toBe(before);
    expect(el.querySelector('.pd-proposal')).toBeNull();
    await tick();
    expect(document.activeElement!.tagName).toBe('TEXTAREA');
  });
  it('a hostile answer is shown as the little of it that is in the vocabulary, its note as plain text', async () => {
    model({ entrance: '"><img src=x onerror=alert(1)>', stagger: 99999, style: 'position:fixed', marker: { imageId: 'not-a-picture', end: 'settle' }, note: '<b>bold</b> <script>alert(1)</script>' });
    const el = draw();
    pick(el, 'gap');
    type(labelled<HTMLTextAreaElement>(el.querySelector('.pd-request')!, 'Describe the movement you want'), 'anything');
    click(button(el.querySelector('.pd-request')!, 'Suggest movement'));
    await tick();
    const proposal = el.querySelector('.pd-proposal')!;
    expect(proposal.querySelectorAll('img, script, b:not(.pd-note > b)').length).toBe(0);
    expect(proposal.querySelector('.pd-note')!.textContent).toBe('Note from the model: <b>bold</b> <script>alert(1)</script>');
    click(button(proposal, 'Apply'));
    expect(slide('gap').motion).toEqual({ stagger: 400 });
  });
  it('a key that is refused, and a network that is down, are said in plain words; nothing changes', async () => {
    model(null, { status: 401 });
    const el = draw();
    pick(el, 'gap');
    const before = slide('gap').motion;
    const go = async () => { type(labelled<HTMLTextAreaElement>(el.querySelector('.pd-request')!, 'Describe the movement you want'), 'drop them'); click(button(el.querySelector('.pd-request')!, 'Suggest movement')); await tick(); };
    await go();
    const said = el.querySelector('.pd-request [role="status"]')!;
    expect(said.textContent).toBe('✕ Anthropic did not accept the key. Check it under AI assist, at the top of this page.');
    expect(el.querySelector('.pd-proposal')).toBeNull();
    model(null, { fail: true });
    await go();
    expect(el.querySelector('.pd-request [role="status"]')!.textContent).toBe('✕ The request could not reach Anthropic. Check your connection and try again. Nothing was changed.');
    expect(slide('gap').motion).toBe(before);
  });
});

describe('a second line', () => {
  it('sends the slide\'s own headline and text, offers three lines, and uses the one that is chosen', async () => {
    const sent = model({ options: ['So we wrote it.', 'Until now.', 'That is the opening.'] });
    const el = draw();
    pick(el, 'team');
    const assist = el.querySelector('.pd-editor .pd-assist')!;
    expect(assist.querySelector('.pd-sends')!.textContent).toBe(PUNCH_SENDS);
    click(button(assist, 'Suggest a second line'));
    await tick();
    expect(sent[0].body.messages[0].content).toBe('HEADLINE: People who make small films work.\n\nTHE SLIDE\'S TEXT:\n(none)');
    expect([...el.querySelectorAll('.pd-options li span')].map(x => x.textContent)).toEqual(['So we wrote it.', 'Until now.', 'That is the opening.']);
    expect(slide('team').punch).toBeUndefined();
    click(el.querySelectorAll<HTMLButtonElement>('.pd-options button')[1]);
    expect(slide('team').punch).toBe('Until now.');
    expect(el.querySelector('.pd-options')).toBeNull();
    await tick();
    expect(document.activeElement).toBe(button(el.querySelector('.pd-editor .pd-assist')!, 'Suggest a second line'));
  });
  it('is not there without a key', () => {
    const el = draw(false);
    pick(el, 'team');
    expect(button(el, 'Suggest a second line')).toBeUndefined();
  });
});

describe('for a person', () => {
  it('sends what is pasted, the title, the logline and the two asks; never the budget lines or anyone else; the proposal can be edited, then applied', async () => {
    const sent = model({ cover_line: 'Prepared for Ada Example.', note: 'You said you look for small crews. This one is twelve days.', lead: 'with-grants' });
    const el = draw();
    const ada = [...el.querySelectorAll<HTMLElement>('.pd-person')][0];
    click(button(ada, 'Suggest a cover line and note for Ada Example'));
    expect(ada.querySelector('.pd-sends')!.textContent).toBe(personSends(true));
    type(labelled<HTMLTextAreaElement>(ada, /^A few lines about Ada Example/), 'Backs first features. Has said she looks for small crews.');
    click(button(ada, 'Suggest'));
    await tick();
    const text = sent[0].body.messages[0].content as string;
    expect(text).toContain('ABOUT THE PERSON (pasted by the filmmaker):\nBacks first features. Has said she looks for small crews.');
    expect(text).toContain('THE FILM: SALT FLAT');
    expect(text).toContain(`LOGLINE: ${project.pitch!.logline}`);
    expect(text).toMatch(/THE ASK, WITH GRANTS COUNTED: We are raising \$[\d,]+ from investors\. Grants and fiscal sponsorship cover another \$83,700/);
    expect(text).toMatch(/THE ASK, WITHOUT GRANTS: We are raising \$[\d,]+ from investors\./);
    const all = JSON.stringify(sent[0].body);
    for (const secret of ['Placeholder', 'placeholder-fund', 'The Give card', 'you asked what the raise is', 'Script purchase', 'Dana Okafor', 'data:image', 'Wren', 'Invented Audience Survey']) expect(all, secret).not.toContain(secret);
    const proposal = ada.querySelector('.pd-proposal')!;
    const before = project.pitch!.recipients![0];
    expect(before.lead).toBe('without-grants');
    type(labelled<HTMLTextAreaElement>(proposal, /^Note to them/), 'Twelve days, thirty-six people, one motel.');
    click(button(proposal, 'Apply'));
    expect(project.pitch!.recipients![0]).toEqual({ ...before, coverLine: 'Prepared for Ada Example.', note: 'Twelve days, thirty-six people, one motel.', lead: 'with-grants' });
    expect(project.pitch!.recipients![1]).toBe(project.pitch!.recipients![1]);
    expect(JSON.stringify(project)).not.toContain('Backs first features');   // what was pasted is nowhere in the project
  });
  it('a note that promises returns cannot be applied until it is reworded', async () => {
    model({ cover_line: 'For Ada.', note: 'You will double your money.', lead: 'with-grants' });
    const el = draw();
    const ada = [...el.querySelectorAll<HTMLElement>('.pd-person')][0];
    click(button(ada, 'Suggest a cover line and note for Ada Example'));
    type(labelled<HTMLTextAreaElement>(ada, /^A few lines about Ada Example/), 'x');
    click(button(ada, 'Suggest')); await tick();
    expect(ada.querySelector('.pd-proposal .pd-bad')!.textContent).toContain('promise of returns');
    expect(button(ada.querySelector('.pd-proposal')!, 'Apply').disabled).toBe(true);
    type(labelled<HTMLTextAreaElement>(ada.querySelector('.pd-proposal')!, /^Note to them/), 'The model slide shows three cases.');
    expect(button(ada.querySelector('.pd-proposal')!, 'Apply').disabled).toBe(false);
  });
});

describe('Read my deck', () => {
  it('lists what the checks that need no AI find, with no key and no request', () => {
    const sent = model({ problems: [] });
    const el = draw(false);
    click(button(el, 'Read my deck'));
    const read = el.querySelector('.pd-read')!;
    expect(read.textContent).toContain('Found without AI');
    expect(read.textContent).toContain('Nothing: every number has a source');
    expect(read.querySelector('.pd-nokey')).not.toBeNull();
    expect(sent).toHaveLength(0);
  });
  it('finds a promise of returns and an ask with no way to answer it, each linked to its slide and field', async () => {
    const el = draw(false);
    pick(el, 'why');
    type(labelled<HTMLInputElement>(el.querySelector('.pd-editor')!, 'Headline'), 'A guaranteed return.');
    pick(el, 'ask');
    type(labelled<HTMLInputElement>(el.querySelector('.pd-editor')!, 'How to reach you'), '');
    click(button(el, 'Read my deck'));
    const items = [...el.querySelectorAll('.pd-read .pd-fixes li')].map(li => li.textContent);
    expect(items).toEqual(['Slide 2, Words, A guaranteed return.: This reads like a promise of returns. A deck must not promise returns: change the wording. ("guaranteed")', 'Slide 13, The ask: The ask does not say how to reach you.']);
    click(el.querySelector('.pd-read .pd-fixes li .pd-link')!);
    await tick(120);
    expect(el.querySelector('.pd-row.on')!.getAttribute('data-slide')).toBe('why');
    expect((document.activeElement as HTMLInputElement).value).toBe('A guaranteed return.');
  });
  it('with a key, says what is sent, then adds the model\'s items: on slides the deck has, eight at most, as text', async () => {
    const sent = model({ problems: [
      { slide_id: 'gap', field: 'cards', kind: 'vague', problem: 'The second card does not say which ten years.' },
      { slide_id: 'not-a-slide', kind: 'vague', problem: 'Dropped.' },
      { slide_id: 'ask', field: 'ask', kind: 'unclear-ask', problem: '<i>What</i> does an investor get?' },
    ] });
    const el = draw();
    click(button(el, 'Read my deck'));
    const read = el.querySelector('.pd-read')!;
    expect([...read.querySelectorAll('.pd-sends')].map(x => x.textContent)).toEqual([CRITIQUE_SENDS]);
    expect(sent).toHaveLength(0);
    click(button(read, 'Ask the AI to read it too'));
    await tick();
    const body = JSON.stringify(sent[0].body);
    expect(body).toContain('id=gap | layout=cards');
    for (const secret of ['Ada Example', 'Placeholder', 'data:image', 'look_dawn', 'Script purchase', '83,700', 'you asked what the raise is']) expect(body, secret).not.toContain(secret);
    const items = [...read.querySelectorAll('.pd-fixes li')].map(li => li.textContent);
    expect(items).toEqual(['Slide 3, Cards, Audiences are asking for this film.: Vague. The second card does not say which ten years.', 'Slide 13, The ask: Unclear ask. <i>What</i> does an investor get?']);
    expect(read.querySelectorAll('.pd-fixes i')).toHaveLength(0);
    expect(read.textContent).toContain('Nothing on your deck was changed.');
  });
});

// ---------- after review ----------

const NOT_READ = '✕ The answer did not come back in a form this page can read. Nothing was changed. Try again.';
/** Each of the four features, set up to the point of sending: how to send, and where its status and its proposal are. */
const FEATURES: { name: string; open: (el: HTMLElement) => void; send: (el: HTMLElement) => void; status: (el: HTMLElement) => string; proposal: (el: HTMLElement) => Element | null }[] = [
  { name: 'movement on request', open: el => { pick(el, 'ways'); type(labelled<HTMLTextAreaElement>(el.querySelector('.pd-request')!, 'Describe the movement you want'), 'drop them'); },
    send: el => click(button(el.querySelector('.pd-move')!, 'Suggest movement')), status: el => el.querySelector('.pd-move .pd-request [role="status"]')!.textContent!, proposal: el => el.querySelector('.pd-move .pd-proposal') },
  { name: 'a second line', open: el => pick(el, 'team'), send: el => click(button(el.querySelector('.pd-editor .pd-assist')!, 'Suggest a second line')),
    status: el => el.querySelector('.pd-editor .pd-assist [role="status"]')!.textContent!, proposal: el => el.querySelector('.pd-editor .pd-assist .pd-proposal') },
  { name: 'for a person', open: el => { const ada = el.querySelector<HTMLElement>('.pd-person')!; click(button(ada, 'Suggest a cover line and note for Ada Example')); type(labelled<HTMLTextAreaElement>(ada, /^A few lines about Ada Example/), 'x'); },
    send: el => click(button(el.querySelector('.pd-person')!, 'Suggest')), status: el => el.querySelector('.pd-person [role="status"].pd-said')!.textContent!, proposal: el => el.querySelector('.pd-person .pd-proposal') },
  { name: 'Read my deck', open: el => click(button(el, 'Read my deck')), send: el => click(button(el.querySelector('.pd-read')!, 'Ask the AI to read it too')),
    status: el => [...el.querySelectorAll('.pd-read [role="status"]')].pop()!.textContent!, proposal: el => el.querySelector('.pd-read .pd-sends ~ .pd-fixes') },
];

describe('an answer that is not in the form asked for is an error, for every feature', () => {
  for (const f of FEATURES) {
    it(`${f.name}: null, a string, an array, a number and a reply that is not JSON are all said plainly, and nothing is offered`, async () => {
      const el = draw();
      f.open(el);
      const before = JSON.stringify(project.pitch);
      for (const answer of [null, 'drop', ['drop'], 7]) {
        model(answer);
        f.send(el); await tick();
        expect(f.status(el), JSON.stringify(answer)).toBe(NOT_READ);
        expect(f.proposal(el)).toBeNull();
      }
      model(null, { notJson: true });
      f.send(el); await tick();
      expect(f.status(el)).toBe(NOT_READ);
      expect(f.status(el)).not.toMatch(/JSON|token|Unexpected/);
      expect(el.textContent).not.toContain('found nothing to report');
      expect(JSON.stringify(project.pitch)).toBe(before);
    });
  }
  it('movement: an answer with no setting the deck has is "could not be met", with the model\'s note, and cannot be applied', async () => {
    model({ entrance: 'bounce', spin: true, note: 'The deck cannot bounce or spin.' });
    const el = draw();
    FEATURES[0].open(el);
    const before = slide('ways').motion;
    FEATURES[0].send(el); await tick();
    const proposal = el.querySelector('.pd-move .pd-proposal')!;
    expect(proposal.querySelector('.pd-sub')!.textContent).toBe('The request could not be met with the movements available.');
    expect(proposal.querySelector('.pd-note')!.textContent).toBe('Note from the model: The deck cannot bounce or spin.');
    expect(FEATURES[0].status(el)).toBe('The request could not be met with the movements available. Nothing was changed.');
    const apply = button(proposal, 'Apply');
    expect(apply.disabled).toBe(true);
    expect(document.getElementById(apply.getAttribute('aria-describedby')!)!.textContent).toContain('there is nothing to apply');
    click(apply);
    expect(slide('ways').motion).toBe(before);   // the movement the slide had is still there
    click(button(proposal, 'Cancel'));
    expect(slide('ways').motion).toBe(before);
    model({});   // nothing at all, and no note
    FEATURES[0].send(el); await tick();
    expect(button(el.querySelector('.pd-move .pd-proposal')!, 'Apply').disabled).toBe(true);
    expect(el.querySelector('.pd-move .pd-proposal .pd-note')).toBeNull();
  });
  it('Read my deck: only a valid empty list says nothing was found', async () => {
    const el = draw();
    FEATURES[3].open(el);
    model({ problems: [] });
    FEATURES[3].send(el); await tick();
    expect(FEATURES[3].status(el)).toBe('The AI read found nothing to report.');
    for (const answer of [{}, { problems: null }, { problems: 'none' }]) {
      model(answer);
      FEATURES[3].send(el); await tick();
      expect(FEATURES[3].status(el), JSON.stringify(answer)).toBe(NOT_READ);
    }
  });
});

describe('Stop, and no answer in sixty seconds', () => {
  for (const f of FEATURES) {
    it(`${f.name}: Stop ends the request at once; a request with no answer is ended after 60 seconds and says so`, async () => {
      const sent = model(null, { hang: true });
      const el = draw();
      f.open(el);
      const before = JSON.stringify(project.pitch);
      expect(button(el, 'Stop')).toBeUndefined();
      f.send(el); await tick();
      expect(f.status(el)).toMatch(/Stop ends it\.$/);
      const signal = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).signal!;
      expect(signal.aborted).toBe(false);
      click(button(el, 'Stop')); await tick();
      expect(signal.aborted).toBe(true);
      expect(f.status(el)).toBe('Stopped. Nothing was sent back and nothing was changed.');
      expect(button(el, 'Stop')).toBeUndefined();
      // again, and this time nobody presses anything
      vi.useFakeTimers();
      f.send(el);
      await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
      expect(f.status(el)).toMatch(/Stop ends it\.$/);
      await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
      vi.useRealTimers();
      expect(f.status(el)).toBe('✕ No answer came back in 60 seconds, so the request was stopped. Nothing was changed. Try again in a moment.');
      expect((vi.mocked(fetch).mock.calls[1][1] as RequestInit).signal!.aborted).toBe(true);
      expect(sent).toHaveLength(2);
      expect(f.proposal(el)).toBeNull();
      expect(JSON.stringify(project.pitch)).toBe(before);
    });
  }
});

describe('the net for a promise of returns, on the page', () => {
  it('a person suggestion: Apply is off, says why to a screen reader, and comes back on when the words are changed', async () => {
    model({ cover_line: 'For Ada.', note: 'Your capital is safe with us.', lead: 'with-grants' });
    const el = draw();
    FEATURES[2].open(el); FEATURES[2].send(el); await tick();
    const ada = el.querySelector<HTMLElement>('.pd-person')!;
    const apply = () => button(ada.querySelector('.pd-proposal')!, 'Apply');
    expect(apply().disabled).toBe(true);
    const why = document.getElementById(apply().getAttribute('aria-describedby')!)!;
    expect(why.textContent).toBe('✕ This reads like a promise of returns. A deck must not promise returns: change the wording. The words that read that way: “capital is safe”.');
    expect(FEATURES[2].status(el)).toBe('A suggestion is ready, but it cannot be applied as it is. This reads like a promise of returns. A deck must not promise returns: change the wording.');
    for (const [text, flagged] of [['Expect a 3x return within two years.', true], ['There is no way to lose on this one.', true], ['Profit is inevitable.', true], ['No guarantee of returns.', false], ['We will make the film in twelve days.', false]] as const) {
      type(labelled<HTMLTextAreaElement>(ada.querySelector('.pd-proposal')!, /^Note to them/), text);
      expect(apply().disabled, text).toBe(flagged);
      expect(apply().hasAttribute('aria-describedby'), text).toBe(flagged);
    }
    type(labelled<HTMLInputElement>(ada.querySelector('.pd-proposal')!, 'Cover line'), 'Double your money, Ada.');   // the cover line is read too
    expect(apply().disabled).toBe(true);
  });
  it('a second line that reads like a promise is shown, flagged, and cannot be used; one typed by hand is flagged under the field and not blocked', async () => {
    model({ options: ['On budget, every time.', 'Investors always get paid back in full.', 'Nothing here is guaranteed.'] });
    const el = draw();
    FEATURES[1].open(el); FEATURES[1].send(el); await tick();
    const rows = [...el.querySelectorAll<HTMLElement>('.pd-options li')];
    expect(rows.map(r => r.querySelector('button')!.disabled)).toEqual([false, true, false]);
    expect(rows[1].querySelector('.pd-bad')!.textContent).toBe(' ✕ This reads like a promise of returns. A deck must not promise returns: change the wording.');
    expect(rows[1].querySelector('button')!.getAttribute('aria-describedby')).toBe(rows[1].querySelector('.pd-bad')!.id);
    expect(FEATURES[1].status(el)).toContain('One or more cannot be used: it reads like a promise of returns.');
    click(rows[1].querySelector('button')!);
    expect(slide('team').punch).toBeUndefined();
    click(rows[2].querySelector('button')!);
    expect(slide('team').punch).toBe('Nothing here is guaranteed.');
    const field = () => labelled<HTMLInputElement>(el.querySelector('.pd-editor')!, 'Second line');
    expect(field().getAttribute('aria-invalid')).toBeNull();
    type(field(), 'You get your money back no matter what.');
    expect(slide('team').punch).toBe('You get your money back no matter what.');   // typing is never blocked
    expect(document.getElementById(field().getAttribute('aria-describedby')!)!.textContent).toBe('✕ This reads like a promise of returns. A deck must not promise returns: change the wording.');
    type(field(), 'She will return to the desert.');
    expect(document.getElementById(field().getAttribute('aria-describedby')!)!.textContent).toBe('Shown under the headline, in colour.');
  });
  it('Read my deck finds it in any slide text, with the words that tripped it', () => {
    const el = draw(false);
    pick(el, 'model');
    type(labelled<HTMLTextAreaElement>(el.querySelector('.pd-editor')!, 'Paragraph above the steps'), 'Zero risk to your principal.');
    click(button(el, 'Read my deck'));
    expect([...el.querySelectorAll('.pd-read .pd-fixes li')].map(li => li.textContent)).toEqual(['Slide 10, How the money flows, Everyone who makes the film shares in it.: This reads like a promise of returns. A deck must not promise returns: change the wording. ("Zero risk")']);
  });
});
