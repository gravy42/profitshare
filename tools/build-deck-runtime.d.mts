// Types for build-deck-runtime.mjs, for vite.config.ts and the tests that call it.
export const RUNTIME_DIR: string;
export const OUT_DIR: string;
export const OUT_JS: string;
export const OUT_CSS: string;
/** The runtime as text: `js` is the IIFE, `css` the stylesheet, `inputs` every source file (all on disk) the bundle was made from. */
export function bundleDeckRuntime(options?: { quiet?: boolean }): Promise<{ js: string; css: string; inputs: string[] }>;
export function loadDeckExport(): Promise<typeof import('../src/deck-runtime/exportHtml')>;
export function buildDeckRuntime(options?: { quiet?: boolean }): Promise<{ js: number; css: number }>;
