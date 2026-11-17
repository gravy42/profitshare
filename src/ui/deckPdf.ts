// The deck as a real 16:9 PDF, built in the browser: each slide is rendered to a picture at 2× and placed on its
// own 13.333 × 7.5 in page. The print dialog was the first export, but Safari ignores a page size set in CSS and
// prints without backgrounds unless told, which turned a midnight deck into gold type on white letter paper.
//
// The photographs do not go through the slide capture. Safari drops images from a captured page (the look slides
// came out as bare headings over midnight), so each slide is captured with its pictures hidden, and the pictures
// are then cropped the way the layout crops them (object-fit: cover) and placed on the page by the PDF library at
// the exact spot the layout gave them. The JPEGs go in as JPEGs, so the file is smaller and the pictures sharper.
// A slide with words over its picture (a cover, a look slide's caption band, the closing sign-off) is captured as a
// PNG on a transparent ground instead, so the ground, then the picture, then the words go down in that order.
import { toJpeg, toPng } from 'html-to-image';
import { PDFDocument, rgb, type PDFImage } from 'pdf-lib';
import { base64, sha256 } from '../deck-runtime/hash';

const W = 13.333 * 72, H = 7.5 * 72;

/** "rgb(9, 40, 39)" as fractions; midnight when the browser gives nothing back. */
const parseRgb = (css: string): [number, number, number] => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css); return m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255] : [0.08, 0.08, 0.1]; };

interface Box { img: HTMLImageElement; x: number; y: number; w: number; h: number }   // fractions of the slide

/** The picture cropped to the box's shape, centred, the way `object-fit: cover` shows it; at most 2 px per CSS px. */
async function cropped(img: HTMLImageElement, wPx: number, hPx: number): Promise<{ data: string; png: boolean }> {
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const scale = Math.max(wPx / nw, hPx / nh);
  const sw = Math.min(nw, wPx / scale), sh = Math.min(nh, hPx / scale);
  const sx = (nw - sw) / 2, sy = (nh - sh) / 2;
  const out = Math.min(1, sw / (wPx * 2));   // never upscale the source
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wPx * 2 * out)); canvas.height = Math.max(1, Math.round(hPx * 2 * out));
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('no canvas');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const png = /^data:image\/png/i.test(img.src);   // a logo keeps its transparency
  return { data: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88), png };
}

/** How a set of slides becomes a PDF. Left out, every option is the report deck's own way. */
export interface SlidesPdfOptions {
  /** Words sit over this slide's picture: it is captured on a transparent ground, and the ground, the picture and the words go down in that order. */
  overlay?: (slide: HTMLElement) => boolean;
  /** @font-face rules for the capture. Given, the page's own stylesheets are not searched for fonts (a face added with the FontFace API is in none of them). */
  fontEmbedCSS?: string;
  /** Stops between slides: the promise rejects with an AbortError. */
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** The file's own details. Given, the PDF says only these (its title, "ProfitShare" as what made it, and this date
   *  as when), so the same slides on the same date are the same bytes. Left out, the PDF library fills them in. */
  meta?: { title: string; date: Date };
}
/** A picture's fingerprint: SHA-256 of the whole data URL, so two pictures share one only by being the same picture. */
export function pictureHash(src: string): string { return base64(sha256(new TextEncoder().encode(src))); }
export const aborted = (): DOMException => new DOMException('Cancelled.', 'AbortError');
/** A moment for the page to draw and take a click (Cancel) between two slow steps. */
const breathe = () => new Promise<void>(r => setTimeout(r, 0));

/** Each slide element on a page of its own, 13.333 x 7.5 in: captured at 2x, its photographs placed by the PDF library. */
export async function slidesToPdf(slides: HTMLElement[], options: SlidesPdfOptions = {}): Promise<Blob> {
  const isOverlay = options.overlay ?? ((el: HTMLElement) => el.matches('.hero, .s-closing'));
  const pdf = await PDFDocument.create(options.meta ? { updateMetadata: false } : undefined);
  if (options.meta) {
    pdf.setTitle(options.meta.title); pdf.setProducer('ProfitShare'); pdf.setCreator('ProfitShare');
    pdf.setCreationDate(options.meta.date); pdf.setModificationDate(options.meta.date);
  }
  const embedded = new Map<string, PDFImage>();
  const hashes = new Map<string, string>();
  const hashOf = (src: string) => { let h = hashes.get(src); if (!h) { h = pictureHash(src); hashes.set(src, h); } return h; };
  for (let i = 0; i < slides.length; i++) {
    if (options.signal?.aborted) throw aborted();
    const el = slides[i];
    const sr = el.getBoundingClientRect();
    const imgs = [...el.querySelectorAll('img')].filter(im => im.src.startsWith('data:'));
    await Promise.all(imgs.map(im => im.decode().catch(() => undefined)));
    const boxes: Box[] = imgs.filter(im => im.naturalWidth > 0).map(im => {
      const r = im.getBoundingClientRect();
      return { img: im, x: (r.left - sr.left) / sr.width, y: (r.top - sr.top) / sr.height, w: r.width / sr.width, h: r.height / sr.height };
    }).filter(b => b.w > 0 && b.h > 0);
    const overlay = isOverlay(el);   // words sit over the picture: ground, picture, then the words
    const ground = parseRgb(getComputedStyle(el).backgroundColor);
    const placed = new Set<Node>(boxes.map(b => b.img));
    for (const b of boxes) b.img.style.visibility = 'hidden';
    if (overlay) el.style.background = 'transparent';
    let data: string;
    const opts = {
      pixelRatio: 2, width: el.offsetWidth, height: el.offsetHeight, style: { transform: 'none', margin: '0' },
      ...(options.fontEmbedCSS != null ? { fontEmbedCSS: options.fontEmbedCSS, filter: (n: Node) => !placed.has(n) } : {}),   // a picture the PDF library places is not carried through the capture as megabytes of text
    };
    try { data = overlay ? await toPng(el, opts) : await toJpeg(el, { ...opts, quality: 0.9, backgroundColor: `rgb(${ground.map(v => Math.round(v * 255)).join(',')})` }); }
    finally { for (const b of boxes) b.img.style.visibility = ''; if (overlay) el.style.background = ''; }
    const page = pdf.addPage([W, H]);
    if (overlay) page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(ground[0], ground[1], ground[2]) });
    else page.drawImage(await pdf.embedJpg(data), { x: 0, y: 0, width: W, height: H });
    for (const b of boxes) {
      const wPx = b.w * sr.width, hPx = b.h * sr.height;
      const key = `${hashOf(b.img.src)}:${Math.round(wPx)}x${Math.round(hPx)}`;
      let pic = embedded.get(key);
      if (!pic) {
        const c = await cropped(b.img, wPx, hPx);
        pic = c.png ? await pdf.embedPng(c.data) : await pdf.embedJpg(c.data);
        embedded.set(key, pic);
      }
      page.drawImage(pic, { x: b.x * W, y: H - (b.y + b.h) * H, width: b.w * W, height: b.h * H });
    }
    if (overlay) page.drawImage(await pdf.embedPng(data), { x: 0, y: 0, width: W, height: H });
    options.onProgress?.(i + 1, slides.length);
    await breathe();
  }
  if (options.signal?.aborted) throw aborted();
  const bytes = await pdf.save();
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/pdf' });
}

/** The report deck (the automatic one on the Pitch tab) as a PDF. */
export function deckToPdf(root: HTMLElement, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  return slidesToPdf([...root.querySelectorAll<HTMLElement>('.slide')], { onProgress });
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
