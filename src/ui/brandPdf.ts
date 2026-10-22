// A brand-system PDF in the browser: its text (for the colours and faces) and, if asked, its pages as pictures.
async function pdfjsLib() {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const src = (await import('pdfjs-dist/build/pdf.worker.min.mjs?raw')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  }
  return pdfjs;
}

/** The document's text, one line per visual line, pages in order. */
export async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await pdfjsLib();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.flatMap((it: any) => it.str !== undefined && it.transform ? [{ x: it.transform[4] as number, y: it.transform[5] as number, s: it.str as string }] : []);
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of items) { if (!it.s.trim()) continue; const k = Math.round(it.y / 3) * 3; (rows.get(k) ?? rows.set(k, []).get(k)!).push(it); }
    for (const [, row] of [...rows.entries()].sort((a, b) => b[0] - a[0])) out.push(row.sort((a, b) => a.x - b.x).map(r => r.s).join(' ').replace(/\s+/g, ' ').trim());
    out.push('');
  }
  return out.join('\n');
}

/** Pages rendered to JPEG data URLs at `width` px, for the look book's references. */
export async function pdfPages(data: ArrayBuffer, width = 1600, max = 20): Promise<string[]> {
  const pdfjs = await pdfjsLib();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const out: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, max); p++) {
    const page = await doc.getPage(p);
    const v1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / v1.width });
    const c = document.createElement('canvas'); c.width = Math.round(viewport.width); c.height = Math.round(viewport.height);
    await page.render({ canvasContext: c.getContext('2d')!, viewport }).promise;
    out.push(c.toDataURL('image/jpeg', 0.8));
  }
  return out;
}
