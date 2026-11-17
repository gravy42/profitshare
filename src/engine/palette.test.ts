import { describe, it, expect } from 'vitest';
import { DARK_INK, cardInkFor } from './deckData';
import { MIN_CARD_EDGE, MIN_CARD_TEXT, MIN_INK, MIN_TEXT, TYPE_PAIRINGS, checkTheme, colourless, contrast, fromHsl, hexOf, luminanceOf, mixHex, proposeThemes, quantize, reach, rgbOf, textSurfaces, toHsl } from './palette';
import type { RGB, ThemeColors } from './palette';
import { deckColors, mixColors } from '../deck-runtime/runtime';

// Invented pictures, as pixels. Nothing here was sampled from a real image.
const fill = (c: RGB, n: number): RGB[] => Array.from({ length: n }, () => [...c] as RGB);
const desert = (): RGB[] => [...fill([214, 186, 140], 400), ...fill([168, 82, 40], 180), ...fill([92, 150, 196], 160), ...fill([28, 24, 30], 200), ...fill([240, 232, 214], 60)];
const grey = (): RGB[] => Array.from({ length: 256 }, (_, i) => [i, i, i] as RGB);
const neon = (): RGB[] => [...fill([255, 0, 200], 300), ...fill([0, 255, 120], 300), ...fill([255, 240, 0], 300)];
/** A fixed shuffle: no dice in a test either. */
const shuffled = <T,>(xs: T[]): T[] => { const a = xs.slice(); let seed = 12345; for (let i = a.length - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) % 2147483648; const j = seed % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

describe('colour arithmetic', () => {
  it('reads and writes hex', () => {
    expect(rgbOf('#fff')).toEqual([255, 255, 255]);
    expect(rgbOf('1b1608')).toEqual([27, 22, 8]);
    expect(rgbOf('red')).toBeNull();
    expect(rgbOf('#12345')).toBeNull();
    expect(hexOf([255, 0.4, 300])).toBe('#ff00ff');
  });
  it('gives the WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);   // the well-known lightest grey that passes on white
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
    expect(contrast('nope', '#ffffff')).toBe(0);
    expect(luminanceOf([0, 0, 0])).toBe(0);
    expect(luminanceOf([255, 255, 255])).toBeCloseTo(1, 5);
  });
  it('goes to hue, saturation, lightness and back', () => {
    for (const c of [[214, 186, 140], [0, 0, 0], [255, 255, 255], [12, 200, 77], [128, 128, 128], [255, 0, 200]] as RGB[]) {
      const [h, s, l] = toHsl(c); const back = fromHsl(h, s, l);
      back.forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThanOrEqual(1));
    }
    expect(toHsl([255, 0, 0])[0]).toBe(0);
    expect(toHsl([0, 0, 255])[0]).toBe(240);
  });
  it('moves a colour only as far as it takes to be read, and keeps its hue', () => {
    expect(reach('#ffffff', '#000000', 7)).toBe('#ffffff');   // already passes: untouched
    const up = reach('#a85228', '#101014', 4.5);
    expect(contrast(up, '#101014')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(up, '#101014')).toBeLessThan(5.2);        // no further than needed
    expect(Math.abs(toHsl(rgbOf(up)!)[0] - toHsl([168, 82, 40])[0])).toBeLessThan(4);
    const down = reach('#5c96c4', '#f4eddc', 4.5);
    expect(contrast(down, '#f4eddc')).toBeGreaterThanOrEqual(4.5);
    expect(luminanceOf(rgbOf(down)!)).toBeLessThan(luminanceOf([92, 150, 196]));
    expect(reach('#808080', '#808080', 7)).toBe('#000000');   // nothing on that grey reaches 7:1: the far end, black
    expect(reach('nope', '#000000', 7)).toBe('nope');
    expect(reach('#FFF', '#000000', 7)).toBe('#ffffff');        // always six digits, lower case
    // several surfaces: the worst of them counts
    const both = reach('#808080', ['#000000', '#303030'], 4.5);
    expect(contrast(both, '#303030')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(reach('#808080', '#000000', 4.5), '#303030')).toBeLessThan(4.5);
    // a mid surface where the first way cannot get there: it goes the other way instead of giving up
    const mid = reach('#6a6a6a', '#707070', 4.4);
    expect(contrast(mid, '#707070')).toBeGreaterThanOrEqual(4.4);
    expect(mid).not.toBe('#ffffff');
  });
  it('mixes colours the way the deck does', () => {
    for (const [a, b, t] of [['#101014', '#f0f0e8', 0.07], ['#ffffff', '#000000', 0.5], ['#a85228', '#5c96c4', 0.42]] as [string, string, number][]) expect(mixHex(a, b, t)).toBe(mixColors(a, b, t));
    expect(textSurfaces('#ffffff', '#000000')).toEqual(['#ffffff', mixColors('#ffffff', '#000000', 0.07)]);
    expect(mixHex('nope', '#000000', 0.5)).toBe('nope');
  });
});

describe('quantize (median cut)', () => {
  it('finds the colours of a flat picture, the most common first, with their shares', () => {
    const sw = quantize([...fill([200, 30, 30], 30), ...fill([20, 20, 160], 70)], 8);
    expect(sw.map(s => s.hex)).toEqual(['#1414a0', '#c81e1e']);
    expect(sw.map(s => s.count)).toEqual([70, 30]);
    expect(sw[0].share).toBeCloseTo(0.7, 5);
  });
  it('never returns more than it was asked for, and what it returns adds up to the picture', () => {
    const sw = quantize(grey(), 5);
    expect(sw).toHaveLength(5);
    expect(sw.reduce((n, s) => n + s.count, 0)).toBe(256);
    expect(sw.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1, 5);
    for (let i = 1; i < sw.length; i++) expect(sw[i - 1].count).toBeGreaterThanOrEqual(sw[i].count);
    expect(quantize(desert(), 3)).toHaveLength(3);
    expect(quantize(fill([9, 9, 9], 50), 8)).toHaveLength(1);   // one flat colour is one swatch
  });
  it('is deterministic: the same pixels, in any order, give the same swatches', () => {
    const a = quantize(desert(), 8), b = quantize(desert(), 8), c = quantize(shuffled(desert()), 8), d = quantize(shuffled(grey()), 6);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(d).toEqual(quantize(grey(), 6));
  });
  it('skips what is not a pixel and reads nothing as nothing', () => {
    expect(quantize([])).toEqual([]);
    expect(quantize(null as unknown as RGB[])).toEqual([]);
    const sw = quantize([[10, 10, 10], [NaN, 0, 0], 'x' as unknown as RGB, [300, -5, 10.6]] as RGB[], 4);
    expect(sw.reduce((n, s) => n + s.count, 0)).toBe(2);
    expect(sw.map(s => s.hex).sort()).toEqual(['#0a0a0a', '#ff000b']);
  });
  it('samples a very large picture down without changing its balance', () => {
    const sw = quantize([...fill([250, 250, 250], 60000), ...fill([5, 5, 5], 20000)], 4);
    expect(sw[0].hex).toBe('#fafafa');
    expect(sw[0].share).toBeCloseTo(0.75, 2);
  });
});

describe('proposeThemes', () => {
  const pictures: [string, RGB[]][] = [['desert', desert()], ['greys', grey()], ['neon', neon()], ['all white', fill([255, 255, 255], 100)], ['all black', fill([0, 0, 0], 100)], ['one mid colour', fill([120, 90, 160], 100)], ['pastel', [...fill([250, 220, 230], 200), ...fill([220, 240, 250], 200)]]];
  const passes = (c: ThemeColors) => {
    for (const v of Object.values(c)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    const on = textSurfaces(c.bg, c.ink);
    expect(contrast(c.ink, c.bg)).toBeGreaterThanOrEqual(MIN_INK);
    for (const k of ['accent', 'accent2', 'muted'] as const) for (const s of on) expect(contrast(c[k], s)).toBeGreaterThanOrEqual(MIN_TEXT);
    expect(contrast(cardInkFor(c.card), c.card)).toBeGreaterThanOrEqual(MIN_CARD_TEXT);
    expect(contrast(c.card, c.bg)).toBeGreaterThanOrEqual(MIN_CARD_EDGE);
    expect(checkTheme(c).every(r => r.pass && r.fix === '')).toBe(true);
  };
  it.each(pictures)('every proposal from %s passes every rule', (_name, px) => {
    const proposals = proposeThemes(quantize(px, 8));
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals.length).toBeLessThanOrEqual(3);
    for (const p of proposals) passes(p.colors);
  });
  it('names them for their character: Night, Paper and Dusk', () => {
    const [night, paper, dusk] = proposeThemes(quantize(desert(), 8));
    expect([night.id, paper.id, dusk.id]).toEqual(['night', 'paper', 'dusk']);
    expect([night.label, paper.label, dusk.label]).toEqual(['Night', 'Paper', 'Dusk']);
    expect(luminanceOf(rgbOf(night.colors.bg)!)).toBeLessThanOrEqual(0.03);
    expect(luminanceOf(rgbOf(paper.colors.bg)!)).toBeGreaterThanOrEqual(0.8);
    expect(luminanceOf(rgbOf(night.colors.ink)!)).toBeGreaterThan(0.7);
    expect(luminanceOf(rgbOf(paper.colors.ink)!)).toBeLessThan(0.05);
  });
  it('the card is paper with dark ink on every ground; on a light ground it is lighter than the ground, with an edge to see', () => {
    for (const [, px] of pictures) for (const p of proposeThemes(quantize(px, 8))) {
      expect(cardInkFor(p.colors.card)).toBe(DARK_INK);
      expect(luminanceOf(rgbOf(p.colors.card)!)).toBeGreaterThan(0.6);
      expect(p.colors.card).not.toBe(p.colors.bg);
    }
    const paper = proposeThemes(quantize(desert(), 8))[1].colors;
    expect(luminanceOf(rgbOf(paper.card)!)).toBeGreaterThan(luminanceOf(rgbOf(paper.bg)!));
    // a ground that is already white cannot have a lighter card: the card is a shade warmer and deeper instead
    const white = proposeThemes(quantize(fill([255, 255, 255], 100), 8))[1].colors;
    expect(white.bg).toBe('#ffffff');
    const [r, , b] = rgbOf(white.card)!;
    expect(r).toBeGreaterThan(b);
    expect(contrast(white.card, white.bg)).toBeGreaterThanOrEqual(MIN_CARD_EDGE);
  });
  it('takes the night and paper grounds from the dominant swatches: the darkest of them, and the lightest', () => {
    // a little pure black and pure white, far too little to be dominant: the grounds keep the tint of the big areas
    const px = [...fill([40, 30, 70], 500), ...fill([225, 205, 170], 500), ...fill([180, 60, 60], 300), ...fill([0, 0, 0], 4), ...fill([255, 255, 255], 4)];
    const [night, paper] = proposeThemes(quantize(px, 8));
    expect(Math.abs(toHsl(rgbOf(night.colors.bg)!)[0] - toHsl([40, 30, 70])[0])).toBeLessThan(10);
    expect(Math.abs(toHsl(rgbOf(paper.colors.bg)!)[0] - toHsl([225, 205, 170])[0])).toBeLessThan(10);
  });
  it('Dusk is a different ground: a deeper tint of the second most common colour', () => {
    // sand is the most common, rust second: night comes from the shadow, dusk from the rust
    const px = [...fill([214, 186, 140], 400), ...fill([168, 82, 40], 300), ...fill([28, 24, 30], 200), ...fill([92, 150, 196], 100)];
    const [night, paper, dusk] = proposeThemes(quantize(px, 4));
    const lum = (hex: string) => luminanceOf(rgbOf(hex)!);
    expect(dusk.colors.bg).not.toBe(night.colors.bg);
    expect(dusk.colors.bg).not.toBe(paper.colors.bg);
    expect(lum(dusk.colors.bg)).toBeGreaterThan(lum(night.colors.bg));
    expect(lum(dusk.colors.bg)).toBeLessThanOrEqual(0.07);
    expect(contrast(dusk.colors.bg, night.colors.bg)).toBeGreaterThan(1.1);
    expect(Math.abs(toHsl(rgbOf(dusk.colors.bg)!)[0] - toHsl([168, 82, 40])[0])).toBeLessThan(10);
    // a light second colour gives a toned paper, darker than Paper
    const pale = proposeThemes(quantize([...fill([20, 30, 60], 500), ...fill([200, 215, 235], 400), ...fill([250, 250, 250], 300)], 3));
    expect(pale[2].id).toBe('dusk');
    expect(lum(pale[2].colors.bg)).toBeGreaterThan(0.6);
    expect(lum(pale[2].colors.bg)).toBeLessThan(lum(pale[1].colors.bg));
    // when night already took the second most common colour, dusk takes the most common
    const flipped = proposeThemes(quantize([...fill([210, 190, 150], 500), ...fill([20, 30, 60], 400)], 2));
    expect(Math.abs(toHsl(rgbOf(flipped[2].colors.bg)!)[0] - toHsl([210, 190, 150])[0])).toBeLessThan(10);
  });
  it('a ground is never more than lightly saturated, however loud the picture', () => {
    const chroma = (hex: string) => { const c = rgbOf(hex)!; return (Math.max(...c) - Math.min(...c)) / 255; };
    const loud: RGB[][] = [neon(), fill([150, 0, 255], 200), [...fill([255, 0, 0], 100), ...fill([0, 0, 255], 100)], fill([255, 255, 0], 50)];
    for (const px of loud) {
      const [night, paper] = proposeThemes(quantize(px, 8));
      expect(chroma(night.colors.bg)).toBeLessThan(0.12);       // near black
      expect(luminanceOf(rgbOf(night.colors.bg)!)).toBeLessThanOrEqual(0.03);
      expect(chroma(paper.colors.bg)).toBeLessThan(0.16);       // near white
      expect(toHsl(rgbOf(paper.colors.bg)!)[1]).toBeLessThanOrEqual(0.33);
      expect(toHsl(rgbOf(night.colors.bg)!)[1]).toBeLessThanOrEqual(0.38);
    }
  });
  it('makes the most colourful swatch the accent and the next distinct hue the second accent', () => {
    const [night] = proposeThemes(quantize(desert(), 8));
    const hue = (hex: string) => toHsl(rgbOf(hex)!)[0];
    expect(Math.abs(hue(night.colors.accent) - toHsl([168, 82, 40])[0])).toBeLessThan(6);
    expect(Math.abs(hue(night.colors.accent2) - toHsl([92, 150, 196])[0])).toBeLessThan(6);
    expect(night.suggestedAccent).toBeUndefined();
  });
  it('a picture with one colour gets two proposals, and a second accent between the accent and the ink', () => {
    const proposals = proposeThemes(quantize(fill([120, 90, 160], 100), 8));
    expect(proposals.map(p => p.id)).toEqual(['night', 'paper']);
    expect(proposals[0].colors.accent2).not.toBe(proposals[0].colors.accent);
  });
  it('pictures with almost no colour say so, and get one warm accent of ours beside a quiet neutral', () => {
    for (const px of [grey(), fill([255, 255, 255], 100), fill([0, 0, 0], 100), [...fill([40, 42, 44], 100), ...fill([200, 198, 196], 100)]]) {
      const sw = quantize(px, 8);
      expect(colourless(sw)).toBe(true);
      for (const p of proposeThemes(sw)) {
        expect(p.suggestedAccent).toBe(true);
        const [h, s] = toHsl(rgbOf(p.colors.accent)!);
        expect(h).toBeGreaterThan(15); expect(h).toBeLessThan(50);    // warm: amber
        expect(s).toBeGreaterThan(0.5);
        expect(toHsl(rgbOf(p.colors.accent2)!)[1]).toBeLessThan(0.25);  // the second accent is the neutral, not another amber
        expect(p.colors.accent2).not.toBe(p.colors.accent);
        expect(p.colors.accent2).not.toBe(p.colors.muted);
      }
    }
    expect(colourless(quantize(desert(), 8))).toBe(false);
    expect(colourless([])).toBe(false);
    // a speck of colour (under a hundredth of the picture) does not count
    expect(colourless(quantize([...grey(), ...grey(), ...grey(), ...grey(), [255, 0, 0]], 8))).toBe(true);
  });
  it('is deterministic, and has nothing to say about no swatches', () => {
    expect(proposeThemes(quantize(shuffled(desert()), 8))).toEqual(proposeThemes(quantize(desert(), 8)));
    expect(proposeThemes([])).toEqual([]);
    expect(proposeThemes(null as never)).toEqual([]);
  });
  it('for 300 seeded pictures the deck draws every text colour exactly as proposed', () => {
    let seed = 20261116;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let checked = 0;
    for (let n = 0; n < 300; n++) {
      const colours = 1 + Math.floor(rnd() * 6);
      const px: RGB[] = [];
      for (let k = 0; k < colours; k++) {
        const base: RGB = n % 7 === 0 ? (v => [v, v, v] as RGB)(Math.floor(rnd() * 256)) : [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)];
        const count = 5 + Math.floor(rnd() * 200), noise = Math.floor(rnd() * 30);
        for (let i = 0; i < count; i++) px.push(base.map(v => Math.max(0, Math.min(255, v + Math.floor((rnd() - 0.5) * noise)))) as RGB);
      }
      for (const p of proposeThemes(quantize(px, 8))) {
        const c = p.colors;
        passes(c);
        const drawn = deckColors({ ...c, cardInk: cardInkFor(c.card), line: c.muted });
        expect(drawn['--psd-ink']).toBe(c.ink);
        expect(drawn['--psd-accent-text']).toBe(c.accent);
        expect(drawn['--psd-accent2-text']).toBe(c.accent2);
        expect(drawn['--psd-muted-text']).toBe(c.muted);
        expect(drawn['--psd-card-ink']).toBe(cardInkFor(c.card));
        expect(drawn['--psd-bg']).toBe(c.bg);
        expect(drawn['--psd-card']).toBe(c.card);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(600);
  });
});

describe('checkTheme', () => {
  it('names each colour that fails, with the ratio it reaches, the one it needs and which way to move it', () => {
    const rows = checkTheme({ bg: '#ffffff', ink: '#777777', accent: '#ffff00', accent2: '#000000', muted: '#6b6b6b', card: '#808080' });
    const by = Object.fromEntries(rows.map(r => [r.key, r]));
    expect(by.ink.pass).toBe(false); expect(by.ink.min).toBe(7); expect(by.ink.ratio).toBeCloseTo(4.48, 1); expect(by.ink.fix).toBe('darker');
    expect(by.accent.pass).toBe(false); expect(by.accent.fix).toBe('darker');
    expect(by.accent2.pass).toBe(true); expect(by.accent2.fix).toBe('');
    expect(by.muted.pass).toBe(true);
    expect(by.card.pass).toBe(false);    // no ink reaches 7:1 on a mid grey
    expect(by.bg.pass).toBe(true);       // the card stands out from the white ground
    expect(rows.every(r => r.label && r.on)).toBe(true);
    const night = checkTheme({ bg: '#101014', ink: '#f0f0f0', accent: '#402010', accent2: '#f0c040', muted: '#808088', card: '#101418' });
    expect(night.find(r => r.key === 'accent')!.fix).toBe('lighter');
    expect(night.find(r => r.key === 'bg')!.pass).toBe(false);   // a card the same as the ground has no edge
  });
  it('measures text on the faint panels too, as the deck does: a colour that only just passes on the page fails', () => {
    // #767676 is 4.54:1 on white, and under 4.5:1 on the panel (white with 7% of the ink mixed in)
    const rows = checkTheme({ bg: '#ffffff', ink: '#000000', accent: '#767676', accent2: '#595959', muted: '#595959', card: '#f4f0e6' });
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(rows.find(r => r.key === 'accent')!.pass).toBe(false);
    expect(deckColors({ bg: '#ffffff', ink: '#000000', accent: '#767676', accent2: '#595959', muted: '#595959', card: '#f4f0e6' })['--psd-accent-text']).not.toBe('#767676');   // and the deck would move it
    expect(rows.find(r => r.key === 'accent2')!.pass).toBe(true);
  });
  it('says nothing passes for something that is not a colour', () => {
    const rows = checkTheme({ bg: '#ffffff', ink: '#000000', accent: 'url(x)', accent2: '', muted: '#595959', card: 'nope' });
    expect(rows.find(r => r.key === 'accent')!.pass).toBe(false);
    expect(rows.find(r => r.key === 'accent2')!.ratio).toBe(0);
  });
});

describe('type pairings', () => {
  it('use only the bundled faces and stacks every machine has: nothing from the network', () => {
    expect(TYPE_PAIRINGS.length).toBeGreaterThanOrEqual(4);
    for (const p of TYPE_PAIRINGS) {
      for (const stack of [p.title, p.body]) {
        expect(stack).not.toMatch(/url|http|@import|var\(/i);
        expect(stack).toMatch(/(serif|monospace)$/);
        expect(stack).toMatch(/^[A-Za-z0-9 ,"-]+$/);
      }
    }
    expect(new Set(TYPE_PAIRINGS.map(p => p.id)).size).toBe(TYPE_PAIRINGS.length);
  });
});
