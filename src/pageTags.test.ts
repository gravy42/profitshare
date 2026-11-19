// The link preview and the icons in index.html. Two things here are easy to break without seeing it: the preview
// picture must be a full address (the apps that draw a preview do not resolve a relative one), and the icons must be
// the app's own files, because the page's security policy lets pictures come from nowhere else.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { cspDirectives } from '../tools/csp.mjs';

const html = readFileSync('index.html', 'utf8');
const meta = (key: string) => new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`).exec(html)?.[1];
const link = (rel: string) => new RegExp(`<link\\s+rel="${rel}"\\s+href="([^"]*)"`).exec(html)?.[1];

describe('index.html link preview and icons', () => {
  it('describes the app and names its address', () => {
    expect(meta('description')!.length).toBeGreaterThan(50);
    expect(meta('og:title')).toContain('ProfitShare');
    expect(meta('og:url')).toBe('https://profitshare.alonegirlmovie.com/');
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('theme-color')).toBe('#092827');
  });
  it('gives the preview picture as a full address, to a file that is in public/', () => {
    for (const key of ['og:image', 'twitter:image'])
      expect(meta(key)).toBe('https://profitshare.alonegirlmovie.com/social.png');
    expect(existsSync('public/social.png')).toBe(true);
  });
  it('takes its icons from its own files, which the policy allows', () => {
    for (const rel of ['icon', 'apple-touch-icon']) {
      const href = link(rel)!;
      expect(href).toMatch(/^\/[\w.-]+$/);
      expect(existsSync(`public${href}`)).toBe(true);
    }
    expect(cspDirectives().find(d => d[0] === 'img-src')).toContain("'self'");
  });
  it('uses no em-dash in the words a person reads', () => {
    expect(html).not.toContain('—');
  });
});
