// Google Fonts, the rules: the bundled catalogue, searching it, which weights a role gets, the one address that is
// asked for, reading Google's answer (and refusing anything that is not Google's), and a picked family as the
// project's font files. No network and no DOM: the stylesheets below are written by hand in the format Google documents.
import { describe, expect, it } from 'vitest';
import raw from '../data/google-fonts.json';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyDeal } from './deal';
import { deckData, fontFacesOf } from './deckData';
import { fontsLeftOut, sendSummary } from './deckExport';
import { readFontFiles, setFontFile } from './deckEdit';
import { defaultDesign, withPitch } from './pitch';
import { sampleProject } from '../data/seed';
import type { FontFile, Project } from './types';
import {
  GOOGLE_CSS_MAX,
  GOOGLE_DISCLOSURE,
  PREVIEW_LETTERS,
  css2Url,
  filesToFetch,
  findFamily,
  googleFontFiles,
  isGoogleFontsUrl,
  parseCss2,
  parsePreviewCss,
  planInWords,
  previewCssUrl,
  previewFaceName,
  readCatalogue,
  removeRoleFonts,
  roleFont,
  searchCatalogue,
  setRoleFonts,
  weightsFor,
  weightsInWords,
  type CatalogueFamily,
} from './googleFonts';

const catalogue = readCatalogue(raw);
const fam = (name: string): CatalogueFamily => {
  const f = findFamily(catalogue.families, name);
  if (!f) throw new Error(`${name} is not in the catalogue`);
  return f;
};
const made = (over: Partial<CatalogueFamily>): CatalogueFamily => ({
  family: 'Invented Face',
  category: 'serif',
  weights: [400],
  italics: [],
  licence: 'OFL',
  latinExt: false,
  rank: 0,
  ...over,
});
const WOFF2 = 'data:font/woff2;base64,d09GMgABAAAAAA=='; // invented bytes: nothing here parses them
const OTHER = 'data:font/woff2;base64,d09GMgABAAAAAQ==';

describe('the bundled catalogue', () => {
  it("is small, says where and when it came from, and is not in the app's first file", () => {
    const text = readFileSync(resolve(process.cwd(), 'src/data/google-fonts.json'), 'utf8');
    expect(text.length).toBeLessThan(120_000);
    expect(catalogue.made).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(catalogue.source).toMatch(/google-font-metadata \d/);
    expect(catalogue.source).toMatch(/google\/fonts [0-9a-f]{10}/);
    // only the picker's own files name it, and they ask for it when it is opened
    const net = readFileSync(resolve(process.cwd(), 'src/ui/googleFontsNet.ts'), 'utf8');
    expect(net).toContain("import('../data/google-fonts.json')");
    for (const f of [
      'src/App.tsx',
      'src/ui/PitchExtras.tsx',
      'src/ui/GoogleFonts.tsx',
      'src/ui/DesignBuilder.tsx',
      'src/store.ts',
    ])
      expect(readFileSync(resolve(process.cwd(), f), 'utf8')).not.toContain('google-fonts.json');
    expect(readFileSync(resolve(process.cwd(), 'src/ui/PitchExtras.tsx'), 'utf8')).toContain(
      "lazy(() => import('./GoogleFonts')",
    );
    expect(readFileSync(resolve(process.cwd(), 'src/ui/GoogleFonts.tsx'), 'utf8')).toContain(
      "lazy(() => import('./GoogleFontsDialog'))",
    );
  });
  it('lists well over 1,500 families, every one with a plain name, a kind, a weight and an open licence', () => {
    expect(catalogue.families.length).toBeGreaterThan(1500);
    expect(catalogue.families.length).toBe((raw as { families: unknown[] }).families.length); // nothing the script wrote is refused
    for (const f of catalogue.families) {
      expect(f.family).toMatch(/^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/);
      expect(f.weights.length).toBeGreaterThan(0);
      expect(['OFL', 'Apache', 'UFL']).toContain(f.licence);
      for (const w of [...f.weights, ...f.italics]) expect(w % 100 === 0 && w >= 100 && w <= 900).toBe(true);
      if (f.variable) expect(f.variable[0] < f.variable[1] && f.variable[0] >= 1 && f.variable[1] <= 1000).toBe(true);
    }
    const names = catalogue.families.map(f => f.family.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(names); // A to Z as written
    expect(new Set(catalogue.families.map(f => f.category))).toEqual(
      new Set(['sans-serif', 'serif', 'display', 'handwriting', 'monospace']),
    );
    expect(fam('Work Sans')).toMatchObject({
      category: 'sans-serif',
      licence: 'OFL',
      variable: [100, 900],
      latinExt: true,
    });
    expect(fam('Special Elite')).toMatchObject({ weights: [400], italics: [], licence: 'Apache' });
    expect(fam('Ubuntu').licence).toBe('UFL');
  });
  it('reads only rows that are what the script writes', () => {
    const c = readCatalogue({
      made: '2026-01-01',
      rank: 'google',
      families: [
        ['Good Face', 1, 8 | 64, 8, 0, 1, 3],
        ['Good Variable', 0, 511, 0, 1, 0, 0, 100, 900],
        ['Bad"Name', 0, 8, 0, 0, 0, 0],
        ['../etc', 0, 8, 0, 0, 0, 0],
        ['a&family=Other', 0, 8, 0, 0, 0, 0],
        [' Leading', 0, 8, 0, 0, 0, 0],
        ['A'.repeat(61), 0, 8, 0, 0, 0, 0],
        ['No Kind', 9, 8, 0, 0, 0, 0],
        ['No Licence', 0, 8, 0, 7, 0, 0],
        ['No Weight', 0, 0, 0, 0, 0, 0],
        ['Good Face', 0, 8, 0, 0, 0, 0],
        ['good face', 0, 8, 0, 0, 0, 0],
        ['Odd Range', 0, 8, 0, 0, 0, 0, 900, 100],
        ['Wide Range', 0, 8, 0, 0, 0, 0, 0, 2000],
        'text',
        null,
        7,
        {},
        [],
      ],
    });
    expect(c.rank).toBe('google');
    expect(c.families).toEqual([
      {
        family: 'Good Face',
        category: 'serif',
        weights: [400, 700],
        italics: [400],
        licence: 'OFL',
        latinExt: true,
        rank: 3,
      },
      {
        family: 'Good Variable',
        category: 'sans-serif',
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        italics: [],
        licence: 'Apache',
        latinExt: false,
        rank: 0,
        variable: [100, 900],
      },
      {
        family: 'Odd Range',
        category: 'sans-serif',
        weights: [400],
        italics: [],
        licence: 'OFL',
        latinExt: false,
        rank: 0,
      }, // a range that is not one is no range
      {
        family: 'Wide Range',
        category: 'sans-serif',
        weights: [400],
        italics: [],
        licence: 'OFL',
        latinExt: false,
        rank: 0,
      },
    ]);
    for (const v of [undefined, null, 'x', 3, [], { families: 'no' }]) expect(readCatalogue(v).families).toEqual([]);
  });
});

describe('searching the catalogue', () => {
  const list = [
    made({ family: 'Lora', rank: 2 }),
    made({ family: 'Alora Sans', category: 'sans-serif' }),
    made({ family: 'Lorax Display', category: 'display', rank: 1 }),
    made({ family: 'Bitter', rank: 3 }),
    made({ family: 'abel', category: 'sans-serif' }),
    made({ family: 'Sans Lora', category: 'sans-serif' }),
  ];
  const names = (q: Parameters<typeof searchCatalogue>[1]) => searchCatalogue(list, q).map(f => f.family);
  it('with nothing typed lists everything: ranked families first in their order, then the rest A to Z', () => {
    expect(names({})).toEqual(['Lorax Display', 'Lora', 'Bitter', 'abel', 'Alora Sans', 'Sans Lora']);
    expect(names({ sort: 'az' })).toEqual(['abel', 'Alora Sans', 'Bitter', 'Lora', 'Lorax Display', 'Sans Lora']);
  });
  it('finds every word typed, whatever its capitals, and puts names that start with it first', () => {
    expect(names({ query: 'LORA' })).toEqual(['Lorax Display', 'Lora', 'Sans Lora', 'Alora Sans']); // starts with it; a word starts with it; has it somewhere
    expect(names({ query: 'lora', sort: 'az' })).toEqual(['Lora', 'Lorax Display', 'Sans Lora', 'Alora Sans']);
    expect(names({ query: '  sans   lora ' })).toEqual(['Sans Lora', 'Alora Sans']);
    expect(names({ query: 'zzz' })).toEqual([]);
    expect(names({ query: '"; drop' })).toEqual([]);
    expect(names({ query: '<b>' })).toEqual(['Bitter', 'abel']); // marks are not letters: what is left is searched
  });
  it('keeps to one kind when asked', () => {
    expect(names({ category: 'sans-serif' })).toEqual(['abel', 'Alora Sans', 'Sans Lora']);
    expect(names({ category: 'display', query: 'lor' })).toEqual(['Lorax Display']);
    expect(names({ category: 'monospace' })).toEqual([]);
  });
  it('is the same every time, and does not change the list it was given', () => {
    const before = JSON.stringify(list);
    expect(names({ query: 'a' })).toEqual(names({ query: 'a' }));
    expect(JSON.stringify(list)).toBe(before);
    expect(searchCatalogue(catalogue.families, {})).toHaveLength(catalogue.families.length);
    expect(searchCatalogue(catalogue.families, { query: 'work sans' })[0].family).toBe('Work Sans');
  });
  it("finds a typed name in the catalogue and hands back the catalogue's own spelling", () => {
    expect(findFamily(catalogue.families, 'work sans')?.family).toBe('Work Sans');
    expect(findFamily(catalogue.families, '"Work  Sans", sans-serif')?.family).toBe('Work Sans');
    expect(findFamily(catalogue.families, "'LATO'")?.family).toBe('Lato');
    for (const v of ['', 'Not A Font At All', 'Lato&text=x', 'Lato/../x', undefined, null, 7])
      expect(findFamily(catalogue.families, v)).toBeUndefined();
  });
  it("says a family's weights in words", () => {
    expect(weightsInWords(made({ weights: [400] }))).toBe('One weight');
    expect(weightsInWords(made({ weights: [300] }))).toBe('One weight (300)');
    expect(weightsInWords(made({ weights: [400], italics: [400] }))).toBe('One weight, with an italic');
    expect(weightsInWords(made({ weights: [400, 700], italics: [400, 700] }))).toBe('Regular and bold, with italics');
    expect(weightsInWords(made({ weights: [100, 300, 400, 700, 900] }))).toBe('5 weights, 100 to 900');
    expect(weightsInWords(made({ weights: [400, 700], variable: [400, 700], italics: [400] }))).toBe(
      'Variable, 400 to 700, with italics',
    );
  });
});

describe('which weights a role gets', () => {
  it('a title: the regular and the bold nearest 700', () => {
    expect(weightsFor('title', made({ weights: [100, 300, 400, 700, 900], italics: [400] }))).toEqual({
      regular: 400,
      bold: 700,
    });
    expect(weightsFor('title', made({ weights: [400, 600, 800] }))).toEqual({ regular: 400, bold: 600 }); // as near one as the other: the lighter
    expect(weightsFor('title', made({ weights: [400, 500] }))).toEqual({ regular: 400, bold: 500 }); // nothing from 600 up: its heaviest
    expect(weightsFor('title', made({ weights: [400] }))).toEqual({ regular: 400 }); // one weight: bold is drawn from it, as before
  });
  it('body text: the regular, the bold nearest 600 (what the deck asks for), and an italic when there is one', () => {
    expect(weightsFor('body', made({ weights: [300, 400, 500, 600, 700], italics: [400, 700] }))).toEqual({
      regular: 400,
      bold: 600,
      italic: 400,
    });
    expect(weightsFor('body', made({ weights: [400, 700], italics: [] }))).toEqual({ regular: 400, bold: 700 });
    expect(weightsFor('body', made({ weights: [400, 700, 900], italics: [700] }))).toEqual({
      regular: 400,
      bold: 700,
      italic: 700,
    }); // no italic at 400: the nearest
  });
  it('a family with no 400 gets the weight nearest it', () => {
    expect(weightsFor('title', made({ weights: [300, 700] }))).toEqual({ regular: 300, bold: 700 });
    expect(weightsFor('title', made({ weights: [700, 900] }))).toEqual({ regular: 700, bold: 900 });
    expect(weightsFor('body', made({ weights: [500] }))).toEqual({ regular: 500 });
    expect(weightsFor('body', made({ weights: [300, 500] }))).toEqual({ regular: 300, bold: 500 });
  });
  it('a variable family is one file with every weight, and for body text its italic', () => {
    expect(weightsFor('title', made({ weights: [100, 400, 900], italics: [400], variable: [100, 900] }))).toEqual({
      regular: 400,
      range: [100, 900],
    });
    expect(weightsFor('body', made({ weights: [100, 400, 900], italics: [400], variable: [100, 900] }))).toEqual({
      regular: 400,
      range: [100, 900],
      italic: 400,
    });
    expect(weightsFor('body', made({ weights: [500, 900], variable: [500, 900] }))).toEqual({
      regular: 500,
      range: [500, 900],
    });
  });
  it('for every family in the catalogue picks weights the family has', () => {
    for (const f of catalogue.families)
      for (const role of ['title', 'body'] as const) {
        const p = weightsFor(role, f);
        if (p.range) {
          expect(p.range).toEqual(f.variable);
          expect(p.regular >= p.range[0] && p.regular <= p.range[1]).toBe(true);
        } else {
          expect(f.weights).toContain(p.regular);
          if (p.bold !== undefined) {
            expect(f.weights).toContain(p.bold);
            expect(p.bold).toBeGreaterThan(p.regular);
          }
          if (p.italic !== undefined) expect(f.italics).toContain(p.italic);
        }
        if (role === 'title') expect(p.italic).toBeUndefined();
      }
  });
  it('says the plan in words', () => {
    expect(planInWords({ regular: 400, bold: 700 })).toBe('Regular 400 and bold 700');
    expect(planInWords({ regular: 400, bold: 600, italic: 400 })).toBe('Regular 400, bold 600 and italic');
    expect(planInWords({ regular: 300 })).toBe('Weight 300');
    expect(planInWords({ regular: 400, range: [100, 900], italic: 400 })).toBe(
      'Every weight from 100 to 900, and italics',
    );
  });
});

describe('the address that is asked for', () => {
  it("is Google's css2 form: the family, its weights in order, display=swap", () => {
    expect(css2Url(fam('Lato'), { regular: 400, bold: 700 })).toBe(
      'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap',
    );
    expect(css2Url(fam('Lato'), { regular: 400, bold: 700, italic: 400 })).toBe(
      'https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;1,400&display=swap',
    );
    expect(css2Url(fam('Lato'), { regular: 400, bold: 700, italic: 400 }, { italic: false })).toBe(
      'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap',
    );
    expect(css2Url(fam('Special Elite'), { regular: 400 })).toBe(
      'https://fonts.googleapis.com/css2?family=Special+Elite:wght@400&display=swap',
    );
    expect(css2Url(fam('Work Sans'), { regular: 400, range: [100, 900] })).toBe(
      'https://fonts.googleapis.com/css2?family=Work+Sans:wght@100..900&display=swap',
    );
    expect(css2Url(fam('Work Sans'), { regular: 400, range: [100, 900], italic: 400 })).toBe(
      'https://fonts.googleapis.com/css2?family=Work+Sans:ital,wght@0,100..900;1,100..900&display=swap',
    );
    expect(css2Url(fam('Source Sans 3'), weightsFor('title', fam('Source Sans 3')))).toMatch(
      /^https:\/\/fonts\.googleapis\.com\/css2\?family=Source\+Sans\+3:wght@\d+\.\.\d+&display=swap$/,
    );
  });
  it('for every family and both roles is on the one host and holds nothing but the name and numbers', () => {
    const ok =
      /^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z0-9+]+:(wght@\d+(\.\.\d+)?(;\d+)*|ital,wght@[01],\d+(\.\.\d+)?(;[01],\d+(\.\.\d+)?)*)&display=swap$/;
    for (const f of catalogue.families)
      for (const role of ['title', 'body'] as const) {
        const url = css2Url(f, weightsFor(role, f));
        expect(url).toMatch(ok);
        expect(new URL(url).hostname).toBe('fonts.googleapis.com');
        expect(new URL(url).searchParams.get('family')!.split(':')[0]).toBe(f.family);
        expect(new URL(previewCssUrl(f)).hostname).toBe('fonts.googleapis.com');
      }
  });
  it('refuses a name that did not come from the catalogue', () => {
    for (const family of [
      'Lato&family=Other',
      'Lato:wght@400',
      'Lato/../../x',
      'Lato#x',
      'Lato?x=1',
      'Läto',
      '',
      ' Lato',
      'https://evil.invalid/x',
    ])
      expect(() => css2Url(made({ family }), { regular: 400 })).toThrow();
    expect(() => previewCssUrl(made({ family: 'a b&c' }))).toThrow();
  });
  it('a preview asks for one weight and a fixed set of letters: nothing of the film', () => {
    const url = new URL(previewCssUrl(fam('Lato')));
    expect(url.origin + url.pathname).toBe('https://fonts.googleapis.com/css2');
    expect([...url.searchParams.keys()]).toEqual(['family', 'text', 'display']);
    expect(url.searchParams.get('family')).toBe('Lato:wght@400');
    expect(url.searchParams.get('text')).toBe(PREVIEW_LETTERS);
    expect(previewCssUrl(fam('Lato'))).toBe(previewCssUrl(fam('Lato')));
    expect(PREVIEW_LETTERS).toMatch(/^[ -~]+$/);
    expect(new URL(previewCssUrl(made({ family: 'Light Only', weights: [300] }))).searchParams.get('family')).toBe(
      'Light Only:wght@300',
    );
  });
  it('knows its two hosts and no other', () => {
    for (const ok of ['https://fonts.googleapis.com/css2?family=Lato', 'https://fonts.gstatic.com/s/lato/v25/a.woff2'])
      expect(isGoogleFontsUrl(ok)).toBe(true);
    for (const bad of [
      'http://fonts.googleapis.com/css2',
      'https://fonts.googleapis.com.evil.invalid/css2',
      'https://fonts.gstatic.com@evil.invalid/a.woff2',
      'https://evil.invalid/?https://fonts.gstatic.com/',
      '//fonts.gstatic.com/a',
      'javascript:alert(1)',
      '',
      null,
      4,
    ])
      expect(isGoogleFontsUrl(bad)).toBe(false);
  });
  it('the words shown before anything is asked name both hosts and what is and is not sent', () => {
    expect(GOOGLE_DISCLOSURE).toBe(
      "Browsing fonts loads previews from Google Fonts (fonts.googleapis.com and fonts.gstatic.com). Google sees your computer's address and which fonts you look at, the same as on any site that uses Google Fonts. Nothing about your project is sent. The font you pick is saved into your project, so your deck never needs Google again.",
    );
  });
});

// What Google sends for /css2?family=Lato:ital,wght@0,400;0,700;1,400 to a browser that reads woff2: a block for each
// subset of each face, most with a comment naming the subset above it.
const block = (o: { subset?: string; family?: string; style?: string; weight?: string; url: string; range?: string }) =>
  `${o.subset ? `/* ${o.subset} */\n` : ''}@font-face {\n  font-family: '${o.family ?? 'Lato'}';\n  font-style: ${o.style ?? 'normal'};\n  font-weight: ${o.weight ?? '400'};\n  font-display: swap;\n  src: url(${o.url}) format('woff2');\n${o.range ? `  unicode-range: ${o.range};\n` : ''}}\n`;
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
const CYRILLIC = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
const VIETNAMESE =
  'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB';
const G = 'https://fonts.gstatic.com/s';
const LATO_CSS = [
  block({ subset: 'latin-ext', style: 'italic', url: `${G}/lato/v25/S6u8w4BMUTPHjxsAUi-qJCY.woff2`, range: LATIN_EXT }),
  block({ subset: 'latin', style: 'italic', url: `${G}/lato/v25/S6u8w4BMUTPHjxsAXC-q.woff2`, range: LATIN }),
  block({ subset: 'latin-ext', url: `${G}/lato/v25/S6uyw4BMUTPHjxAwXjeu.woff2`, range: LATIN_EXT }),
  block({ subset: 'latin', url: `${G}/lato/v25/S6uyw4BMUTPHjx4wXg.woff2`, range: LATIN }),
  block({ subset: 'latin-ext', weight: '700', url: `${G}/lato/v25/S6u9w4BMUTPHh6UVSwaPGR_p.woff2`, range: LATIN_EXT }),
  block({ subset: 'latin', weight: '700', url: `${G}/lato/v25/S6u9w4BMUTPHh6UVSwiPGQ.woff2`, range: LATIN }),
].join('');
const WORK_SANS_CSS = [
  block({
    subset: 'vietnamese',
    family: 'Work Sans',
    style: 'italic',
    weight: '100 900',
    url: `${G}/worksans/v24/QGYqz_wNahGAdqQ43Rh_eZDkv_1w4A.woff2`,
    range: VIETNAMESE,
  }),
  block({
    subset: 'latin-ext',
    family: 'Work Sans',
    style: 'italic',
    weight: '100 900',
    url: `${G}/worksans/v24/QGYqz_wNahGAdqQ43Rh_eZDlv_1w4A.woff2`,
    range: LATIN_EXT,
  }),
  block({
    subset: 'latin',
    family: 'Work Sans',
    style: 'italic',
    weight: '100 900',
    url: `${G}/worksans/v24/QGYqz_wNahGAdqQ43Rh_eZDrv_0.woff2`,
    range: LATIN,
  }),
  block({
    subset: 'vietnamese',
    family: 'Work Sans',
    weight: '100 900',
    url: `${G}/worksans/v24/QGYsz_wNahGAdqQ43Rh_c6Dpp_k.woff2`,
    range: VIETNAMESE,
  }),
  block({
    subset: 'latin-ext',
    family: 'Work Sans',
    weight: '100 900',
    url: `${G}/worksans/v24/QGYsz_wNahGAdqQ43Rh_cqDpp_k.woff2`,
    range: LATIN_EXT,
  }),
  block({
    subset: 'latin',
    family: 'Work Sans',
    weight: '100 900',
    url: `${G}/worksans/v24/QGYsz_wNahGAdqQ43Rh_fKDp.woff2`,
    range: LATIN,
  }),
].join('');

describe("reading Google's answer", () => {
  it('reads every block: family, style, weight, address, subset and range', () => {
    const faces = parseCss2(LATO_CSS);
    expect(faces).toHaveLength(6);
    expect(faces[1]).toEqual({
      family: 'Lato',
      style: 'italic',
      weight: 400,
      url: `${G}/lato/v25/S6u8w4BMUTPHjxsAXC-q.woff2`,
      subset: 'latin',
      unicodeRange: LATIN,
    });
    expect(faces.map(f => `${f.subset} ${f.style} ${f.weight}`)).toEqual([
      'latin-ext italic 400',
      'latin italic 400',
      'latin-ext normal 400',
      'latin normal 400',
      'latin-ext normal 700',
      'latin normal 700',
    ]);
  });
  it('takes the latin file of each weight the plan asked for, and no other subset', () => {
    const lato = fam('Lato');
    expect(filesToFetch(parseCss2(LATO_CSS), lato, { regular: 400, bold: 700, italic: 400 })).toEqual([
      { url: `${G}/lato/v25/S6uyw4BMUTPHjx4wXg.woff2`, weight: 400, style: 'normal' },
      { url: `${G}/lato/v25/S6u9w4BMUTPHh6UVSwiPGQ.woff2`, weight: 700, style: 'normal' },
      { url: `${G}/lato/v25/S6u8w4BMUTPHjxsAXC-q.woff2`, weight: 400, style: 'italic' },
    ]);
    expect(filesToFetch(parseCss2(LATO_CSS), lato, { regular: 400, bold: 700 }).map(f => f.style)).toEqual([
      'normal',
      'normal',
    ]);
    expect(filesToFetch(parseCss2(LATO_CSS), lato, { regular: 400, bold: 900 })).toHaveLength(1); // a weight Google did not send is not made up
    expect(filesToFetch(parseCss2(LATO_CSS), fam('Lora'), { regular: 400 })).toEqual([]); // another family's answer is not this family's
  });
  it('a variable family is one file for its whole range of weights', () => {
    const faces = parseCss2(WORK_SANS_CSS);
    expect(faces).toHaveLength(6);
    expect(faces[5]).toMatchObject({ family: 'Work Sans', style: 'normal', weight: [100, 900], subset: 'latin' });
    const ws = fam('Work Sans');
    expect(filesToFetch(faces, ws, weightsFor('title', ws))).toEqual([
      { url: `${G}/worksans/v24/QGYsz_wNahGAdqQ43Rh_fKDp.woff2`, weight: [100, 900], style: 'normal' },
    ]);
    expect(filesToFetch(faces, ws, weightsFor('body', ws))).toEqual([
      { url: `${G}/worksans/v24/QGYsz_wNahGAdqQ43Rh_fKDp.woff2`, weight: [100, 900], style: 'normal' },
      { url: `${G}/worksans/v24/QGYqz_wNahGAdqQ43Rh_eZDrv_0.woff2`, weight: [100, 900], style: 'italic' },
    ]);
  });
  it('works out the subset from the range when no comment names it, and reads minified text and double quotes', () => {
    const bare =
      block({ url: `${G}/lato/v25/a.woff2`, range: CYRILLIC }) +
      block({ url: `${G}/lato/v25/b.woff2`, range: LATIN_EXT }) +
      block({ url: `${G}/lato/v25/c.woff2`, range: LATIN }) +
      block({ url: `${G}/lato/v25/d.woff2` });
    expect(parseCss2(bare).map(f => f.subset)).toEqual(['other', 'latin-ext', 'latin', 'latin']);
    expect(filesToFetch(parseCss2(bare), fam('Lato'), { regular: 400 })[0].url).toBe(`${G}/lato/v25/c.woff2`);
    const tight = `@font-face{font-family:"Lato";font-style:normal;font-weight:400;font-display:swap;src:url("${G}/lato/v25/x_Y-z.woff2") format("woff2");unicode-range:U+0000-00FF,U+0131}`;
    expect(parseCss2(tight)).toEqual([
      {
        family: 'Lato',
        style: 'normal',
        weight: 400,
        url: `${G}/lato/v25/x_Y-z.woff2`,
        subset: 'latin',
        unicodeRange: 'U+0000-00FF,U+0131',
      },
    ]);
  });
  it('leaves out every block that is not what Google writes: other hosts, other schemes, other formats', () => {
    const bad = [
      block({ subset: 'latin', url: 'https://evil.invalid/lato.woff2', range: LATIN }),
      block({ subset: 'latin', url: 'http://fonts.gstatic.com/s/lato/v25/a.woff2', range: LATIN }),
      block({ subset: 'latin', url: '//fonts.gstatic.com/s/lato/v25/a.woff2', range: LATIN }),
      block({ subset: 'latin', url: 'https://fonts.gstatic.com.evil.invalid/s/lato/v25/a.woff2', range: LATIN }),
      block({ subset: 'latin', url: 'https://fonts.gstatic.com@evil.invalid/a.woff2', range: LATIN }),
      block({ subset: 'latin', url: 'https://evil.invalid/https://fonts.gstatic.com/s/a.woff2', range: LATIN }),
      block({ subset: 'latin', url: 'https://fonts.gstatic.com/s/lato/../../x.woff2', range: LATIN }),
      block({
        subset: 'latin',
        url: 'https://fonts.gstatic.com/s/lato/v25/a.woff2?next=https://evil.invalid',
        range: LATIN,
      }),
      block({ subset: 'latin', url: 'https://fonts.gstatic.com/s/lato/v25/a.woff2#x', range: LATIN }),
      block({ subset: 'latin', url: 'https://fonts.gstatic.com/s/lato/v25/a.ttf', range: LATIN }),
      block({ subset: 'latin', url: 'https://fonts.gstatic.com/s/lato/v25/a.woff2%0Ax', range: LATIN }),
      block({ subset: 'latin', url: 'javascript:alert(1)', range: LATIN }),
      block({ subset: 'latin', url: 'data:font/woff2;base64,AAAA', range: LATIN }),
      block({ subset: 'latin', url: 'blob:https://fonts.gstatic.com/1', range: LATIN }),
      block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, weight: 'bold', range: LATIN }),
      block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, weight: '0', range: LATIN }),
      block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, weight: '900 100', range: LATIN }),
      block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, weight: '400 5000', range: LATIN }),
      block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, style: 'oblique 10deg', range: LATIN }),
      block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, range: 'U+0000-00FF, expression(alert(1))' }),
      block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, family: '!!' }),
      `@font-face { font-family: 'Lato'; font-style: normal; font-weight: 400; src: url(${G}/lato/v25/a.woff2) format('truetype'); }`,
      `@font-face { font-family: 'Lato'; font-style: normal; font-weight: 400; src: url(${G}/lato/v25/a.woff2); }`,
      `@font-face { font-family: 'Lato'; font-style: normal; font-weight: 400; src: url(${G}/lato/v25/a.woff2) format('woff2'), url(https://evil.invalid/b.woff2) format('woff2'); }`,
      `@font-face { font-family: 'Lato'; font-style: normal; font-weight: 400; src: local('Lato'), url(${G}/lato/v25/a.woff2) format('woff2'); }`,
      `@font-face { font-family: 'Lato'; font-style: normal; font-weight: 400; src: url(${G}/lato/v25/a.woff2) format('woff2'); src: url(https://evil.invalid/b.woff2) format('woff2'); }`,
      `@font-face { font-family: 'Lato'; font-weight: 400; src: url( ${G}/lato/v25/a b.woff2 ) format('woff2'); }`,
    ];
    for (const one of bad) expect(parseCss2(one), one).toEqual([]);
    expect(parseCss2(bad.join('\n'))).toEqual([]);
    // a good block among them is still read, alone
    const mixed = parseCss2(bad.join('\n') + block({ subset: 'latin', url: `${G}/lato/v25/good.woff2`, range: LATIN }));
    expect(mixed.map(f => f.url)).toEqual([`${G}/lato/v25/good.woff2`]);
    for (const f of mixed) expect(isGoogleFontsUrl(f.url)).toBe(true);
  });
  it('refuses the whole answer when anything but @font-face blocks and comments is in it', () => {
    const good = block({ subset: 'latin', url: `${G}/lato/v25/good.woff2`, range: LATIN });
    expect(parseCss2(good)).toHaveLength(1);
    expect(parseCss2(`/* a note */\n${good}\n/* latin */ /* and another */`)).toHaveLength(1);
    for (const extra of [
      `@import url("https://evil.invalid/more.css");`,
      `@import "https://fonts.gstatic.com/x.woff2";`,
      `body { background: url(https://evil.invalid/pixel.gif) }`,
      `a::after { content: "@font-face { src: url(https://evil.invalid/a.woff2) }" }`,
      `<script>alert(1)</script>`,
      `<style>@font-face{font-family:x;src:url(https://evil.invalid/a.woff2) format('woff2')}</style>`,
      `@media screen { @font-face { font-family: 'Lato'; font-weight: 400; src: url(${G}/lato/v25/a.woff2) format('woff2'); } }`,
      block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, range: 'U+0000-00FF; } body { display: none' }),
      block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, family: '"; } * { color: red' }),
      `/* never closed`,
      `}`,
      `x`,
    ]) {
      expect(parseCss2(good + extra), extra).toEqual([]);
      expect(parseCss2(extra + good), extra).toEqual([]);
    }
  });
  it("gives nothing for a stylesheet too long to be one family's, or for something that is not text", () => {
    const one = block({ subset: 'latin', url: `${G}/lato/v25/a.woff2`, range: LATIN });
    expect(parseCss2(one + ' '.repeat(GOOGLE_CSS_MAX))).toEqual([]);
    expect(parseCss2(one.repeat(Math.ceil(GOOGLE_CSS_MAX / one.length) + 1))).toEqual([]);
    const started = Date.now();
    expect(parseCss2('/* '.repeat(60_000))).toEqual([]);
    expect(parseCss2('@font-face {'.repeat(15_000))).toEqual([]);
    expect(parseCss2(`@font-face { src: url(${'a'.repeat(150_000)}) format('woff2') }`)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
    for (const v of [undefined, null, 7, {}, [], '']) expect(parseCss2(v)).toEqual([]);
  });
});

describe("reading a preview's stylesheet", () => {
  const KIT =
    'https://fonts.gstatic.com/l/font?kit=KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmWggvWl0Qn&skey=a0a0114a1dcab3ac&v=v50';
  const one = (src: string, extra = '') =>
    `@font-face {\n  font-family: 'Roboto';\n  font-style: normal;\n  font-weight: 400;\n  font-stretch: 100%;\n  font-display: swap;\n  src: ${src};\n${extra}}\n`;
  it('takes the one address: the cut-down file at fonts.gstatic.com, or a .woff2 there, whatever weight the block says', () => {
    expect(parsePreviewCss(one(`url(${KIT}) format('woff2')`))).toBe(KIT);
    expect(parsePreviewCss(one(`url("${KIT}") format("woff2")`))).toBe(KIT);
    expect(parsePreviewCss(one(`url(${KIT})`))).toBe(KIT); // no format named: the browser reads the bytes either way
    expect(
      parsePreviewCss(one(`url(${KIT}) format('woff2')`).replace('font-weight: 400', 'font-weight: 100 900')),
    ).toBe(KIT); // a variable family's range
    expect(parsePreviewCss(one(`url(${G}/roboto/v50/abc_D-e.woff2) format('woff2')`))).toBe(
      `${G}/roboto/v50/abc_D-e.woff2`,
    );
    // several blocks: the upright latin one
    const many =
      block({ subset: 'latin-ext', style: 'italic', url: `${G}/lato/v25/i.woff2`, range: LATIN_EXT }) +
      block({ subset: 'latin-ext', url: `${G}/lato/v25/e.woff2`, range: LATIN_EXT }) +
      block({ subset: 'latin', url: `${G}/lato/v25/l.woff2`, range: LATIN });
    expect(parsePreviewCss(many)).toBe(`${G}/lato/v25/l.woff2`);
  });
  it('takes nothing that is not at fonts.gstatic.com over https, or that could carry another address', () => {
    for (const bad of [
      'https://evil.invalid/l/font?kit=abc',
      'http://fonts.gstatic.com/l/font?kit=abc',
      '//fonts.gstatic.com/l/font?kit=abc',
      'https://fonts.gstatic.com.evil.invalid/l/font?kit=abc',
      'https://fonts.gstatic.com@evil.invalid/l/font?kit=abc',
      'https://fonts.gstatic.com/l/font?kit=abc&next=https://evil.invalid',
      'https://fonts.gstatic.com/l/font?kit=abc&v=1#x',
      'https://fonts.gstatic.com/l/font?kit=a/../../x',
      'https://fonts.gstatic.com/l/font',
      'https://fonts.gstatic.com/l/font?kit=',
      'https://fonts.gstatic.com/l/other?kit=abc',
      'https://fonts.gstatic.com/l/font?kit=abc&V=1',
      'https://fonts.gstatic.com/l/font?kit=a%0Ab',
      'https://fonts.gstatic.com/s/roboto/v50/a.ttf',
      'javascript:alert(1)',
      'data:font/woff2;base64,AAAA',
      'blob:https://fonts.gstatic.com/1',
    ])
      expect(parsePreviewCss(one(`url(${bad}) format('woff2')`)), bad).toBeNull();
    expect(
      parsePreviewCss(one(`url(${KIT}) format('woff2'), url(https://evil.invalid/a.woff2) format('woff2')`)),
    ).toBeNull();
    expect(
      parsePreviewCss(one(`url(${KIT}) format('woff2')`, '  src: url(https://evil.invalid/a) format("woff2");\n')),
    ).toBeNull();
    expect(parsePreviewCss(one(`local('Roboto'), url(${KIT}) format('woff2')`))).toBeNull();
    for (const extra of [
      '@import url("https://evil.invalid/x.css");',
      'body { color: red }',
      '<script>alert(1)</script>',
      '/* never closed',
    ])
      expect(parsePreviewCss(one(`url(${KIT}) format('woff2')`) + extra), extra).toBeNull();
    expect(parsePreviewCss(one(`url(${KIT}) format('woff2')`) + ' '.repeat(GOOGLE_CSS_MAX))).toBeNull();
    for (const v of [undefined, null, 7, {}, '', '   ']) expect(parsePreviewCss(v)).toBeNull();
    // a bad block beside a good one does not spoil the good one
    expect(
      parsePreviewCss(one(`url(https://evil.invalid/a.woff2) format('woff2')`) + one(`url(${KIT}) format('woff2')`)),
    ).toBe(KIT);
  });
  it("names a preview's face as nothing else is named", () => {
    expect(previewFaceName('Open Sans')).toBe('gfp Open Sans');
    expect(previewFaceName('Bad"; } x')).toBe('gfp Bad x');
  });
});

describe("a picked family as the project's font files", () => {
  const lato = fam('Lato');
  const picked = (role: 'title' | 'body' = 'title') =>
    googleFontFiles(role, lato, [
      { weight: 700, style: 'normal', dataUrl: OTHER },
      { weight: 400, style: 'normal', dataUrl: WOFF2 },
    ]);
  const attached: FontFile = { id: 'font_old', role: 'title', family: 'Invented Slab', dataUrl: WOFF2, embedOk: false };
  const project = (fontFiles: unknown, fonts = { title: '', body: '' }): Project => {
    const p = withPitch(applyDeal(sampleProject()));
    return { ...p, pitch: { ...p.pitch!, design: { ...defaultDesign(), fonts, fontFiles: fontFiles as FontFile[] } } };
  };

  it('each file says its weight, style, source and licence, may travel, and has an id made from the file', () => {
    const files = picked();
    expect(files.map(f => [f.family, f.role, f.weight, f.style, f.source, f.licence, f.embedOk])).toEqual([
      ['Lato', 'title', 400, 'normal', 'google', 'OFL', true],
      ['Lato', 'title', 700, 'normal', 'google', 'OFL', true],
    ]);
    expect(files[0].id).toMatch(/^gfont_title_400_[a-z0-9]+$/);
    expect(new Set(files.map(f => f.id)).size).toBe(2);
    expect(picked().map(f => f.id)).toEqual(files.map(f => f.id)); // the same file, the same id
    expect(picked('body').map(f => f.id)).not.toEqual(files.map(f => f.id)); // and never one a role shares with the other
    const variable = googleFontFiles('body', fam('Work Sans'), [
      { weight: [100, 900], style: 'italic', dataUrl: OTHER },
      { weight: [100, 900], style: 'normal', dataUrl: WOFF2 },
    ]);
    expect(variable.map(f => [f.weight, f.style])).toEqual([
      [[100, 900], 'normal'],
      [[100, 900], 'italic'],
    ]);
    expect(variable[1].id).toMatch(/^gfont_body_100-900i_/);
  });
  it('picking for a role puts the family in and takes out whatever the role had; the other role is left alone', () => {
    const body: FontFile = { id: 'font_b', role: 'body', family: 'Invented Sans', dataUrl: WOFF2, embedOk: true };
    const after = setRoleFonts([attached, body], 'title', picked());
    expect(after.map(f => f.id)).toEqual([...picked().map(f => f.id), 'font_b']);
    const again = setRoleFonts(
      after,
      'title',
      googleFontFiles('title', fam('Lora'), [{ weight: 400, style: 'normal', dataUrl: WOFF2 }]),
    );
    expect(again.map(f => f.family)).toEqual(['Lora', 'Invented Sans']); // the first family's files are all gone
    expect(setRoleFonts(after, 'body', picked('body')).map(f => `${f.role} ${f.family} ${f.weight}`)).toEqual([
      'title Lato 400',
      'title Lato 700',
      'body Lato 400',
      'body Lato 700',
    ]);
    expect(setRoleFonts(undefined, 'title', picked())).toEqual(picked());
    expect(setRoleFonts([attached], 'title', picked('body'))).toEqual([]); // files for another role are not put under this one
  });
  it("removing a role's font removes every file of the family", () => {
    const both = setRoleFonts(setRoleFonts([], 'title', picked()), 'body', picked('body'));
    expect(removeRoleFonts(both, 'title').map(f => f.role)).toEqual(['body', 'body']);
    expect(removeRoleFonts(removeRoleFonts(both, 'title'), 'body')).toEqual([]);
    expect(removeRoleFonts([attached], 'title')).toEqual([]);
    expect(removeRoleFonts('nonsense', 'title')).toEqual([]);
  });
  it("attaching a file of your own takes the picked family's place", () => {
    expect(setFontFile(picked(), attached)).toEqual([attached]);
  });
  it('says what a role holds: the family, where it came from, its weights and its size', () => {
    const files = setRoleFonts(
      [{ id: 'font_b', role: 'body', family: 'Invented Sans', dataUrl: WOFF2, embedOk: false }],
      'title',
      picked(),
    );
    expect(roleFont(files, 'title')).toMatchObject({
      family: 'Lato',
      google: true,
      licence: 'OFL',
      bytes: 20,
      missing: false,
      embedOk: true,
      weights: '400 and 700',
    });
    expect(roleFont(files, 'title')!.files).toHaveLength(2);
    expect(roleFont(files, 'body')).toMatchObject({
      family: 'Invented Sans',
      google: false,
      licence: '',
      bytes: 10,
      embedOk: false,
      weights: '',
    });
    expect(roleFont([], 'title')).toBeUndefined();
    expect(
      roleFont(
        picked().map(f => ({ ...f, dataUrl: `idb:font:${f.id}` })),
        'title',
      ),
    ).toMatchObject({ missing: true, bytes: 0 });
    expect(
      roleFont(
        googleFontFiles('body', fam('Work Sans'), [
          { weight: [100, 900], style: 'normal', dataUrl: WOFF2 },
          { weight: [100, 900], style: 'italic', dataUrl: OTHER },
        ]),
        'body',
      )!.weights,
    ).toBe('100 to 900 and italic');
  });

  it('reads several files for a role only when they are the weights of one family', () => {
    const files = picked();
    expect(readFontFiles(files)).toEqual(files);
    // an attached file is the whole face: a second file for its role is dropped, as it always was
    expect(
      readFontFiles([attached, { ...attached, id: 'font_two', family: 'Second' }, ...files]).map(f => f.id),
    ).toEqual(['font_old']);
    // weights of another family, the same weight twice, the same id twice, or a file that names no weight, do not join
    expect(
      readFontFiles([
        ...files,
        { ...files[1], id: 'x1', family: 'Lora' },
        { ...files[1], id: 'x2' },
        { ...files[0] },
        { id: 'x3', role: 'title', family: 'Lato', dataUrl: WOFF2, embedOk: true },
      ]).map(f => f.id),
    ).toEqual(files.map(f => f.id));
    expect(
      readFontFiles([
        { ...files[0], weight: 5000 },
        {
          ...files[1],
          weight: [900, 100] as [number, number],
          style: 'slanted' as 'italic',
          source: 'elsewhere' as 'google',
          licence: '<b>OFL</b>"; x',
        },
      ]),
    ).toEqual([
      { ...files[0], weight: 1000 },
      {
        id: files[1].id,
        role: 'title',
        family: 'Lato',
        dataUrl: OTHER,
        embedOk: true,
        weight: [100, 900],
        licence: 'bOFLb x',
      },
    ]);
  });
  it('an old project with one attached file reads exactly as it did: no weight, no style, nothing added', () => {
    const old = [
      { id: 'font_old', role: 'title', family: 'Invented Slab', dataUrl: WOFF2, embedOk: true },
      { id: 'font_b', role: 'body', family: 'Invented Sans', dataUrl: OTHER, embedOk: false },
    ];
    expect(readFontFiles(old)).toEqual(old);
    expect(Object.keys(readFontFiles(old)[0])).toEqual(['id', 'role', 'family', 'dataUrl', 'embedOk']);
    const p = project(old);
    expect(fontFacesOf(p, false)).toEqual([
      { family: 'Invented Slab', src: WOFF2, role: 'title' },
      { family: 'Invented Sans', src: OTHER, role: 'body' },
    ]);
    expect(fontFacesOf(p)).toEqual([{ family: 'Invented Slab', src: WOFF2, role: 'title' }]);
    expect(Object.keys(fontFacesOf(p)[0])).toEqual(['family', 'src', 'role']);
    expect(deckData(p).version).toBe(1);
    expect(sendSummary(p).inside[0]).toBe('Invented Slab (your title font file)');
    expect(sendSummary(p).leftOut).toEqual(['Invented Sans (your body font file)']);
    expect(fontsLeftOut(p)).toEqual([{ family: 'Invented Sans', role: 'body' }]);
  });
  it('the deck carries each weight with its weight and style, in both the preview and a file that is sent', () => {
    const body = googleFontFiles('body', fam('Work Sans'), [
      { weight: [100, 900], style: 'normal', dataUrl: WOFF2 },
      { weight: [100, 900], style: 'italic', dataUrl: OTHER },
    ]);
    const p = project([...picked(), ...body], { title: 'Lato', body: 'Work Sans' });
    const faces = deckData(p).theme.fontFaces;
    expect(faces).toEqual([
      { family: 'Lato', src: WOFF2, role: 'title', weight: 400, style: 'normal' },
      { family: 'Lato', src: OTHER, role: 'title', weight: 700, style: 'normal' },
      { family: 'Work Sans', src: WOFF2, role: 'body', weight: [100, 900], style: 'normal' },
      { family: 'Work Sans', src: OTHER, role: 'body', weight: [100, 900], style: 'italic' },
    ]);
    expect(deckData(p, { fonts: 'all' }).theme.fontFaces).toEqual(faces);
    expect(deckData(p).theme.fonts).toEqual({ title: 'Lato', body: 'Work Sans' });
    expect(JSON.stringify(deckData(p))).not.toMatch(/google|gstatic|https?:/i); // where a font came from is not the deck's business
  });
  it('the Send panel names the family once, and says it came from Google Fonts', () => {
    const p = project(
      [...picked(), { id: 'font_b', role: 'body', family: 'Invented Sans', dataUrl: WOFF2, embedOk: false }],
      { title: 'Lato', body: '' },
    );
    const s = sendSummary(p);
    expect(s.inside[0]).toBe('Lato (your title font, from Google Fonts)');
    expect(s.inside.filter(x => x.startsWith('Lato'))).toHaveLength(1);
    expect(s.leftOut).toEqual(['Invented Sans (your body font file)']);
    expect(fontsLeftOut(project(picked()))).toEqual([]);
  });
  it('more faces than a deck holds are cut off at eight', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      weight: (i + 1) * 100,
      style: 'normal' as const,
      dataUrl: WOFF2,
    }));
    const italics = many.map(m => ({ ...m, style: 'italic' as const }));
    expect(
      fontFacesOf(project([...googleFontFiles('title', lato, many), ...googleFontFiles('body', lato, italics)])),
    ).toHaveLength(8);
  });
});
