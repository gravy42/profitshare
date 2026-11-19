// The glossary's data and its search. The wording is the owner's to change; these only hold the things a reworded
// glossary must still do: every word findable, every link landing somewhere, no house rule broken.
import { describe, expect, it } from 'vitest';
import {
  GLOSSARY,
  GLOSSARY_GROUPS,
  GLOSSARY_NOTE,
  glossaryAnchor,
  glossaryIdFromHash,
  searchGlossary,
} from './glossary';

describe('the glossary data', () => {
  it('gives every word its own id, a group that exists and a definition', () => {
    const ids = GLOSSARY.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GLOSSARY_GROUPS.map(g => g.id));
    for (const t of GLOSSARY) {
      expect(t.id, t.term).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/); // safe inside a page address
      expect(groups.has(t.group), t.term).toBe(true);
      expect(t.term.trim().length, t.id).toBeGreaterThan(1);
      expect(t.text.trim().length, t.id).toBeGreaterThan(40);
    }
    for (const g of GLOSSARY_GROUPS)
      expect(
        GLOSSARY.some(t => t.group === g.id),
        g.title,
      ).toBe(true);
  });

  it('only points "see" at words that are there, and never at itself', () => {
    const ids = new Set(GLOSSARY.map(t => t.id));
    for (const t of GLOSSARY)
      for (const s of t.see ?? []) {
        expect(ids.has(s), `${t.id} → ${s}`).toBe(true);
        expect(s).not.toBe(t.id);
      }
  });

  it('keeps the house rules: no em-dashes, and the film this was built for is not named', () => {
    const all = [
      GLOSSARY_NOTE,
      ...GLOSSARY_GROUPS.flatMap(g => [g.title, g.intro ?? '']),
      ...GLOSSARY.flatMap(t => [t.term, t.text, ...(t.also ?? []), ...(t.find ?? [])]),
    ].join('\n');
    expect(all).not.toMatch(/[—–]/);
    expect(all).not.toMatch(/alone girl/i);
  });

  it('says up front that it is not legal advice', () => {
    expect(GLOSSARY_NOTE).toMatch(/how ProfitShare uses each word/);
    expect(GLOSSARY_NOTE).toMatch(/not legal advice/);
  });

  it('covers the words the app itself puts on screen', () => {
    for (const word of [
      'up front',
      'deferred',
      'points',
      'budget to raise',
      'total production cost',
      'DIC',
      'DOOD',
      'day break',
      'off the gross',
      'recoup first',
      'pari passu',
      'pro rata',
      'bridge loan',
      'fiscal sponsor',
      'eighths',
      'call sheet',
      'collection account',
      'audit',
    ])
      expect(searchGlossary(word).length, word).toBeGreaterThan(0);
  });
});

describe('searching the glossary', () => {
  it('keeps everything for an empty search', () => {
    expect(searchGlossary('')).toHaveLength(GLOSSARY.length);
    expect(searchGlossary('   ')).toHaveLength(GLOSSARY.length);
  });
  it('finds a word by its name, whatever the capitals', () => {
    expect(searchGlossary('WATERFALL')[0].id).toBe('waterfall');
    expect(searchGlossary('stripboard')[0].id).toBe('stripboard');
  });
  it('finds a word by a trade name the app does not use', () => {
    expect(searchGlossary('approved deductions').map(t => t.id)).toContain('off-the-top');
    expect(searchGlossary('cash')[0].id).toBe('up-front');
    expect(searchGlossary('CAM')[0].id).toBe('collection-account');
    expect(searchGlossary('cross-collateralization')[0].id).toBe('cross-collateralisation'); // the American spelling
  });
  it('puts a match in the name ahead of a match in a definition', () => {
    const r = searchGlossary('points').map(t => t.id);
    expect(r[0]).toBe('points');
    expect(r.indexOf('converted-to-points')).toBeLessThan(r.indexOf('total-production-cost'));
  });
  it('needs every typed word, in any order', () => {
    expect(searchGlossary('gross off').map(t => t.id)).toContain('off-the-gross');
    expect(searchGlossary('waterfall zebra')).toHaveLength(0);
  });
  it('does not mind punctuation or an ampersand', () => {
    expect(searchGlossary('cast & crew pool')[0].id).toBe('pool');
    expect(searchGlossary('day-out-of-days')[0].id).toBe('day-out-of-days');
    expect(searchGlossary('120%').map(t => t.id)).toContain('premium');
  });
  it('finds nothing for nonsense', () => {
    expect(searchGlossary('qwertyuiop')).toEqual([]);
  });
});

describe('links to a word', () => {
  it('reads the word out of a page address', () => {
    expect(glossaryIdFromHash(`#${glossaryAnchor('points')}`)).toBe('points');
    expect(glossaryIdFromHash('glossary-pari-passu')).toBe('pari-passu');
  });
  it('opens the glossary itself for #glossary and for a word that is gone', () => {
    expect(glossaryIdFromHash('#glossary')).toBe('');
    expect(glossaryIdFromHash('#glossary-no-such-word')).toBe('');
  });
  it('leaves every other address alone', () => {
    for (const h of ['', '#', '#the-film', '#sag', '#pitch-deck', '#glossaryx'])
      expect(glossaryIdFromHash(h), h).toBeNull();
  });
});
