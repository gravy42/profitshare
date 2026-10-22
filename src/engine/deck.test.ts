import { describe, it, expect } from 'vitest';
import { deckSlides } from './deck';
import { projectBrief, draftPrompt } from '../ai';
import { sampleProject } from '../data/seed';
import { withPitch, newLookImage, newResearch, newTeamMember } from './pitch';

describe('the investor deck', () => {
  it('builds slides from the project and only shows what is there', () => {
    const p = withPitch(sampleProject());
    const base = deckSlides(p);
    expect(base[0]).toMatchObject({ kind: 'title', title: 'SALT FLAT' });
    expect(base.map(s => s.kind)).toContain('plan');
    expect(base.map(s => s.kind)).toContain('numbers');
    expect(base.map(s => s.kind)).toContain('deal');
    expect(base.map(s => s.kind)).not.toContain('team');
    const img = 'data:image/jpeg;base64,xx';
    const q = { ...p, pitch: { ...p.pitch!, why: 'Because.', lookbook: [1, 2, 3, 4, 5].map(() => newLookImage(img, 'tone')), research: [{ ...newResearch(), title: 'A finding' }], team: [{ ...newTeamMember(), name: 'A. Director', role: 'Director' }], ask: 'Units of $50K.' } };
    const slides = deckSlides(q, 'a film by A. Director');
    const kinds = slides.map(s => s.kind);
    expect(kinds.filter(k => k === 'images')).toHaveLength(2);       // five pictures: a slide of four and a slide of one
    expect(kinds).toContain('team'); expect(kinds).toContain('research'); expect(kinds).toContain('ask');
    expect(slides[1]).toMatchObject({ kind: 'text', heading: 'Why this film, why now' });
    expect(slides[slides.length - 1]).toMatchObject({ kind: 'ask', body: 'Units of $50K.' });
    const numbers = slides.find(s => s.kind === 'numbers')!;
    expect(numbers.kind === 'numbers' && numbers.cashBudget).toBeGreaterThan(0);
  });
});

describe('the AI brief', () => {
  it('describes the film from the project without inventing anything, and the prompts carry it', () => {
    const p = withPitch(sampleProject());
    const brief = projectBrief(p);
    expect(brief).toMatch(/FILM: SALT FLAT/);
    expect(brief).toMatch(/budget to raise \$8\d\d,\d{3}/);
    expect(brief).toMatch(/26 scenes/);
    expect(brief).toMatch(/12 shoot days/);
    expect(brief).toMatch(/SAG tier target/);
    expect(brief).not.toMatch(/LOGLINE/);                             // nothing written yet, nothing claimed
    const pr = draftPrompt('section', brief, 'Why women will show up');
    expect(pr).toMatch(/HEADING: Why women will show up/);
    expect(pr).toContain(brief);
  });
});
