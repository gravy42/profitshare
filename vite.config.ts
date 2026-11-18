import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { bundleDeckRuntime } from './tools/build-deck-runtime.mjs';
import { cspPlugin } from './tools/csp.mjs';

// `virtual:deck-runtime`: the pitch deck's runtime as text (`runtimeJs`, one IIFE; `runtimeCss`, its stylesheet),
// for the export that inlines it into the .html a filmmaker sends. It is bundled from src/deck-runtime when the
// module is asked for (dev, build, build:single and vitest all come through here), so there is no generated file
// to go stale: the script that ships is always made from the sources the preview runs.
export function deckRuntime(): Plugin {
  const ID = 'virtual:deck-runtime', RESOLVED = '\0' + ID;
  return {
    name: 'profitshare-deck-runtime',
    resolveId(id) { return id === ID ? RESOLVED : undefined; },
    async load(id) {
      if (id !== RESOLVED) return undefined;
      const { js, css, inputs } = await bundleDeckRuntime({ quiet: true });
      for (const f of inputs) this.addWatchFile(f);
      return `export const runtimeJs = ${JSON.stringify(js)};\nexport const runtimeCss = ${JSON.stringify(css)};\n`;
    },
    // dev: a change to a runtime source (or to the math it carries) makes a new bundle, and the page loads it
    handleHotUpdate({ file, server }) {
      const f = file.replace(/\\/g, '/');
      if (!f.includes('/src/deck-runtime/') && !/\/src\/engine\/(pathMath|split)\.ts$/.test(f)) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (!mod) return;
      server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: 'full-reload' });
    },
  };
}

// SINGLEFILE=1 inlines everything into one index.html (one file that can be handed to someone).
// Normal builds are plain static files. Every address in them is relative, so the same build works wherever it is
// served from: profitshare.alonegirlmovie.com, or gravy42.github.io/profitshare/ before the domain was set.
export default defineConfig({
  base: './',
  // cspPlugin: the built page's Content-Security-Policy (tools/csp.mjs); last, so it sees the page as it will be served
  plugins: process.env.SINGLEFILE ? [react(), deckRuntime(), viteSingleFile(), cspPlugin({ oneFile: true })] : [react(), deckRuntime(), cspPlugin()],
  test: { environment: 'jsdom', exclude: ['node_modules/**', 'scratch/**'] },
} as any);
