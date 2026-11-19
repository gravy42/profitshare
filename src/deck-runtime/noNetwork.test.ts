// @vitest-environment node
// The deck's runtime knows nothing of where a font came from. A font picked from Google Fonts reaches it as bytes in
// the deck's data, like any attached file: no source in the runtime, and nothing in the script a sent deck carries,
// names Google or asks any address for anything.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleDeckRuntime } from '../../tools/build-deck-runtime.mjs';

describe('the deck and where a font came from', () => {
  const dir = resolve(process.cwd(), 'src/deck-runtime');
  const NAMES = /google|gstatic|googleapis/i;
  it("nothing in the runtime's sources names Google or an address at it", () => {
    const files = readdirSync(dir).filter(f => /\.(ts|css)$/.test(f) && !/\.test\.ts$/.test(f));
    expect(files).toContain('runtime.ts');
    expect(files).toContain('fonts.ts');
    expect(files).toContain('exportHtml.ts');
    expect(files).toContain('deck.css');
    for (const f of files) expect(NAMES.test(readFileSync(resolve(dir, f), 'utf8')), f).toBe(false);
  });
  it('nor does the script and stylesheet a sent deck carries, which name no address at all', async () => {
    const { js, css } = await bundleDeckRuntime({ quiet: true });
    expect(NAMES.test(js)).toBe(false);
    expect(NAMES.test(css)).toBe(false);
    expect(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/.test(js)).toBe(false); // it asks for nothing
    expect(/@import|url\(\s*["']?https?:/i.test(css)).toBe(false);
  });
});
