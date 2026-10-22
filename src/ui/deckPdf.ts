// The deck as a real 16:9 PDF, built in the browser: each slide is rendered to a picture at 2× and placed on its
// own 13.333 × 7.5 in page. The print dialog was the first export, but Safari ignores a page size set in CSS and
// prints without backgrounds unless told, which turned a midnight deck into gold type on white letter paper.
import { toJpeg } from 'html-to-image';
import { PDFDocument } from 'pdf-lib';

const W = 13.333 * 72, H = 7.5 * 72;

export async function deckToPdf(root: HTMLElement, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const slides = [...root.querySelectorAll<HTMLElement>('.slide')];
  const pdf = await PDFDocument.create();
  for (let i = 0; i < slides.length; i++) {
    const el = slides[i];
    const data = await toJpeg(el, { pixelRatio: 2, quality: 0.9, width: el.offsetWidth, height: el.offsetHeight, style: { transform: 'none', margin: '0' } });
    const jpg = await pdf.embedJpg(data);
    const page = pdf.addPage([W, H]);
    page.drawImage(jpg, { x: 0, y: 0, width: W, height: H });
    onProgress?.(i + 1, slides.length);
  }
  const bytes = await pdf.save();
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
