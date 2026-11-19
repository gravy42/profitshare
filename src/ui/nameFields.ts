/** Names for fields a screen reader would otherwise announce as just "edit text".
 *
 *  Most of the app's fields sit in tables, where the column heading is on screen but not tied to the field, or in a
 *  `.ctl` box whose label is the element before the field. This reads the name a sighted person already sees (the
 *  label beside it, or the column heading and the row it is on) and gives it to the field as `aria-label`.
 *
 *  A field that already has a name of its own (a `<label for>`, a wrapping `<label>`, `aria-label`, `aria-labelledby`
 *  or a `title`) is left alone. Names given here are marked, so they are worked out again when the table changes. */

const AUTO = 'data-autoname';
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function hasOwnName(f: Field): boolean {
  if (f.hasAttribute(AUTO)) return false;
  if (clean(f.getAttribute('aria-label')) || f.getAttribute('aria-labelledby') || clean(f.getAttribute('title')))
    return true;
  if (f.closest('label')) return true;
  if (f.id) {
    for (const l of f.ownerDocument.querySelectorAll('label[for]')) if (l.getAttribute('for') === f.id) return true;
  }
  return false;
}

/** The text a cell shows: its own words, or failing that what is typed or chosen in its first field. */
function cellText(cell: Element | null | undefined, skip?: Element): string {
  if (!cell) return '';
  const copy = cell.cloneNode(true) as Element;
  copy.querySelectorAll('button, select, input, textarea, .hint, small').forEach(n => n.remove());
  const words = clean(copy.textContent);
  if (words) return words;
  for (const f of cell.querySelectorAll<Field>(
    'input:not([type="checkbox"]):not([type="radio"]):not([type="color"]), select, textarea',
  )) {
    if (f === skip) continue;
    const v =
      f instanceof HTMLSelectElement
        ? clean(f.selectedOptions[0]?.textContent)
        : clean(f.value) || clean((f as HTMLInputElement).placeholder);
    if (v) return v;
  }
  return '';
}

/** The heading over a cell, counting colspans, from the last heading row above it. */
function columnHeading(cell: HTMLTableCellElement): string {
  const table = cell.closest('table');
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!table || !row) return '';
  let at = 0;
  for (const c of row.cells) {
    if (c === cell) break;
    at += c.colSpan || 1;
  }
  const heads = [...table.querySelectorAll('thead tr')];
  for (let i = heads.length - 1; i >= 0; i--) {
    let x = 0;
    for (const h of (heads[i] as HTMLTableRowElement).cells) {
      const w = h.colSpan || 1;
      if (at >= x && at < x + w) {
        const t = cellText(h);
        if (t) return t;
        break;
      }
      x += w;
    }
  }
  return '';
}

function rowName(cell: HTMLTableCellElement, field: Field): string {
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!row) return '';
  const th = row.querySelector('th');
  if (th && th !== cell) {
    const t = cellText(th);
    if (t) return t;
  }
  for (const c of row.cells) {
    if (c === cell) continue;
    const t = cellText(c, field);
    if (t) return t;
  }
  return '';
}

function nameFor(f: Field): string {
  const cell = f.closest('td, th') as HTMLTableCellElement | null;
  const own = clean((f as HTMLInputElement).placeholder);
  if (cell) {
    const col = columnHeading(cell);
    const row = rowName(cell, f);
    const several = cell.querySelectorAll('input, select, textarea').length > 1;
    const what = col && several && own ? `${col}, ${own}` : col || own || cellText(cell, f);
    return short([what, row].filter(Boolean).join(', '), 90);
  }
  const box = f.closest('.ctl');
  if (box) {
    const label = [...box.querySelectorAll('label')].find(l => !l.contains(f) && !l.getAttribute('for'));
    const t = cellText(label ?? null);
    if (t) return short(t);
  }
  let prev = f.previousElementSibling;
  while (prev && !/^(LABEL|SPAN|B|STRONG)$/.test(prev.tagName)) prev = prev.previousElementSibling;
  const before = prev && !prev.querySelector('input, select, textarea') ? clean(prev.textContent) : '';
  return short(before || own);
}

/** Give every unnamed field under `root` a name. Returns how many fields still have none. */
export function nameFields(root: ParentNode): number {
  let left = 0;
  for (const f of root.querySelectorAll<Field>('input:not([type="hidden"]), select, textarea')) {
    if (hasOwnName(f)) continue;
    const name = nameFor(f);
    if (!name) {
      left++;
      continue;
    }
    if (f.getAttribute('aria-label') !== name) {
      f.setAttribute('aria-label', name);
      f.setAttribute(AUTO, '');
    }
  }
  return left;
}

/** Keep the names up to date as the page is redrawn. Returns the way to stop. */
export function keepFieldsNamed(root: HTMLElement): () => void {
  let due = 0;
  const run = () => {
    due = 0;
    watch.disconnect();
    try {
      nameFields(root);
    } finally {
      watch.observe(root, { childList: true, subtree: true });
    }
  };
  const watch = new MutationObserver(() => {
    if (!due) due = requestAnimationFrame(run);
  });
  run();
  return () => {
    watch.disconnect();
    if (due) cancelAnimationFrame(due);
  };
}
