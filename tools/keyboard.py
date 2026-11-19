"""Walks every tab of the app with the Tab key alone, in both looks, with the sample loaded, and reports:
  unreached  controls on the page that Tab never landed on
  no ring    controls that took focus with nothing drawn to show it, or a ring under 3 to 1 against what is behind it
  mouse only things that answer a click (the pointer turns to a hand) but cannot be focused at all
  trap       a place Tab could not leave
It then checks that a fold opens with Enter, the tab bar works with Enter, and that the font picker and the popped-out
day out of days take focus, keep it inside while open, close on Escape and hand focus back to the button that opened them.

Run `npm run build`, serve it (`npx vite preview --port 4411 --strictPort`), then:
    python3 tools/keyboard.py [--url http://127.0.0.1:4411] [--look Day|Night|both]
The pitch deck's preview (a shadow root) is walked through but its insides are not judged.
"""
import argparse
import sys
from playwright.sync_api import sync_playwright

TABS = ['Start', 'Deal', 'Top sheet & budget', 'Stripboard', 'Calendar', 'Call sheets', 'Breakdowns',
        'Points & waterfall', 'SAG tier', 'Incentives', 'Pitch', 'About']

PREPARE = r"""() => {
  const shown = el => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && (el.checkVisibility?.() ?? true); };   // checkVisibility: not inside a shut fold
  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]';
  let i = 0; const want = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!shown(el) || el.disabled || el.tabIndex < 0 || el.closest('[inert]')) continue;
    if (el.type === 'radio' && el.name && !el.checked && document.querySelector(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`)) continue;   // Tab goes to the chosen one of a set; arrows reach the rest
    el.dataset.kb = String(i++); want.push(el);
  }
  // answers a click, by the look of the pointer, but is not a control and holds none
  const say = el => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const mouse = {};
  for (const el of document.querySelectorAll('main *, header *')) {
    if (!shown(el) || getComputedStyle(el).cursor !== 'pointer') continue;
    if (el.closest(sel) || el.querySelector(sel) || el.closest('label') || el.closest('tr')?.querySelector(sel)) continue;   // a row with a control in it is opened from that control
    const p = el.parentElement; if (p && getComputedStyle(p).cursor === 'pointer' && !p.matches('main, header')) continue;   // count the outermost
    const k = say(el); (mouse[k] ??= { n: 0, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) }).n++;
  }
  window.__kbSeen = new Set();
  return { want: want.length, mouse };
}"""

# what is drawn around the focused element, and how well it shows against what is behind it
LOOK = r"""() => {
  let el = document.activeElement; if (!el || el === document.body) return { at: 'body' };
  const inShadow = !!el.shadowRoot;
  const parse = c => { const m = (c || '').match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat([1]); };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const behind = from => { const layers = []; for (let e = from; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] === 1) break; } let c = [255, 255, 255, 1]; for (const l of layers.reverse()) c = over(l, c); return c; };
  const say = e => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const id = el.dataset.kb; if (id !== undefined) window.__kbSeen.add(id);
  const name = (el.getAttribute('aria-label') || el.title || el.textContent || el.value || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  const where = `${el.parentElement ? say(el.parentElement) + ' > ' : ''}${say(el)}`;
  if (inShadow || el.closest('.pd-frame')) return { at: where, id, name, ring: 'deck' };
  // the ring may be on the element, on its ::before (a key's cap), or on a box around it (a paper choice, the deck frame)
  const tries = [[getComputedStyle(el), el.parentElement], [getComputedStyle(el, '::before'), el.parentElement]];
  for (let p = el.parentElement, n = 0; p && n < 3; p = p.parentElement, n++) tries.push([getComputedStyle(p), p.parentElement]);
  let best = null;
  for (const [cs, under] of tries) {
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
      const auto = cs.outlineStyle === 'auto';   // the browser's own ring: two-toned, drawn to show on anything
      const c = parse(cs.outlineColor); const r = auto ? 99 : ratio(over(c, behind(under)), behind(under));
      if (!best || r > best.r) best = { r, how: auto ? 'browser ring' : `outline ${cs.outlineWidth} ${cs.outlineColor}` };
    }
  }
  // a date or a time field shows the keyboard by highlighting the part being typed (the browser draws it; styles cannot see it)
  if (!best && el.matches('input[type="date"], input[type="time"]')) best = { r: 99, how: 'browser highlight' };
  return { at: where, id, name, ring: best ? best.how : 'none', r: best ? best.r : 0 };
}"""


def walk(page, limit=1600):
    """Tab from the top of the page until focus comes back to where it started. Returns what was seen."""
    page.evaluate("() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); }")
    page.mouse.click(2, 2)
    seen, first, stuck, last = [], None, None, None
    same = 0
    for _ in range(limit):
        page.keyboard.press('Tab')
        r = page.evaluate(LOOK)
        key = (r.get('id'), r['at'])
        if r['at'] == 'body' or (first is not None and key == first and r.get('id') is not None):
            break
        if first is None:
            first = key
        same = same + 1 if key == last and r.get('ring') != 'deck' else 0
        if same >= 8:   # a date or a time field is several stops (day, month, year, its button); eight on one thing is a trap
            stuck = r
            break
        last = key
        seen.append(r)
    return seen, stuck


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:4411')
    ap.add_argument('--look', default='both')
    a = ap.parse_args()
    bad = 0
    looks = [('light', 'Day'), ('dark', 'Night')]
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome')
        for scheme, look in looks:
            if a.look not in ('both', look):
                continue
            page = browser.new_context(viewport={'width': 1440, 'height': 900}, color_scheme=scheme).new_page()
            page.goto(a.url)
            page.get_by_role('button', name='Load the sample').click()
            page.wait_for_timeout(600)
            print(f'\n== {look} ==')
            for label in TABS:
                page.get_by_role('button', name=label, exact=True).click()
                page.wait_for_timeout(500)
                if label == 'Top sheet & budget':
                    page.locator('tr.cat td:first-child').first.click()
                    page.locator('tr.acct td:first-child').first.click()
                    page.wait_for_timeout(200)
                prep = page.evaluate(PREPARE)
                seen, stuck = walk(page)
                missed = page.evaluate("""() => [...document.querySelectorAll('[data-kb]')].filter(e => !window.__kbSeen.has(e.dataset.kb) && e.isConnected && e.getBoundingClientRect().width > 0)
                    .map(e => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 2).join('.')} "${(e.getAttribute('aria-label') || e.title || e.textContent || '').trim().slice(0, 24)}"`)""")
                rings = {}
                for r in seen:
                    if r.get('ring') == 'deck':
                        continue
                    if r['ring'] == 'none' or r['r'] < 3:
                        e = rings.setdefault((r['at'], r['ring']), {'n': 0, 'r': r['r'], 'name': r['name']})
                        e['n'] += 1
                        e['r'] = min(e['r'], r['r'])
                n = len(missed) + len(rings) + (1 if stuck else 0)
                bad += n
                print(f"{'ok  ' if not n else 'FAIL'} {label}: {prep['want']} controls, {len(seen)} stops, {len(missed)} unreached, {len(rings)} kinds with no clear ring"
                      f"{', TRAP at ' + stuck['at'] if stuck else ''}")
                for m in missed[:6]:
                    print(f'       unreached: {m}')
                for (at, ring), e in rings.items():
                    print(f"       ring: {at} x{e['n']} \"{e['name']}\": {ring}{'' if ring == 'none' else f' at {e[chr(114)]:.2f} to 1'}")
                for k, e in prep['mouse'].items():
                    print(f"       mouse only: {k} x{e['n']} \"{e['text']}\"")

            # a fold, from the keyboard
            page.get_by_role('button', name='Deal', exact=True).focus()
            page.keyboard.press('Enter')
            page.wait_for_timeout(400)
            on = page.evaluate("() => document.querySelector('nav.tabs button.on')?.textContent")
            print(f"{'ok  ' if on == 'Deal' else 'FAIL'} the tab bar answers Enter (now on {on})")
            bad += on != 'Deal'
            s = page.locator('main details > summary').first
            s.focus()
            was = s.evaluate('e => e.parentElement.open')
            page.keyboard.press('Enter')
            page.wait_for_timeout(200)
            now = s.evaluate('e => e.parentElement.open')
            print(f"{'ok  ' if was != now else 'FAIL'} a fold opens and shuts with Enter")
            bad += was == now

            # the pop-outs: each takes focus, keeps it, closes on Escape and gives focus back to its button
            def popout(what, tab, opener):
                page.get_by_role('button', name=tab, exact=True).click()
                page.wait_for_timeout(400)
                opener.focus()
                page.keyboard.press('Enter')
                page.wait_for_timeout(600)
                inside = page.evaluate("() => !!document.activeElement.closest('[role=dialog]')")
                kept = True
                for _ in range(12):
                    page.keyboard.press('Tab')
                    kept = kept and page.evaluate("() => !!document.activeElement.closest('[role=dialog]')")
                page.keyboard.press('Escape')
                page.wait_for_timeout(400)
                gone = page.locator('[role=dialog]').count() == 0
                back = opener.evaluate('e => e === document.activeElement')
                ok = inside and kept and gone and back
                print(f"{'ok  ' if ok else 'FAIL'} {what}: focus goes in ({inside}), stays in over 12 Tabs ({kept}), Escape closes it ({gone}), focus returns to its button ({back})")
                return 0 if ok else 1
            bad += popout('the font picker', 'Pitch', page.get_by_role('button', name='Pick the title font from Google Fonts'))
            bad += popout('the day out of days, popped out', 'Stripboard', page.locator('button[title="open the full day-out-of-days"]'))
        browser.close()
    print('\nall clear' if not bad else f'\n{bad} to look at')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
