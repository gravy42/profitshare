"""Measures how every table in the app is drawn at phone width, tab by tab, with the sample loaded.

Run `npm run build`, serve it (`npx vite preview --port 4411 --strictPort`), then:
    python3 tools/phone-tables.py [--url http://127.0.0.1:4411] [--width 390] [--shots some/folder]

For each tab, and each state of it that shows another table (folds opened, a budget account opened, the pop-outs,
the four breakdown reports), it reports:
  over     how far the page itself scrolls sideways, in px (must be 0)
  crushed  table cells under 30px wide holding 4 or more characters of text
  broken   words, numbers or money in a table cell drawn on more than one line (broken mid-word)
  fields   text boxes and menus in a table cell squeezed under 40px wide
It exits 1 when any of them is not zero. The pitch deck's own tables live in a shadow root and are not looked at.
"""
import argparse
import sys
from playwright.sync_api import sync_playwright

TABS = ['Start', 'Deal', 'Top sheet & budget', 'Stripboard', 'Calendar', 'Call sheets', 'Breakdowns',
        'Points & waterfall', 'SAG tier', 'Incentives', 'Pitch', 'About']

MEASURE = r"""() => {
  const vw = document.documentElement.clientWidth;
  const shown = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const where = el => { const t = el.closest('table'); const p = t.closest('.panel, details, section, .modal-card');
    const h = p?.querySelector('h2, summary')?.textContent?.trim().slice(0, 28) ?? ''; return `table.${t.className || '-'} in "${h}"`; };
  const crushed = [], broken = [], fields = [];
  let tables = 0, cells = 0;
  for (const table of document.querySelectorAll('table')) {
    if (!shown(table)) continue; tables++;
    const drawn = c => { const h = c.closest('thead, tr'); return !h || getComputedStyle(c.closest('thead') ?? h).position !== 'absolute'; };   // a heading kept only for screen readers is not drawn
    for (const cell of table.querySelectorAll('th, td')) {
      if (cell.closest('table') !== table || !shown(cell) || !drawn(cell)) continue; cells++;
      const text = [...cell.childNodes].some(n => n.nodeType === 1 && n.tagName === 'TABLE') ? '' : cell.innerText.trim();
      const w = cell.getBoundingClientRect().width;
      if (w < 30 && text.length >= 4) crushed.push(`${Math.round(w)}px "${text.slice(0, 16)}" ${where(cell)}`);
      // every word, as it is drawn: one that is on two lines was broken in the middle
      const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        if (node.parentElement.closest('table') !== table || node.parentElement.closest('select, option, textarea')) continue;
        for (const m of node.data.matchAll(/\S+/g)) {
          if (m[0].length < 2) continue;
          const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
          const tops = new Set([...r.getClientRects()].filter(b => b.width > 0).map(b => Math.round(b.top)));
          if (tops.size > 1) broken.push(`"${m[0].slice(0, 16)}" on ${tops.size} lines, ${where(cell)}`);
        }
      }
      for (const f of cell.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="hidden"]), select')) {
        const fw = f.getBoundingClientRect().width; if (shown(f) && fw < 40) fields.push(`${Math.round(fw)}px ${f.tagName.toLowerCase()} "${(f.getAttribute('aria-label') || f.value || '').slice(0, 16)}" ${where(cell)}`);
      }
    }
  }
  return { over: document.documentElement.scrollWidth - vw, tables, cells, crushed, broken, fields };
}"""

OPEN_FOLDS = "() => { for (const d of document.querySelectorAll('main details')) d.open = true; }"


def open_everything(page):
    page.evaluate(OPEN_FOLDS)
    page.wait_for_timeout(250)


def press(page, name):
    page.get_by_role('button', name=name, exact=True).first.click()
    page.wait_for_timeout(350)


def states(page, label):
    """Every state of a tab that puts another table on the page: yields a name once the page is in that state."""
    open_everything(page)
    if label == 'Top sheet & budget':
        # a category, then the first account in it, so the lines with their fields are on the page
        page.locator('tr.cat td:first-child').first.click()
        page.wait_for_timeout(150)
        page.locator('tr.acct td:first-child').first.click()
        page.wait_for_timeout(250)
        yield label
        press(page, 'Edit accounts')
        yield label + ' (editing accounts)'
        return
    yield label
    if label == 'Stripboard':
        page.locator('button[title="open the full day-out-of-days"]').click()
        page.wait_for_timeout(350)
        yield label + ' (day out of days, popped out)'
        page.keyboard.press('Escape')
        if page.locator('.modal').count():
            page.locator('.modal-card button', has_text='close').first.click()
    if label == 'Calendar' and page.locator('.shootchip').count():
        page.locator('.shootchip').first.click()
        page.wait_for_timeout(350)
        yield label + ' (a shoot day, popped out)'
        page.keyboard.press('Escape')
    if label == 'Breakdowns':
        for mode in ('By character', 'By department', 'Track one thing'):
            press(page, mode)
            yield f'{label} ({mode.lower()})'
        page.locator('.ctl select').last.select_option(index=0)
        page.wait_for_timeout(350)
        yield label + ' (track one thing, all of a category)'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:4411')
    ap.add_argument('--width', type=int, default=390)
    ap.add_argument('--height', type=int, default=844)
    ap.add_argument('--shots', default='')
    a = ap.parse_args()
    bad = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome')
        page = browser.new_context(viewport={'width': a.width, 'height': a.height}).new_page()
        page.goto(a.url)
        page.get_by_role('button', name='Load the sample').click()
        page.wait_for_timeout(600)
        for label in TABS:
            page.get_by_role('button', name=label, exact=True).click()
            page.wait_for_timeout(400)
            for state in states(page, label):
                r = page.evaluate(MEASURE)
                n = (r['over'] > 1) + len(r['crushed']) + len(r['broken']) + len(r['fields'])
                bad += n
                print(f"{'ok  ' if not n else 'FAIL'} {state}: {r['tables']} tables, {r['cells']} cells, over {r['over']}px, "
                      f"crushed {len(r['crushed'])}, broken {len(r['broken'])}, fields {len(r['fields'])}")
                for kind in ('crushed', 'broken', 'fields'):
                    seen = {}
                    for line in r[kind]:
                        seen.setdefault(line.split(' table.')[-1], []).append(line)
                    for lines in seen.values():
                        print(f"       {kind} x{len(lines)}: {lines[0]}")
                if a.shots:
                    name = ''.join(c if c.isalnum() else '-' for c in state.lower()).strip('-')
                    page.screenshot(path=f"{a.shots}/{a.width}-{name}.png", full_page=True)
        browser.close()
    print('all clear' if not bad else f'{bad} to fix')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
