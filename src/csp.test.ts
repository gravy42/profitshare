// @vitest-environment node
// The built page's Content-Security-Policy (tools/csp.mjs): what it allows, read back directive by directive, and the
// hash of the inline theme script, worked out again here from index.html so the two can never drift apart.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONNECT_HOSTS, contentSecurityPolicy, cspDirectives, cspPlugin, inlineScripts, scriptHash, withCsp } from '../tools/csp.mjs';
import { GOOGLE_CSS_ORIGIN, GOOGLE_FILE_ORIGIN } from './engine/googleFonts';

const indexHtml = readFileSync('index.html', 'utf8');
/** A policy string as { directive: [sources] }. */
const read = (policy: string): Record<string, string[]> => Object.fromEntries(policy.split(';').map(d => d.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
const policyOf = (html: string): string => /<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/.exec(html)![1];
const sha = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const HASH = /^'sha256-[A-Za-z0-9+/]{43}='$/;

describe('the app page\'s Content-Security-Policy', () => {
  const policy = read(contentSecurityPolicy([sha('x')]));

  it('starts from nothing and names every directive it needs, once', () => {
    const names = cspDirectives().map(d => d[0]);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(['base-uri', 'connect-src', 'default-src', 'font-src', 'form-action', 'frame-src', 'img-src', 'object-src', 'script-src', 'style-src', 'worker-src']);
    expect(policy['default-src']).toEqual(["'none'"]);
  });
  it('script-src: the app\'s own files and hashed inline scripts; no unsafe-inline, no unsafe-eval', () => {
    const scripts = policy['script-src'];
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts.join(' ')).not.toMatch(/unsafe-inline|unsafe-eval(?!')|unsafe-hashes|strict-dynamic|data:|blob:|https?:|\*/);
    expect(scripts.slice(0, 2)).toEqual(["'self'", "'wasm-unsafe-eval'"]);   // WebAssembly only (pdf.js's JPEG 2000 decoder); it does not allow eval
    for (const s of scripts.slice(2)) expect(s).toMatch(HASH);
    expect(read(contentSecurityPolicy())['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  });
  it('connect-src: itself and exactly the three hosts the code asks', () => {
    expect(policy['connect-src']).toEqual(["'self'", 'https://api.anthropic.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
    expect(CONNECT_HOSTS).toEqual(['https://api.anthropic.com', GOOGLE_CSS_ORIGIN, GOOGLE_FILE_ORIGIN]);   // the font picker's two hosts, as its own code names them
  });
  it('every address the app\'s code asks with fetch() is on one of those hosts', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
    const asked = new Set<string>();
    for (const f of files('src')) for (const m of readFileSync(f, 'utf8').matchAll(/fetch\(\s*[`'"](https?:\/\/[^/`'"$]+)/g)) asked.add(m[1]);
    expect([...asked]).toEqual(['https://api.anthropic.com']);   // src/ai.ts; the font picker builds its addresses from the two constants above
    for (const host of asked) expect(CONNECT_HOSTS).toContain(host);
  });
  it('pictures and fonts: the app\'s own and the ones a project carries, never another site\'s', () => {
    expect(policy['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(policy['font-src']).toEqual(["'self'", 'data:']);
    expect(policy['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy['worker-src']).toEqual(['blob:']);
  });
  it('no plugins, no frames, no <base>, no form posts', () => {
    for (const d of ['object-src', 'frame-src', 'base-uri', 'form-action']) expect(policy[d]).toEqual(["'none'"]);
  });
  it('names no other site, no whole scheme and no wildcard anywhere', () => {
    const sources = Object.values(policy).flat();
    expect(sources.filter(s => /^https?:\/\//.test(s))).toEqual(CONNECT_HOSTS);
    for (const s of sources) { expect(s).not.toContain('*'); expect(s).not.toMatch(/^(https?|wss?|filesystem|mediastream):$/); }
  });
  it('leaves out what a <meta> policy cannot carry', () => {
    for (const d of ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']) expect(policy[d]).toBeUndefined();
  });
  it('the one-file build adds reading its own data: fonts, and nothing else', () => {
    const one = read(contentSecurityPolicy([sha('x')], { oneFile: true }));
    expect(one['connect-src']).toEqual(["'self'", 'data:', ...CONNECT_HOSTS]);
    expect({ ...one, 'connect-src': policy['connect-src'] }).toEqual(policy);
  });
});

describe('the policy written into index.html', () => {
  // the theme script, cut out of index.html here by plain string work (not by the code under test)
  const themeScript = indexHtml.replace(/\r\n?/g, '\n').split('<script>')[1].split('</script>')[0];
  const built = withCsp(indexHtml);

  it('index.html has one inline script, the theme script, and no policy of its own (the dev server needs none)', () => {
    expect(themeScript).toContain("localStorage.getItem('profitshare.theme')");
    expect(inlineScripts(indexHtml)).toEqual([themeScript]);
    expect(indexHtml).not.toMatch(/Content-Security-Policy/i);
  });
  it('the hash in the policy is the hash of the theme script as it is today', () => {
    const scripts = read(policyOf(built))['script-src'];
    expect(scripts).toEqual(["'self'", "'wasm-unsafe-eval'", sha(themeScript)]);
    expect(scriptHash(themeScript)).toBe(sha(themeScript));
  });
  it('an edit to the script changes the hash with it', () => {
    const edited = indexHtml.replace("'profitshare.theme'", "'profitshare.look'");
    expect(edited).not.toBe(indexHtml);
    const scripts = read(policyOf(withCsp(edited)))['script-src'];
    expect(scripts[2]).toMatch(HASH);
    expect(scripts[2]).not.toBe(sha(themeScript));
    expect(scripts[2]).toBe(sha(themeScript.replace("'profitshare.theme'", "'profitshare.look'")));
  });
  it('the tag is written once, after the charset and before any script, and the rest of the page is as it was', () => {
    expect(built.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
    const at = built.indexOf('http-equiv="Content-Security-Policy"');
    expect(at).toBeGreaterThan(built.indexOf('<meta charset'));
    expect(at).toBeLessThan(built.indexOf('<script'));
    expect(built.indexOf('<meta charset')).toBeLessThan(200);
    expect(built.replace(/\n\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')).toBe(indexHtml.replace(/\r\n?/g, '\n'));
    expect(policyOf(built)).toBe(contentSecurityPolicy([sha(themeScript)]));
  });
  it('a page saved with Windows line ends gets the hash the browser will work out', () => {
    const crlf = withCsp(indexHtml.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'));
    expect(policyOf(crlf)).toBe(policyOf(built));
    expect(crlf).not.toContain('\r');
  });
  it('hashes every inline script that runs, and only those', () => {
    const page = '<!doctype html><html><head><meta charset="UTF-8" /><script>one()</script><script type="module">two()</script><script src="/a.js"></script><script type="module" crossorigin src="/b.js"></script><script type="application/json">{"three":3}</script><script>one()</script></head><body></body></html>';
    expect(inlineScripts(page)).toEqual(['one()', 'two()', 'one()']);
    expect(read(policyOf(withCsp(page)))['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'", sha('one()'), sha('two()')]);
  });
  it('refuses a page that already carries a policy, or has no head to put one in', () => {
    expect(() => withCsp(built)).toThrow(/already carries a policy/);
    expect(() => withCsp('<p>no head</p>')).toThrow(/no <head>/);
  });
  it('is applied when the app is built, and never by the dev server', () => {
    const plugin = cspPlugin();
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('post');
    const bundle: Record<string, { type: string; fileName: string; source?: string | Uint8Array; code?: string }> = {
      'index.html': { type: 'asset', fileName: 'index.html', source: indexHtml },
      'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: 'app()' },
      'assets/app.css': { type: 'asset', fileName: 'assets/app.css', source: 'body{}' },
    };
    (plugin.generateBundle as unknown as (options: unknown, bundle: unknown) => void).call({}, {}, bundle);
    expect(bundle['index.html'].source).toBe(built);
    expect(bundle['assets/app.css'].source).toBe('body{}');
    expect(bundle['assets/app.js'].code).toBe('app()');
  });
});
