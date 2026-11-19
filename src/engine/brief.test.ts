import { describe, it, expect } from 'vitest';
import { projectBrief, draftPrompt } from '../ai';
import { sampleProject } from '../data/seed';
import { withPitch } from './pitch';

describe('the AI brief', () => {
  it('describes the film from the project without inventing anything, and the prompts carry it', () => {
    const p = withPitch(sampleProject());
    const brief = projectBrief(p);
    expect(brief).toMatch(/FILM: SALT FLAT/);
    expect(brief).toMatch(/budget to raise \$8\d\d,\d{3}/);
    expect(brief).toMatch(/26 scenes/);
    expect(brief).toMatch(/12 shoot days/);
    expect(brief).toMatch(/SAG tier target/);
    expect(brief).not.toMatch(/LOGLINE/); // nothing written yet, nothing claimed
    const pr = draftPrompt('section', brief, 'Why women will show up');
    expect(pr).toMatch(/HEADING: Why women will show up/);
    expect(pr).toContain(brief);
  });
});
