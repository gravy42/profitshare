import type { ScriptLine } from './screenplay';

/** A screenplay PDF → positioned lines for parseScreenplayLines. Uses pdf.js in the browser (loaded on first use,
 *  worker spun up from an inline blob so it works from the single-file build too). Each text item's position on the
 *  page gives the line its indent (points from the left edge) and its place down the page, which is what the
 *  breakdown needs to tell character cues from action and to measure scenes in eighths. */
export async function pdfScriptLines(data: ArrayBuffer): Promise<ScriptLine[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const src = (await import('pdfjs-dist/build/pdf.worker.min.mjs?raw')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  }
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: { items: { x: number; y: number; w: number; s: string }[]; height: number }[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.flatMap((it: any) => it.str !== undefined && it.transform ? [{ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str as string }] : []);
    pages.push({ items, height: page.view[3] - page.view[1] });
  }
  return linesFromPdfItems(pages);
}

/** Pure part, so it can be tested without pdf.js: group items into lines by page and baseline, order by x. */
export function linesFromPdfItems(pages: { items: { x: number; y: number; w: number; s: string }[]; height: number }[]): ScriptLine[] {
  const out: ScriptLine[] = [];
  const allLines: { page: number; y: number; x: number; text: string }[][] = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const { items } = pages[pi];
    const rows = new Map<number, { x: number; w: number; s: string }[]>();
    for (const it of items) {
      if (!it.s.trim()) continue;
      const key = Math.round(it.y / 3) * 3;
      const row = rows.get(key) ?? [];
      row.push(it); rows.set(key, row);
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([y, row]) => {
      row.sort((a, b) => a.x - b.x);
      let text = '', end = -1;
      for (const it of row) {
        if (end >= 0 && it.x - end > 2 && !text.endsWith(' ') && !it.s.startsWith(' ')) text += ' ';
        text += it.s; end = it.x + it.w;
      }
      return { page: pi, y, x: row[0].x, text: text.replace(/\s+/g, ' ').trim() };
    }).filter(l => l.text);
    allLines.push(lines);
  }
  // the text block: where the body sits on the page, taken across the whole document so a short page
  // (end of a scene, then a page break) still counts as a full page
  const ys = allLines.flat().filter(l => !/^\d{1,3}\.?$/.test(l.text)).map(l => l.y).sort((a, b) => a - b);
  if (!ys.length) return out;
  const top = ys[Math.floor(ys.length * 0.995)], bottom = ys[Math.floor(ys.length * 0.005)];
  const span = Math.max(top - bottom, 1);
  allLines.forEach((lines, pi) => {
    // the page number the script prints, if any (a bare number at the top of the page)
    const label = lines.slice(0, 2).find(l => /^\d{1,3}\.?$/.test(l.text))?.text.replace('.', '') ?? String(pi + 1);
    let prevY = Infinity;
    for (const l of lines) {
      // a gap of more than one line height is a blank line, which the parser uses to find cue shapes
      if (prevY !== Infinity && prevY - l.y > 18) out.push({ text: '', pos: pi + (top - l.y) / span, indent: 0, page: label });
      out.push({ text: l.text, pos: pi + Math.min(1, Math.max(0, (top - l.y) / span)), indent: Math.round(l.x), page: label });
      prevY = l.y;
    }
  });
  return out;
}
