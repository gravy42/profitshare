// The app page's Content-Security-Policy: what the built index.html may load, run and talk to. GitHub Pages sends no
// headers of ours, so the policy travels as a <meta> tag, written into the page when it is built (`cspPlugin`, in
// vite.config.ts). The dev server is left alone: it injects inline scripts and holds a websocket open.
//
// The page keeps the person's own AI key in localStorage, so the point is: no script but the app's own files runs
// here, and nothing leaves for anywhere but the three hosts the app really talks to.
//
// The pitch decks the app exports carry their own, stricter policy (src/deck-runtime/exportHtml.ts). Not this one.
import { createHash } from 'node:crypto';

/** Every host besides its own that the app asks for anything. Each is named in the code that asks:
 *  src/ai.ts (the AI features, with the person's own key) and src/engine/googleFonts.ts (the font picker, after a yes). */
export const CONNECT_HOSTS = ['https://api.anthropic.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

/** The policy, one directive a line. `scriptHashes`: a 'sha256-…' source for each inline script in the page.
 *  `oneFile`: the build that is a single .html (`npm run build:single`), whose fonts are data: addresses inside it. */
export function cspDirectives(scriptHashes = [], { oneFile = false } = {}) {
  return [
    // nothing is allowed unless a line below says so
    ["default-src", "'none'"],
    // the app's own files, and the inline scripts in index.html by their hashes: no 'unsafe-inline', no eval.
    // 'wasm-unsafe-eval' lets WebAssembly be compiled and nothing else (no eval, no new Function): pdf.js decodes the
    // JPEG 2000 pictures inside a PDF with a WebAssembly decoder, when a look book or brand book has one. The decoder
    // is one of the app's own files (dist/pdfjs/, tools/pdfjs-decoders.mjs), read with fetch(): connect-src 'self'
    ["script-src", "'self'", "'wasm-unsafe-eval'", ...scriptHashes],
    // the app's stylesheets; 'unsafe-inline' for React's style attributes and the <style> the deck preview puts in its shadow root
    ["style-src", "'self'", "'unsafe-inline'"],
    // pictures live inside the project as data: addresses; the deck preview draws them from blob: copies
    ["img-src", "'self'", "data:", "blob:"],
    // the app's own faces, and the font files a project carries (data:)
    ["font-src", "'self'", "data:"],
    // fetch(): the app's own files (its font files are read again when a deck is written) and the three hosts.
    // In the one-file build those font files are data: addresses, and reading one of those sends nothing anywhere
    ["connect-src", "'self'", ...(oneFile ? ["data:"] : []), ...CONNECT_HOSTS],
    // pdf.js reads a PDF in a worker made from a blob: of its own bundled code
    ["worker-src", "blob:"],
    // no plugins, no frames, no <base>, no form that posts anywhere
    ["object-src", "'none'"],
    ["frame-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'none'"],
  ];
}
export const contentSecurityPolicy = (scriptHashes = [], options = {}) => cspDirectives(scriptHashes, options).map(d => d.join(' ')).join('; ');

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const runs = attrs => { const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1].toLowerCase(); return !type || type === 'module' || /^(text|application)\/(java|ecma)script$/.test(type); };
/** The text of every inline script the browser would run, as the browser reads it. */
export function inlineScripts(html) {
  const out = [];
  for (const m of String(html).matchAll(SCRIPT)) if (!/\bsrc\s*=/i.test(m[1]) && runs(m[1])) out.push(m[2]);
  return out;
}
/** A script's source expression for script-src: the SHA-256 of its text. */
export const scriptHash = text => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/** The page with its policy: the hashes are taken from the page's own inline scripts, here, each time, so an edit to
 *  one can never leave a stale hash behind. The tag goes first in <head>, since a policy governs what follows it. */
export function withCsp(html, options = {}) {
  const page = String(html).replace(/\r\n?/g, '\n');   // the browser hashes a script with its line ends already made \n
  const top = page.slice(0, Math.max(0, page.search(/<script\b/i)));   // the page's own tags; past the first script the words may be the app's code (the one-file build)
  if (/http-equiv\s*=\s*["']?Content-Security-Policy/i.test(top)) throw new Error('csp: the page already carries a policy');
  const policy = contentSecurityPolicy([...new Set(inlineScripts(page).map(scriptHash))], options);
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  const at = /<meta\s+charset[^>]*>/i.exec(page) ?? /<head[^>]*>/i.exec(page);   // after the charset, which must stay in the page's first bytes
  if (!at) throw new Error('csp: the page has no <head>');
  const end = at.index + at[0].length;
  return `${page.slice(0, end)}\n    ${tag}${page.slice(end)}`;
}

/** Vite: the policy goes into every .html a build writes, after everything else has had its say (the one-file build
 *  inlines its scripts late, and they are hashed like any other). Builds only: `npm run dev` is not touched. */
export function cspPlugin(options = {}) {
  return {
    name: 'profitshare-csp',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.html')) file.source = withCsp(typeof file.source === 'string' ? file.source : Buffer.from(file.source).toString('utf8'), options);
      }
    },
  };
}
