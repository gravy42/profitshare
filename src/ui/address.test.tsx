// @vitest-environment jsdom
// Addresses out of a project file: a link only ever goes to the web, and a logo is only ever a picture carried in the
// file. The comps table and the call sheet are drawn from a file written to do harm, and nothing in the page obeys it.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sampleProject } from '../data/seed';
import { applyDeal } from '../engine/deal';
import { buildSheet, withCallSheets } from '../engine/callsheet';
import { defaultDesign, newComp, withPitch } from '../engine/pitch';
import type { PitchDesign, Project } from '../engine/types';
import { isEmbeddedImage, webLink } from './address';
import { CallSheetPage } from './CallSheetsView';
import { DesignPanel } from './PitchExtras';
import { PitchView } from './PitchView';

describe('webLink: is this a web address the page will link to', () => {
  it('takes http and https, in any case, with spaces around', () => {
    expect(webLink('https://films.example/salt-flat')).toBe('https://films.example/salt-flat');
    expect(webLink('http://films.example/a?b=1#c')).toBe('http://films.example/a?b=1#c');
    expect(webLink('HTTPS://Films.Example/Path')).toBe('https://films.example/Path');
    expect(webLink('hTtP://films.example')).toBe('http://films.example/');
    expect(webLink('  https://films.example/x \n')).toBe('https://films.example/x');
  });
  it.each([
    ['javascript:', 'javascript:alert(1)'], ['javascript:, mixed case', 'JaVaScRiPt:alert(1)'], ['javascript:, spaces before', '   javascript:alert(1)'],
    ['javascript:, a tab inside the scheme', 'java\tscript:alert(1)'], ['javascript:, a line break inside', 'java\nscript:alert(1)'],
    ['javascript: with slashes', 'javascript://films.example/%0Aalert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'], ['vbscript:', 'vbscript:msgbox(1)'], ['file:', 'file:///etc/passwd'],
    ['blob:', 'blob:https://films.example/1234'], ['mailto:', 'mailto:someone@films.example'], ['ftp:', 'ftp://films.example/x'],
    ['an address with no scheme', '//films.example/x'], ['a path', '/budget/top'], ['a relative path', 'notes/comps.html'], ['a bare name', 'films.example'],
    ['a fragment', '#top'], ['nothing', ''], ['only spaces', '   '], ['a scheme and nothing else', 'https://'],
  ])('refuses %s', (_what, value) => { expect(webLink(value)).toBeNull(); });
  it.each([[null], [undefined], [7], [true], [{}], [[]], [{ href: 'https://films.example' }], [['https://films.example']], [new URL('https://films.example')]])('refuses what is not text: %j', value => {
    expect(webLink(value)).toBeNull();
  });
});

describe('isEmbeddedImage: a picture carried in the file', () => {
  it('takes a data:image address and nothing else', () => {
    expect(isEmbeddedImage('data:image/png;base64,AAAA')).toBe(true);
    expect(isEmbeddedImage('data:image/svg+xml,<svg/>')).toBe(true);
    for (const v of ['https://tracker.example/pixel.gif', '//tracker.example/p.gif', 'http://tracker.example/p.png', '/p.png', 'p.png', 'data:text/html,<p>', 'blob:https://x.example/1', ' data:image/png;base64,AAAA', 'javascript:alert(1)', '', null, undefined, 5, {}, ['data:image/png;base64,AAAA']]) expect(isEmbeddedImage(v)).toBe(false);
  });
});

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let box: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; });
function draw(node: React.ReactNode): HTMLElement {
  box = document.createElement('div'); document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(node); });
  return box;
}
const base = (): Project => withPitch(applyDeal(sampleProject()));
const PIXEL = 'https://tracker.example/pixel.gif';
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

describe('the comps table drawn from a hostile file', () => {
  const hostile = ['javascript:alert(document.domain)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', '//tracker.example/x', '/somewhere'];
  const withSources = (sources: string[]): Project => {
    const p = base();
    return { ...p, pitch: { ...p.pitch!, comps: sources.map((source, i) => ({ ...newComp(), id: `c${i}`, title: `Invented Film ${i + 1}`, source })) } };
  };
  it('makes no link out of any of them, and still shows what was typed', () => {
    const el = draw(<PitchView project={withSources(hostile)} setProject={() => undefined} />);
    const rows = [...el.querySelectorAll('tr')].filter(tr => tr.querySelector<HTMLInputElement>('input[placeholder="url"]'));
    expect(rows).toHaveLength(hostile.length);
    rows.forEach((tr, i) => {
      expect(tr.querySelector('a')).toBeNull();
      expect(tr.querySelector<HTMLInputElement>('input[placeholder="url"]')!.value).toBe(hostile[i]);   // plain text in its field, to be read and fixed
    });
    for (const a of el.querySelectorAll('a')) {
      const href = a.getAttribute('href') ?? '';
      expect(hostile).not.toContain(href);
      expect(href).toMatch(/^(https?:\/\/|#)/);
      expect(href.toLowerCase()).not.toMatch(/^\s*(javascript|data|vbscript|file):/);
    }
  });
  it('links a web address, in a new tab that cannot reach back', () => {
    const el = draw(<PitchView project={withSources(['  https://numbers.example/invented-film ', 'HTTP://Numbers.Example/two'])} setProject={() => undefined} />);
    const links = [...el.querySelectorAll('tr')].filter(tr => tr.querySelector('input[placeholder="url"]')).map(tr => tr.querySelector('a')!);
    expect(links.map(a => a.getAttribute('href'))).toEqual(['https://numbers.example/invented-film', 'http://numbers.example/two']);
    for (const a of links) { expect(a.target).toBe('_blank'); expect(a.rel).toContain('noopener'); expect(a.rel).toContain('noreferrer'); }
  });
});

describe('the logo and colours of a design system from a hostile file', () => {
  const sheet = () => buildSheet(withCallSheets(base()), 1)!;
  const design = (over: Partial<PitchDesign>): PitchDesign => ({ ...defaultDesign(), ...over });
  const urls = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[style]')].map(e => e.getAttribute('style') ?? '').join('\n');

  it('the call sheet draws an embedded logo', () => {
    const el = draw(<CallSheetPage s={sheet()} design={design({ logoDataUrl: LOGO })} />);
    expect(el.querySelector('img.logo')!.getAttribute('src')).toBe(LOGO);
  });
  it.each([[PIXEL], ['//tracker.example/pixel.gif'], ['http://tracker.example/p.png'], ['/pixel.gif'], ['javascript:alert(1)'], ['data:text/html,<p>'], [7], [{}], [null]])('the call sheet draws no picture for a logo of %j', logo => {
    const el = draw(<CallSheetPage s={sheet()} design={design({ logoDataUrl: logo as unknown as string })} />);
    expect(el.querySelector('img')).toBeNull();
    expect(el.innerHTML).not.toContain('tracker.example');
  });
  it('the design box draws no picture for a logo at a web address', () => {
    const p = base();
    const el = draw(<DesignPanel project={{ ...p, pitch: { ...p.pitch!, design: design({ logoDataUrl: PIXEL }) } }} setPitch={() => undefined} />);
    expect(el.querySelector(`img[src="${PIXEL}"]`)).toBeNull();
    expect(el.querySelector('.swatch img')).toBeNull();
  });
  it('a colour that names a file never reaches the call sheet\'s styles; a plain colour does', () => {
    const bad = `url(${PIXEL})`;
    const el = draw(<CallSheetPage s={sheet()} design={design({ colors: { bg: bad, ink: `#fff url("${PIXEL}")`, accent: `image-set("${PIXEL}" 1x)`, accent2: '#123456', muted: '#654321' } })} />);
    expect(urls(el)).not.toContain('tracker.example');
    expect(urls(el)).not.toMatch(/url\(/i);
    const ok = draw(<CallSheetPage s={sheet()} design={design({ colors: { bg: '#102030', ink: ' #fefefe ', accent: 'rgb(200, 150, 40)', accent2: '#123456', muted: '#654321' } })} />);
    const front = ok.querySelector<HTMLElement>('.callsheet.front')!;
    expect(front.style.getPropertyValue('--cs-bg')).toBe('#102030');
    expect(front.style.getPropertyValue('--cs-ink')).toBe('#fefefe');
    expect(front.style.getPropertyValue('--cs-accent')).toBe('rgb(200, 150, 40)');
  });
});
