// @vitest-environment node
// The file that is sent: one page, nobody in it but the person it is for, nothing in it that reaches the network,
// and no text an author typed that can become markup. Only the invented sample film and people.
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { runtimeJs, runtimeCss } from 'virtual:deck-runtime';
import { sampleProject } from '../data/seed';
import { applyDeal } from '../engine/deal';
import { deckData } from '../engine/deckData';
import { withPitch } from '../engine/pitch';
import type { FontFile, Pitch, Project, Recipient, SlideSpec } from '../engine/types';
import type { DeckData } from './data';
import {
  base64,
  BUNDLED_FAMILIES,
  bundledFacesNeeded,
  bundledFamilyOf,
  hasCards,
  dataFor,
  deckHtml,
  deckTitle,
  escapeHtml,
  fontFaceCss,
  needsLatinExt,
  safeJson,
  safeScript,
  sha256,
  utf8,
  LATIN_RANGE,
} from './exportHtml';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const FONT_OK = `data:font/woff2;base64,${'TElDRU5TRUQ'.repeat(8)}`,
  FONT_NO = `data:font/woff2;base64,${'VU5MSUNFTlNFRA'.repeat(8)}`;
const HOSTILE = 'Salt </script><script>alert(1)</script> <!-- flat --> & "co" \u2028 \u2029 </SCRIPT >';
const TYPED_URL = 'https://example.com/typed-by-the-author';
const people: Recipient[] = [
  {
    id: 'r1',
    name: 'Ada Example',
    slug: 'ada-example',
    coverLine: 'Prepared for Ada Example.',
    note: 'Ada: the desert unit is yours to see first.',
    lead: 'without-grants',
    highlightCardId: 'give',
  },
  {
    id: 'r2',
    name: 'Placeholder Fund',
    slug: 'placeholder-fund',
    coverLine: 'For the committee of the Placeholder Fund.',
    note: 'A note only the Fund should read.',
    lead: 'with-grants',
  },
  {
    id: 'r3',
    name: 'Quiet Person',
    slug: 'quiet-person',
    coverLine: 'One copy, for Quiet Person.',
    lead: 'with-grants',
  },
];
const slides: SlideSpec[] = [
  { id: 'cover', layout: 'cover', imageId: 'used' },
  {
    id: 'place',
    layout: 'photo',
    headline: HOSTILE,
    body: 'A dry lake bed.',
    footnote: `See ${TYPED_URL}`,
    imageId: 'used',
  },
  {
    id: 'secret',
    layout: 'text',
    headline: 'A hidden slide nobody is sent',
    body: 'HIDDEN-SLIDE-BODY',
    hidden: true,
    imageId: 'only-hidden',
  },
  {
    id: 'ways',
    layout: 'ways',
    cards: [
      { id: 'invest', title: 'Invest', body: 'Put money in.' },
      { id: 'give', title: 'Give', body: 'A gift.' },
    ],
  },
  { id: 'numbers', layout: 'numbers' },
  { id: 'ask', layout: 'ask' },
];
const fontFiles: FontFile[] = [
  { id: 'f1', role: 'title', family: 'Licensed Face', dataUrl: FONT_OK, embedOk: true },
  { id: 'f2', role: 'body', family: 'Unlicensed Face', dataUrl: FONT_NO, embedOk: false },
];
function project(over: Partial<Pitch> = {}): Project {
  const p = withPitch(applyDeal(sampleProject()));
  return {
    ...p,
    name: 'Salt Flat',
    waterfall: { ...p.waterfall, nonRecoupable: 60_000 },
    pitch: {
      ...p.pitch!,
      slides,
      recipients: people,
      revenue: [{ id: 'r', source: 'all', low: 400_000, mid: 1_200_000, high: 3_000_000 }],
      lookbook: [
        { id: 'used', dataUrl: PNG, caption: 'The flat at dawn', section: 'tone' },
        {
          id: 'only-hidden',
          dataUrl: PNG.replace('CAYAAAAf', 'CAYAAAAg'),
          caption: 'ONLY-ON-THE-HIDDEN-SLIDE',
          section: 'tone',
        },
        { id: 'spare', dataUrl: PNG.replace('CAYAAAAf', 'CAYAAAAh'), caption: 'NEVER-USED-PICTURE', section: 'tone' },
      ],
      design: { ...p.pitch!.design!, fontFiles },
      ...over,
    },
  };
}
const data = (over: Partial<Pitch> = {}): DeckData =>
  deckData(project(over), { today: '2031-03-04', fonts: 'embeddable' });
const parts = { runtimeJs, css: runtimeCss };
const secretsOf = (r: Recipient) => [r.name, r.slug, r.coverLine, r.note].filter((x): x is string => !!x);

/** Opens a page the way a browser does, scripts on. */
function open(html: string, hash = '') {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: `file:///deck.html${hash}`, pretendToBeVisual: true });
  const doc = dom.window.document;
  const root = doc.getElementById('deck')!.shadowRoot!;
  const part = (name: string) => root.querySelector(`[data-part="${name}"]`)?.textContent ?? null;
  return { dom, doc, root, part, slides: () => root.querySelectorAll('section.psd-slide').length };
}
const tick = () => new Promise(r => setTimeout(r, 20));

describe('the page as text', () => {
  it('is one document with a title, a language, a viewport, a fallback line and the three privacy metas', () => {
    const html = deckHtml(data(), parts);
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).toContain('<title>Salt Flat: Investor deck</title>');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toMatch(/<noscript><p>[^<]*JavaScript[^<]*PDF[^<]*<\/p><\/noscript>/);
    expect(deckHtml(data(), { ...parts, title: 'A <b>title</b>', lang: 'fr-CA' })).toContain('<html lang="fr-CA">');
    expect(deckHtml(data(), { ...parts, title: 'A <b>title</b>' })).toContain(
      '<title>A &lt;b&gt;title&lt;/b&gt;</title>',
    );
    expect(deckHtml(data(), { ...parts, lang: '"><script>' })).toContain('<html lang="en">');
    expect(deckTitle('  ')).toBe('Investor deck');
  });
  it('has a strict Content-Security-Policy whose script hash is the hash of the one script in the page', () => {
    const html = deckHtml(data(), parts, { recipient: 'ada-example' });
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('img-src data:');
    expect(csp).not.toContain('blob:');
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(
      csp
        .split('; ')
        .map(d => d.split(' ')[0])
        .sort(),
    ).toEqual(['base-uri', 'default-src', 'font-src', 'form-action', 'img-src', 'script-src', 'style-src']);
    expect(csp).toContain('font-src data:');
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).not.toMatch(/connect-src|https?:|\*|unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    expect(scripts).toHaveLength(1);
    expect(csp).toContain(`script-src 'sha256-${createHash('sha256').update(scripts[0], 'utf8').digest('base64')}'`);
    // every other script element is data, which a browser does not run
    expect([...html.matchAll(/<script([^>]*)>/g)].map(m => m[1].trim()).sort()).toEqual([
      '',
      'type="application/json" id="deck-css"',
      'type="application/json" id="deck-data"',
    ]);
  });
  it('asks the network for nothing: no address in it but the one the author typed, no link, no import, no eval', () => {
    const html = deckHtml(data(), parts, { recipient: 'ada-example' });
    expect(html.match(/https?:\/\/[^\s"'\\<)]*/g)).toEqual([TYPED_URL]);
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, ''); // the page's own elements, the scripts' text aside
    expect(markup).not.toMatch(
      /<link\b|<iframe\b|<img\b|<object\b|<embed\b|<a\b|<form\b|\bsrc=|\bhref=|@import|url\(/i,
    );
    expect(runtimeCss).not.toMatch(/url\(|@import|https?:/i);
    expect(html).not.toMatch(
      /\beval\s*\(|new Function\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts/,
    );
  });
  it('is the same file, byte for byte, for the same inputs, and has no date but the one passed in', () => {
    expect(deckHtml(data(), parts, { recipient: 'ada-example' })).toBe(
      deckHtml(data(), parts, { recipient: 'ada-example' }),
    );
    expect(deckHtml(data(), parts)).toContain('Investor deck. March 2031.');
    const undated = deckHtml(deckData(project(), { fonts: 'embeddable' }), parts);
    expect(undated).not.toMatch(/20[2-9]\d-\d\d-\d\d/);
    expect(undated).not.toContain(String(new Date().getFullYear()));
  });
});

describe('text an author typed never becomes markup', () => {
  it('writes <, >, & and the line separators as escapes inside the data', () => {
    expect(safeJson({ a: '</script><!-- & \u2028\u2029' })).toBe(
      '{"a":"\\u003c/script\\u003e\\u003c!-- \\u0026 \\u2028\\u2029"}',
    );
    expect(JSON.parse(safeJson({ a: HOSTILE }))).toEqual({ a: HOSTILE });
    expect(safeJson(undefined)).toBe('null');
    expect(safeJson(() => 1)).toBe('null');
    expect(safeJson(null)).toBe('null');
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    expect(safeScript('a</script>b</SCRIPT>c<!--d')).toBe('a<\\/script>b<\\/SCRIPT>c<\\!--d');
  });
  it('a hostile headline, film name and note cannot close a script or open a comment', () => {
    const d = data({ recipients: [{ ...people[0], note: HOSTILE, coverLine: HOSTILE }] });
    d.film = HOSTILE;
    const html = deckHtml(d, parts, { recipient: 'ada-example' });
    const body = html.slice(html.indexOf('<body>'));
    expect(body.match(/<\/script>/gi)).toHaveLength(3); // the three elements the page itself has
    expect(body).not.toContain('<!--');
    expect(body).not.toContain('<script>alert(1)');
    expect(body).not.toMatch(/[\u2028\u2029]/);
    expect(html).toContain('<title>Salt &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    const page = open(html);
    expect((page.dom.window as unknown as { alert: unknown }).alert).toBeDefined();
    expect(page.doc.querySelectorAll('script')).toHaveLength(3);
    expect(page.root.querySelector('script')).toBeNull();
    expect(page.root.querySelector('.psd-h1')!.textContent).toBe(HOSTILE.trim());
    expect(page.part('ask-note')).toBe(HOSTILE.trim());
  });
});

describe('values that are not text an author typed, but could be in a hand-edited file', () => {
  it('a background colour that is not a colour never reaches the page style', () => {
    for (const bad of [
      'red;} body{display:none',
      '#fff}</style><script>alert(1)</script>',
      'url(https://example.com/x)',
      '#12',
      7,
      null,
      '#ffffff; background:url(x)',
    ]) {
      const d = data();
      (d.theme.colors as { bg: unknown }).bg = bad;
      const html = deckHtml(d, parts);
      const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1];
      expect(style, String(bad)).toContain('html,body{margin:0;height:100%;background:#ffffff}');
      expect(style).not.toMatch(/display:none|url\(|<|alert/);
      expect(html.match(/<\/style>/g)).toHaveLength(1);
    }
    const ok = data();
    ok.theme.colors.bg = '#0A1B2c';
    expect(deckHtml(ok, parts)).toContain('background:#0A1B2c}');
  });
  it('a link ending that is not a plain one cannot break out of the script that starts the deck', () => {
    const slug = 'x"});alert(1);//</script><script>alert(2)</script>\u2028<!--';
    const d = data();
    d.recipients = [{ slug, name: 'Odd Ending', coverLine: 'For Odd Ending.', lead: 'with-grants' }];
    const html = deckHtml(d, parts, { recipient: slug });
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    expect(script).toHaveLength(1); // still one script: nothing closed it early
    expect(script[0]).toContain(
      ',recipient:"x\\"});alert(1);//\\u003c/script\\u003e\\u003cscript\\u003ealert(2)\\u003c/script\\u003e\\u2028\\u003c!--"})',
    );
    expect(html.slice(html.indexOf('<body>'))).not.toMatch(/<script>alert|<!--|\u2028/);
    let alerts = 0;
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'file:///deck.html',
      pretendToBeVisual: true,
      beforeParse: w => {
        (w as unknown as { alert: () => void }).alert = () => {
          alerts++;
        };
      },
    });
    expect(alerts).toBe(0);
    expect(
      dom.window.document.getElementById('deck')!.shadowRoot!.querySelector('[data-part="cover-line"]')!.textContent,
    ).toBe('For Odd Ending.');
  });
});

describe('one person per file', () => {
  it('a file for nobody holds no recipient at all', () => {
    const html = deckHtml(data(), parts);
    for (const r of people) for (const secret of secretsOf(r)) expect(html, secret).not.toContain(secret);
    expect(JSON.parse(/id="deck-data">([^<]*)</.exec(html)![1]).recipients).toEqual([]);
    expect(html).not.toContain('recipient:');
  });
  it("a person's file holds that person and none of the others' names, link endings, cover lines or notes", () => {
    for (const mine of people) {
      const html = deckHtml(data(), parts, { recipient: mine.slug });
      expect(JSON.parse(/id="deck-data">([^<]*)</.exec(html)![1]).recipients.map((r: Recipient) => r.slug)).toEqual([
        mine.slug,
      ]);
      for (const secret of secretsOf(mine)) expect(html, secret).toContain(secret);
      for (const other of people.filter(r => r !== mine))
        for (const secret of secretsOf(other)) expect(html, `${mine.slug} file: ${secret}`).not.toContain(secret);
    }
  });
  it('refuses a link ending nobody has, and never writes two people', () => {
    expect(() => deckHtml(data(), parts, { recipient: 'nobody' })).toThrow(/link ending/);
    expect(dataFor(data(), 'ada-example').recipients).toHaveLength(1);
    expect(dataFor(data(), '').recipients).toEqual([]);
    expect(dataFor(data()).recipients).toEqual([]);
  });
  it('opens as that person with no link ending, and a link ending can switch the ask but not the person', async () => {
    const page = open(deckHtml(data(), parts, { recipient: 'ada-example' }));
    expect(page.part('cover-line')).toBe('Prepared for Ada Example.');
    expect(page.part('ask-note')).toBe('Ada: the desert unit is yours to see first.');
    expect(page.root.querySelector('.psd-highlight')!.getAttribute('data-card-id')).toBe('give');
    const without = page.part('investors'); // her deck leads without grants
    page.dom.window.location.hash = '#with';
    await tick();
    const withGrants = page.part('investors');
    expect(withGrants).not.toBe(without);
    expect(page.part('cover-line')).toBe('Prepared for Ada Example.');
    expect(page.part('ask-note')).toBe('Ada: the desert unit is yours to see first.');
    page.dom.window.location.hash = '#without';
    await tick();
    expect(page.part('investors')).toBe(without);
    for (const hash of ['#placeholder-fund', '#quiet-person-with', '#nonsense', '']) {
      page.dom.window.location.hash = hash;
      await tick();
      expect(page.part('cover-line'), hash).toBe('Prepared for Ada Example.');
      expect(page.part('investors'), hash).toBe(without); // nobody else's lead either
    }
  });
});

describe('the page in a browser', () => {
  it('draws every slide that is not hidden, and the legal line on the numbers slide', () => {
    const d = data();
    const page = open(deckHtml(d, parts));
    expect(d.slides.map(s => s.id)).toEqual(['cover', 'place', 'ways', 'numbers', 'ask']);
    expect(page.slides()).toBe(5);
    expect(page.part('legal')).toMatch(/illustrative projections/);
    expect(page.part('cover-line')).toBe('Investor deck. March 2031.');
    expect(page.root.querySelectorAll('button.psd-toggle')).toHaveLength(1);
    expect((page.dom.window as unknown as { deck: { slideCount: number } }).deck.slideCount).toBe(5);
  });
  it('#without opens on the larger ask and #with on the smaller one', async () => {
    const html = deckHtml(data(), parts);
    const small = open(html).part('investors'),
      big = open(html, '#without').part('investors');
    const n = (t: string | null) => Number((t ?? '').replace(/[^0-9]/g, ''));
    expect(n(big) - n(small)).toBe(60_000);
    expect(open(html, '#with').part('investors')).toBe(small);
    expect(open(html, '#without').part('ask-body')).toMatch(/whole raise/);
    const page = open(html);
    page.dom.window.location.hash = '#without';
    await tick();
    expect(page.part('investors')).toBe(big);
  });
  it('a static page has chips, not switches, and every slide one under the other', () => {
    const page = open(deckHtml(data(), parts, { static: true }));
    expect(page.root.querySelector('.psd')!.classList.contains('psd-static')).toBe(true);
    expect(page.root.querySelectorAll('button')).toHaveLength(0);
    expect([...page.root.querySelectorAll('.psd-chip .psd-toggle-state')].map(e => e.textContent)).toEqual([
      'Included',
    ]);
  });
});

describe('what a file carries', () => {
  it('never a hidden slide, nor a picture only a hidden slide uses, nor a picture no slide uses', () => {
    const html = deckHtml(data(), parts);
    for (const gone of [
      'A hidden slide nobody is sent',
      'HIDDEN-SLIDE-BODY',
      'ONLY-ON-THE-HIDDEN-SLIDE',
      'NEVER-USED-PICTURE',
      'CAYAAAAg',
      'CAYAAAAh',
    ])
      expect(html).not.toContain(gone);
    expect(html).toContain('The flat at dawn');
    expect(html.split(PNG).length - 1).toBe(1); // used on two slides, carried once
  });
  it('only a font file whose licence box is ticked', () => {
    const html = deckHtml(data(), parts);
    expect(html).toContain('Licensed Face');
    expect(html).toContain(FONT_OK);
    expect(html).not.toContain('Unlicensed Face');
    expect(html).not.toContain(FONT_NO);
    const all = deckHtml(deckData(project(), { fonts: 'all' }), parts);
    expect(all).toContain(FONT_NO); // what the preview draws with, and why the default is 'embeddable'
  });
  it("the app's typefaces only as @font-face rules made from checked data URLs", () => {
    const woff = 'data:font/woff2;base64,AAAA';
    const css = fontFaceCss([
      { family: 'Work Sans', weight: 400, src: woff, unicodeRange: LATIN_RANGE },
      { family: 'Work Sans', weight: 400, style: 'italic', src: woff },
      { family: 'Bad"} body{display:none', weight: 400, src: woff },
      { family: 'Remote', weight: 400, src: 'https://example.com/a.woff2' },
      { family: 'Work Sans', weight: 400, src: woff, unicodeRange: 'U+0;} *{color:red' },
    ]);
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css).not.toMatch(/https?:|display:none|color:red/);
    expect(css).toContain(`unicode-range:${LATIN_RANGE}`);
    expect(css).toContain('font-style:italic');
    expect(css).toContain('font-family:"Bad bodydisplaynone"'); // a name with its quotes, braces and colons taken out is only a name
    const html = deckHtml(data(), { ...parts, fonts: [{ family: 'Work Sans', weight: 600, src: woff }] });
    expect(html).toContain(
      '@font-face{font-family:"Work Sans";font-weight:600;font-style:normal;font-display:block;src:url(data:font/woff2;base64,AAAA) format("woff2")}',
    );
    expect(deckHtml(data(), parts)).not.toMatch(/<style>\n@font-face/);
  });
  it("names the app's typefaces a theme lands on, and the weights it draws with", () => {
    expect(bundledFamilyOf('', 'title')).toBe('Special Elite');
    expect(bundledFamilyOf('', 'body')).toBe('Work Sans');
    expect(bundledFamilyOf('Georgia, serif', 'title')).toBeNull();
    expect(bundledFamilyOf('"Some Face", "Work Sans", sans-serif', 'title')).toBe('Work Sans');
    expect(bundledFamilyOf("'Some Face', Another", 'body')).toBe('Work Sans'); // no generic word: the role's fallback is where it ends
    expect(bundledFamilyOf('system-ui, "Work Sans"', 'body')).toBeNull();
    const d = data();
    delete d.theme.fontFaces; // no font files: both roles land on the app's own
    d.theme.fonts = { title: '', body: '' };
    expect(bundledFacesNeeded(dataFor(d))).toEqual([
      { family: 'Special Elite', weight: 400, style: 'normal' },
      { family: 'Work Sans', weight: 400, style: 'normal' },
      { family: 'Work Sans', weight: 600, style: 'normal' },
    ]);
    expect(bundledFacesNeeded(dataFor(d, 'ada-example'))).toContainEqual({
      family: 'Work Sans',
      weight: 400,
      style: 'italic',
    }); // her note is set in italics
    expect(bundledFacesNeeded(dataFor(d, 'quiet-person'))).not.toContainEqual({
      family: 'Work Sans',
      weight: 400,
      style: 'italic',
    });
    d.theme.fonts = { title: 'Georgia, serif', body: 'Helvetica, Arial, sans-serif' };
    expect(bundledFacesNeeded(d)).toEqual([]);
    d.theme.fonts = { title: '"Work Sans", sans-serif', body: '"Special Elite", monospace' };
    expect(bundledFacesNeeded(dataFor(d))).toEqual([
      { family: 'Special Elite', weight: 400, style: 'normal' },
      { family: 'Work Sans', weight: 400, style: 'normal' },
    ]);
    // a role with a font file of its own does without the app's face...
    const own = data();
    own.theme.fonts = { title: '', body: '' };
    expect(own.theme.fontFaces!.map(f => f.role)).toEqual(['title']);
    expect(bundledFacesNeeded(dataFor(own))).toEqual([
      { family: 'Work Sans', weight: 400, style: 'normal' },
      { family: 'Work Sans', weight: 600, style: 'normal' },
    ]);
    own.theme.fontFaces!.push({ family: 'Body Face', role: 'body', src: FONT_OK });
    expect(bundledFacesNeeded(own)).toEqual([]);
    own.theme.fontFaces![1].src = 'https://example.com/not-a-font'; // a file the deck will not use covers nothing
    expect(bundledFacesNeeded(dataFor(own)).map(f => f.family)).toEqual(['Work Sans', 'Work Sans']);
    // ...unless the deck has letters outside basic Latin, which that file may not have
    own.theme.fontFaces![1].src = FONT_OK;
    own.film = 'S\u00f3l P\u0142aski';
    expect(bundledFacesNeeded(dataFor(own))).toEqual([
      { family: 'Special Elite', weight: 400, style: 'normal' },
      { family: 'Work Sans', weight: 400, style: 'normal' },
      { family: 'Work Sans', weight: 600, style: 'normal' },
    ]);
    expect(needsLatinExt(dataFor(d))).toBe(false);
    d.film = 'Sól Płaski';
    expect(needsLatinExt(dataFor(d))).toBe(true);
  });
});

describe('the handwriting face travels only in a deck that writes with it', () => {
  const HAND = { family: 'Caveat', weight: 600, style: 'normal' };
  const typed = (d: DeckData) => {
    delete d.theme.fontFaces;
    d.theme.fonts = { title: 'Georgia, serif', body: 'Helvetica, Arial, sans-serif' };
    return d;
  };
  it('is one of the faces the app carries, in one weight', () => {
    expect([...BUNDLED_FAMILIES]).toEqual(['Work Sans', 'Special Elite', 'Caveat']);
  });
  it('is left out when handwriting is off, whatever papers the deck uses', () => {
    const d = typed(data());
    expect(bundledFacesNeeded(d)).toEqual([]);
    d.theme.paper = 'torn';
    for (const s of d.slides) s.paper = 'mixed';
    expect(bundledFacesNeeded(d)).toEqual([]);
    for (const off of [false, undefined, 'true', 1, {}]) {
      d.theme.hand = off as never;
      expect(bundledFacesNeeded(d), String(off)).toEqual([]);
    }
  });
  it('is carried, once, when handwriting is on and a slide has a card to write on', () => {
    const d = typed(data());
    d.theme.hand = true;
    expect(hasCards(d)).toBe(true);
    expect(bundledFacesNeeded(d)).toEqual([HAND]);
    expect(bundledFacesNeeded(dataFor(d, 'ada-example'))).toEqual([HAND]);
    const own = data();
    own.theme.hand = true;
    delete own.theme.fontFaces;
    own.theme.fonts = { title: '', body: '' };
    expect(bundledFacesNeeded(dataFor(own)).map(f => `${f.family} ${f.weight}`)).toEqual([
      'Caveat 600',
      'Special Elite 400',
      'Work Sans 400',
      'Work Sans 600',
    ]);
  });
  it('is left out of a deck with no card in it, handwriting or not', () => {
    const d = typed(data());
    d.theme.hand = true;
    d.slides = d.slides.filter(s => s.layout === 'photo' || s.layout === 'numbers' || s.layout === 'ask');
    expect(hasCards(d)).toBe(false);
    expect(bundledFacesNeeded(d)).toEqual([]);
    d.slides.push(
      { id: 'empty', layout: 'cards', cards: [{ id: 'x', title: ' ', body: '' }] },
      { id: 'proof', layout: 'stats', stats: [] },
      { id: 'team', layout: 'team', members: [] },
    );
    expect(hasCards(d)).toBe(false); // a row with no card on it, a proof slide with no quote, a team with no card beside it
    d.slides.push({ id: 'proof2', layout: 'stats', stats: [], quote: { text: 'An invented line.', by: '' } });
    expect(bundledFacesNeeded(d)).toEqual([HAND]);
    for (const junk of [null, undefined, 7, 'x', {}]) expect(hasCards({ slides: junk } as never)).toBe(false);
  });
  it('is carried for a title stack that names it, with handwriting on the papers off', () => {
    const d = typed(data());
    d.theme.fonts.title = '"Caveat", "Segoe Print", cursive';
    expect(bundledFamilyOf(d.theme.fonts.title, 'title')).toBe('Caveat');
    expect(bundledFacesNeeded(d)).toEqual([HAND]);
    d.theme.hand = true;
    expect(bundledFacesNeeded(d)).toEqual([HAND]); // never twice
  });
  it('goes into the page as one @font-face when it is needed, and the page stays one file with the policy it had', () => {
    const d = typed(data());
    d.theme.hand = true;
    d.theme.paper = 'postcard';
    const fonts = bundledFacesNeeded(d).map(f => ({ ...f, src: FONT_OK, unicodeRange: LATIN_RANGE }));
    const html = deckHtml(d, { ...parts, fonts });
    expect(html.match(/@font-face\{font-family:"Caveat";font-weight:600/g)).toHaveLength(1);
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)![1];
    expect(csp.split('; ').map(x => x.replace(/'sha256-[^']+'/, 'HASH'))).toEqual([
      "default-src 'none'",
      'script-src HASH',
      "style-src 'unsafe-inline'",
      'img-src data:',
      'font-src data:',
      "base-uri 'none'",
      "form-action 'none'",
    ]);
    expect(html.match(/https?:\/\/[^\s"'\<)]*/g)).toEqual([TYPED_URL]);
    expect(deckHtml(typed(data()), parts)).not.toContain('Caveat";font-weight');
    const { root } = open(html);
    expect([...root.querySelectorAll<HTMLElement>('.psd-card')].map(c => c.dataset.paper)).toEqual([
      'postcard',
      'postcard',
      'postcard',
    ]);
    expect(root.querySelector('.psd')!.classList.contains('psd-hand')).toBe(true);
  });
});

describe('SHA-256 and base64, written out so the page needs no library', () => {
  const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  it('matches the published vectors and Node', () => {
    expect(hex(sha256(utf8('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const text of [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      'é €  𝄞 \ud800',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(64),
      'x'.repeat(100_000),
    ]) {
      expect(hex(sha256(utf8(text)))).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
      expect(base64(utf8(text))).toBe(Buffer.from(text, 'utf8').toString('base64'));
    }
    expect([0, 1, 2, 3, 4].map(n => base64(Uint8Array.from({ length: n }, (_, i) => 250 + i)))).toEqual([
      '',
      '+g==',
      '+vs=',
      '+vv8',
      '+vv8/Q==',
    ]);
  });
});
