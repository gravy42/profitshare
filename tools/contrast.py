"""Measures the contrast of every piece of text in the app against the background it is really drawn on, in both
looks (Day and Night), on every tab with the sample loaded, and lists the pairs under WCAG AA (4.5 to 1, or 3 to 1
for text of 24px, or 18.66px bold, and larger).

Run `npm run build`, serve it (`npx vite preview --port 4411 --strictPort`), then:
    python3 tools/contrast.py [--url http://127.0.0.1:4411] [--all]

How it measures: the text colour from the computed style, laid over the first background that is not see-through
walking up from the element (a key's cap is painted on its ::before, so that is read too), with every see-through
colour and every `opacity` on the way blended in. A gradient or a picture behind text is not measured. Text inside the
pitch deck's own preview (a shadow root, in colours the filmmaker picks) and the printed call sheet is not looked at.
Disabled controls and placeholder text are listed apart: WCAG exempts the first, and the second is a hint, not content.
It exits 1 when any ordinary text is under AA.
"""
import argparse
import sys
from playwright.sync_api import sync_playwright

TABS = ['Start', 'Deal', 'Top sheet & budget', 'Stripboard', 'Calendar', 'Call sheets', 'Breakdowns',
        'Points & waterfall', 'SAG tier', 'Incentives', 'Pitch', 'About']

MEASURE = r"""() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat([1]); };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = c => '#' + [0, 1, 2].map(i => Math.round(c[i]).toString(16).padStart(2, '0')).join('');
  // the colour really behind an element: every layer from the page up, see-through ones blended
  const behind = el => {
    const layers = []; let pictured = false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const own = parse(cs.backgroundColor); if (own[3] > 0) layers.push(own);
      if (cs.backgroundImage !== 'none' && own[3] === 0) pictured = true;
      const cap = getComputedStyle(e, '::before');   // a key's cap
      if (cap.content !== 'none' && cap.display !== 'none' && cap.position === 'absolute' && e === el.closest('.btn')) { const c = parse(cap.backgroundColor); if (c[3] > 0) layers.push(c); }
      if (layers.length && layers[layers.length - 1][3] === 1) break;
    }
    let c = [255, 255, 255, 1]; for (const l of layers.reverse()) c = over(l, c);
    return { c, pictured };
  };
  const fade = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const out = [];
  const see = (el, text, kind, colour) => {
    const b = el.getBoundingClientRect(); if (!b.width || !b.height) return;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden') return;
    const bg = behind(el); const fg0 = parse(colour ?? cs.color); const o = fade(el);
    const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * o], bg.c);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const big = size >= 24 || (size >= 18.66 && bold);
    const off = !!el.closest(':disabled, [aria-disabled="true"]') || (el.closest('label')?.querySelector(':disabled') != null);
    const name = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
    const p = el.parentElement; const up = p ? `${p.tagName.toLowerCase()}${p.className && typeof p.className === 'string' ? '.' + p.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} > ` : '';
    out.push({ fg: hex(fg), bg: hex(bg.c), ratio: ratio(fg, bg.c), need: big ? 3 : 4.5, size, bold, kind: off ? 'disabled' : kind, pictured: bg.pictured, where: up + name, text: text.replace(/\s+/g, ' ').trim().slice(0, 40) });
  };
  const skip = el => el.closest('.callsheet, .print-root, svg, option');
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const done = new Set();
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement; if (!n.data.trim() || !el || done.has(el) || skip(el) || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|SELECT)$/.test(el.tagName)) continue;
    done.add(el); see(el, n.data, 'text');
  }
  for (const f of document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"]):not([type="file"]):not([type="hidden"]), textarea, select')) {
    if (skip(f)) continue;
    if (f.value) see(f, f.tagName === 'SELECT' ? (f.selectedOptions[0]?.textContent ?? '') : f.value, 'field');
    else if (f.placeholder) see(f, f.placeholder, 'placeholder', getComputedStyle(f, '::placeholder').color);
  }
  return out;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:4411')
    ap.add_argument('--all', action='store_true', help='also list the pairs that pass, lowest first')
    a = ap.parse_args()
    failed = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome')
        for scheme, look in (('light', 'Day'), ('dark', 'Night')):
            page = browser.new_context(viewport={'width': 1440, 'height': 900}, color_scheme=scheme).new_page()
            page.goto(a.url)
            page.get_by_role('button', name='Load the sample').click()
            page.wait_for_timeout(600)
            pairs = {}
            for label in TABS:
                page.get_by_role('button', name=label, exact=True).click()
                page.wait_for_timeout(500)
                page.evaluate("() => { for (const d of document.querySelectorAll('main details')) d.open = true; }")
                if label == 'Top sheet & budget':
                    page.locator('tr.cat td:first-child').first.click()
                    page.locator('tr.acct td:first-child').first.click()
                page.wait_for_timeout(300)
                for r in page.evaluate(MEASURE):
                    key = (r['kind'], r['fg'], r['bg'], r['need'])
                    e = pairs.setdefault(key, {**r, 'n': 0, 'tabs': [], 'wheres': []})
                    e['n'] += 1
                    if label not in e['tabs']:
                        e['tabs'].append(label)
                    if r['where'] not in e['wheres'] and len(e['wheres']) < 4:
                        e['wheres'].append(r['where'])
            under = sorted((e for e in pairs.values() if e['ratio'] < e['need']), key=lambda e: (e['kind'] != 'text' and e['kind'] != 'field', e['ratio']))
            real = [e for e in under if e['kind'] in ('text', 'field')]
            failed += len(real)
            print(f"\n== {look}: {sum(e['n'] for e in pairs.values())} pieces of text, {len(pairs)} colour pairs, "
                  f"{len(real)} under AA, {len(under) - len(real)} more that are disabled or placeholders ==")
            for e in (sorted(pairs.values(), key=lambda e: e['ratio']) if a.all else under):
                print(f"  {e['ratio']:5.2f} (needs {e['need']}) {e['kind']:<11} {e['fg']} on {e['bg']}{' +picture' if e['pictured'] else ''}  x{e['n']}  "
                      f"{e['size']:g}px{' bold' if e['bold'] else ''}  \"{e['text']}\"  [{'; '.join(e['wheres'])}]  on {', '.join(e['tabs'][:4])}{'…' if len(e['tabs']) > 4 else ''}")
        browser.close()
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
