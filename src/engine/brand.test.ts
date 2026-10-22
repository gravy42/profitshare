import { describe, it, expect } from 'vitest';
import { parseBrandText, applyBrand, namedColors } from './brand';
import { defaultDesign } from './pitch';

const DOC = `
Alone Girl Universe
The film at the center. Everything else leads back to it.
BRAND SYSTEM · V1 · OCTOBER 2026
OUT TO LUNCH ENTERTAINMENT

COLOUR, NIGHT:
Night is the first theme and the film's own: midnight ground, periwinkle text.
#092827 surface
Page and slide ground.
#253730 surface-raised
#91A9D9 ink
Body copy and headings on surface.
#F4EDDC ink-bright
#8C9FC2 ink-muted
#F2B705 accent
#092827 on-accent
#D27C0E signal
#3D697A line
#F4EDDC card

COLOUR, DAY:
Day is the website, Substack and anything printed.
#F4EDDC surface
#FBF7EC surface-raised
#092827 ink
#000000 ink-bright
#3D697A ink-muted
#F2B705 accent
#A2130B signal
#D8CDB5 line

TYPOGRAPHY:
Peckham Press · the loud word. Adler · the film's voice. The wordmark, taglines.
Gravy · the connector. Work Sans · everything that has to be read: paragraphs, bios, captions.
`;

describe('reading a brand system', () => {
  it('names colours by the role beside them, splits night from day, finds the faces and the name', () => {
    const b = parseBrandText(DOC, 'fallback');
    expect(b.name).toBe('Alone Girl Universe');
    expect(b.night).toMatchObject({ bg: '#092827', ink: '#91A9D9', accent: '#F2B705', accent2: '#D27C0E', muted: '#8C9FC2', line: '#3D697A', inkBright: '#F4EDDC', card: '#F4EDDC' });
    expect(b.day).toMatchObject({ bg: '#F4EDDC', ink: '#092827', accent2: '#A2130B', muted: '#3D697A', line: '#D8CDB5' });
    expect(b.colors.bg).toBe('#092827');                 // the deck takes night
    expect(b.fonts).toEqual({ title: 'Adler', body: 'Work Sans' });
    expect(b.faces).toContain('Peckham Press');
    expect(b.swatches.length).toBeGreaterThan(15);
  });
  it('labels on the line after the hex and a single-theme document work too; the darkest and lightest stand in for missing roles', () => {
    const b = parseBrandText('Palette\n#111111\nnavy\n#EEEEEE\nchalk\n#FF6B35\norange', 'x');
    expect(namedColors(['#111111', 'navy'])[0]).toMatchObject({ name: 'navy', hex: '#111111' });
    expect(b.colors.bg).toBe('#111111'); expect(b.colors.ink).toBe('#EEEEEE');
    expect(b.night).toBeUndefined();
  });
  it('applies to a design without trampling what the person set', () => {
    const d = { ...defaultDesign(), name: 'Mine', colors: { ...defaultDesign().colors, muted: '#123456' } };
    const out = applyBrand(d, parseBrandText(DOC));
    expect(out.name).toBe('Mine');
    expect(out.colors.bg).toBe('#092827'); expect(out.colors.muted).toBe('#8C9FC2');   // the document names a muted, so it wins
    expect(out.colors.accent2).toBe('#F4EDDC');                                        // ink-bright over signal for the second accent
    expect(out.fonts.title).toMatch(/^"Adler"/); expect(out.line).toBe('#3D697A');
  });
});

describe('slide rules in words', () => {
  it('reads split layout, the bleed, eyebrows and the sign-off', async () => {
    const { deckRulesFromText } = await import('./brand');
    const r = deckRulesFromText('DECKSLIDE · SPLIT LAYOUT, ALWAYS NIGHT. Photo bleeds 50 to 60%, text column right with a 48px outer margin. One eyebrow per slide; the slide\'s first word is the eyebrow. The sign-off tag, from the world of ALONE GIRL, goes on anything that is not already the film.');
    expect(r).toMatchObject({ layout: 'split', eyebrow: true, bleed: 0.55, signoff: 'from the world of ALONE GIRL' });
    expect(deckRulesFromText('Colours and type only.')).toEqual({});
  });
});
