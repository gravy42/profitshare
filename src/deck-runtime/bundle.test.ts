// @vitest-environment node
// The runtime as the app gets it: `virtual:deck-runtime`, made by the plugin in vite.config.ts. A dev server must be
// able to serve it (it watches the files the bundle was made from, so every one of them has to be a real file).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import { bundleDeckRuntime } from '../../tools/build-deck-runtime.mjs';
import { deckRuntime } from '../../vite.config';

describe('the runtime bundle', () => {
  it('names only files that are on disk as its inputs, the stylesheet and the runtime among them', async () => {
    const { js, css, inputs } = await bundleDeckRuntime({ quiet: true });
    expect(js).toContain('ProfitShareDeck');
    expect(css).toContain('.psd-slide');
    expect(inputs.length).toBeGreaterThan(4);
    for (const f of inputs) expect(existsSync(f), `${f} is watched but is not a file`).toBe(true);
    const named = inputs.map(f => f.replace(/\\/g, '/'));
    for (const want of ['src/deck-runtime/runtime.ts', 'src/deck-runtime/deck.css', 'src/engine/pathMath.ts']) expect(named.some(f => f.endsWith(want)), want).toBe(true);
    expect(named.some(f => f.includes('deck-runtime-entry'))).toBe(false);   // the entry is text, not a file
  });
  it('the plugin watches nothing that is not there', async () => {
    const plugin = deckRuntime();
    const watched: string[] = [];
    const resolved = (plugin.resolveId as (id: string) => string | undefined)('virtual:deck-runtime')!;
    const code = await (plugin.load as (this: { addWatchFile(f: string): void }, id: string) => Promise<string | undefined>).call({ addWatchFile: f => watched.push(f) }, resolved);
    expect(code).toMatch(/^export const runtimeJs = "/);
    expect(code).toContain('export const runtimeCss = "');
    expect(watched.length).toBeGreaterThan(4);
    for (const f of watched) expect(existsSync(f), f).toBe(true);
    expect((plugin.resolveId as (id: string) => string | undefined)('virtual:something-else')).toBeUndefined();
  });
  it('a dev server serves it, and makes it again after a runtime source changes', async () => {
    const server = await createServer({ configFile: resolve(process.cwd(), 'vite.config.ts'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
    try {
      const first = await server.transformRequest('virtual:deck-runtime');
      expect(first?.code).toContain('runtimeJs');
      expect(first?.code).toContain('ProfitShareDeck');
      const mod = await server.ssrLoadModule('virtual:deck-runtime') as { runtimeJs: string; runtimeCss: string };
      expect(mod.runtimeJs.length).toBeGreaterThan(10_000);
      expect(mod.runtimeCss).toContain('.psd-slide');
      // the module the dev server holds is thrown away when a runtime file changes
      const id = '\0virtual:deck-runtime';
      const held = server.moduleGraph.getModuleById(id)!;
      expect(held.transformResult ?? held.ssrTransformResult).toBeTruthy();
      const sent: unknown[] = [];
      const plugin = server.config.plugins.find(p => p.name === 'profitshare-deck-runtime')!;
      const hot = plugin.handleHotUpdate as (ctx: { file: string; server: unknown }) => void;
      hot({ file: resolve(process.cwd(), 'src/deck-runtime/runtime.ts'), server: { moduleGraph: server.moduleGraph, ws: { send: (m: unknown) => sent.push(m) } } });
      expect(sent).toEqual([{ type: 'full-reload' }]);
      expect(held.transformResult).toBeNull();
      sent.length = 0;
      hot({ file: resolve(process.cwd(), 'src/ui/PitchDeck.tsx'), server: { moduleGraph: server.moduleGraph, ws: { send: (m: unknown) => sent.push(m) } } });
      expect(sent).toEqual([]);   // not a runtime file: nothing to make again
    } finally { await server.close(); }
  }, 60_000);
});
