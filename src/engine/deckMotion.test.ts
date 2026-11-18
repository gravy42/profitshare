// Movement through the engine: from a project file (which can hold anything) to the deck's data and the editor.
import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/seed';
import { applyDeal } from './deal';
import { withPitch } from './pitch';
import { deckData, deckWarnings } from './deckData';
import { duplicateSlide, patchSlide, readSlides } from './deckEdit';
import type { LookImage, Pitch, Project, SlideSpec } from './types';

const seed = applyDeal(sampleProject());
const pic = (id: string): LookImage => ({ id, dataUrl: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" id="${id}"/>`, caption: `Picture ${id}`, section: 'tone' });
const withSlides = (slides: unknown[], over: Partial<Pitch> = {}): Project => { const q = withPitch(seed); return { ...q, pitch: { ...q.pitch!, lookbook: [pic('a'), pic('b')], slides: slides as SlideSpec[], ...over } }; };
const plan = (motion: unknown, id = 'plan') => ({ id, layout: 'timeline', headline: 'An invented plan', milestones: [{ id: 'm1', when: 'Spring 2031', what: 'Shoot' }], motion });
const cards = (motion: unknown, extra: Record<string, unknown> = {}) => ({ id: 'gap', layout: 'cards', headline: 'An invented headline', cards: [{ id: 'c1', title: 'One', body: 'First.' }], motion, ...extra });

describe('movement in the deck\'s data', () => {
  it('a project with no movement gives a deck with none: no key on the deck, none on a slide', () => {
    const d = deckData(withSlides([cards(undefined)]));
    expect('motion' in d).toBe(false);
    expect('motion' in d.slides[0]).toBe(false);
  });
  it('carries a slide\'s movement and the deck\'s, cleaned', () => {
    const d = deckData(withSlides([cards({ entrance: 'drop', order: 'one-by-one', stagger: 120.4, headline: 'type', count: true })], { deckMotion: { pace: 'brisk', entrance: 'fade' } }));
    expect(d.slides[0].motion).toEqual({ entrance: 'drop', order: 'one-by-one', stagger: 120, headline: 'type', count: true });
    expect(d.motion).toEqual({ pace: 'brisk', entrance: 'fade' });
  });
  it('drops whatever is not in the vocabulary, on a slide and on the deck', () => {
    const d = deckData(withSlides([cards({ entrance: 'spin', order: 7, stagger: 'fast', style: 'color:red', keyframes: [{ transform: 'rotate(9deg)' }] }), { id: 't', layout: 'text', body: 'x', motion: 'drop' }], { deckMotion: { pace: 'frantic', entrance: 'url(https://example.com)', css: '}' } as never }));
    expect('motion' in d.slides[0]).toBe(false);
    expect('motion' in d.slides[1]).toBe(false);
    expect(d.motion).toEqual({ pace: 'calm', entrance: 'rise' });
    expect(JSON.stringify(d)).not.toMatch(/example\.com|rotate|color:red/);
    expect('motion' in deckData(withSlides([cards(undefined)], { deckMotion: 'brisk' as never }))).toBe(false);
  });
  it('a travelling picture goes into the deck\'s pictures, once, even when no slide has it behind it', () => {
    const d = deckData(withSlides([plan({ marker: { imageId: 'b', path: 'timeline', end: 'settle' } }), plan({ marker: { imageId: 'b', path: 'timeline', end: 'stop' } }, 'plan2')]));
    expect(d.images.map(i => i.id)).toEqual(['b']);
    expect(d.slides[0].motion).toEqual({ marker: { imageId: 'b', path: 'timeline', end: 'settle' } });
  });
  it('a travelling picture that is not in the look book is left off the deck, the rest of the movement stays, and the author is told', () => {
    const p = withSlides([plan({ entrance: 'fade', marker: { imageId: 'gone', path: 'timeline', end: 'stop' } }), plan({ marker: { imageId: 'gone', path: 'timeline', end: 'stop' } }, 'plan2')]);
    const d = deckData(p);
    expect(d.slides[0].motion).toEqual({ entrance: 'fade' });
    expect('motion' in d.slides[1]).toBe(false);
    expect(d.images).toEqual([]);
    expect(deckWarnings(p).filter(w => w.where === 'marker').map(w => w.slideId)).toEqual(['plan', 'plan2']);
    expect(deckWarnings(p).find(w => w.where === 'marker')!.message).toBe('The picture that travels along the timeline on this slide is no longer in the look book, so it is left off.');
    expect(deckWarnings(withSlides([plan({ marker: { imageId: 'a', path: 'timeline', end: 'stop' } })])).filter(w => w.where === 'marker')).toEqual([]);
  });
  it('keeps a travelling picture only on the plan, along its timeline: on cards it is dropped without a word', () => {
    const p = withSlides([{ id: 's', layout: 'stats', stats: [], motion: { count: true, marker: { imageId: 'a', path: 'line', end: 'stop' } } }, { id: 'p', layout: 'timeline', motion: { marker: { imageId: 'a', path: 'line', end: 'stop' } } },
      cards({ order: 'one-by-one', stagger: 140, marker: { imageId: 'a', path: 'line', end: 'stop' } }), { ...cards({ marker: { imageId: 'gone', path: 'line', end: 'settle' } }, { id: 'ways' }), layout: 'ways' }] as never);
    const d = deckData(p);
    expect(d.slides[0].motion).toEqual({ count: true });
    expect(d.slides[1].motion!.marker!.path).toBe('timeline');
    expect(d.slides[2].motion).toEqual({ order: 'one-by-one', stagger: 140 });   // an old project's cards still arrive one at a time
    expect('motion' in d.slides[3]).toBe(false);
    expect(deckWarnings(p).filter(w => w.where === 'marker')).toEqual([]);   // nothing to fix: the picture on cards is simply gone
    expect(JSON.stringify(d.slides)).not.toContain('"line"');
  });
});

describe('movement in the editor', () => {
  it('reads a slide\'s movement cleaned, and leaves it off when there is none', () => {
    const got = readSlides([cards({ entrance: 'drop', junk: 1 }), { id: 't', layout: 'text', motion: { entrance: 'nope' } }]);
    expect(got[0].motion).toEqual({ entrance: 'drop' });
    expect('motion' in got[1]).toBe(false);
  });
  it('a patch sets it, and a patch of undefined takes it off the slide', () => {
    const one = patchSlide([cards(undefined)], 'gap', { motion: { count: true } });
    expect(one[0].motion).toEqual({ count: true });
    expect('motion' in patchSlide(one, 'gap', { motion: undefined })[0]).toBe(false);
  });
  it('a copy of a slide moves the way the slide does', () => {
    const made = duplicateSlide([cards({ order: 'reverse' })], 'gap');
    expect(made.slides[1].motion).toEqual({ order: 'reverse' });
    expect(made.slides[1].motion).not.toBe(made.slides[0].motion);
  });
});
