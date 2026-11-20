// Noto Sans, regular and bold, for a budget PDF with letters Helvetica lacks (Greek, Cyrillic, Vietnamese, Polish...).
// The files are the app's own (src/assets/fonts/noto-sans/, SIL Open Font License 1.1, licence beside them), fetched
// only when such a PDF is made: from the app's own address, or from inside the page in the one-file build.
import regularUrl from '../assets/fonts/noto-sans/NotoSans-Regular.ttf?url';
import boldUrl from '../assets/fonts/noto-sans/NotoSans-Bold.ttf?url';
import type { PdfFaces } from '../engine/exporters/budgetExport';

const read = async (url: string): Promise<Uint8Array> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not read ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

export async function notoSans(): Promise<PdfFaces> {
  const [regular, bold] = await Promise.all([read(regularUrl), read(boldUrl)]);
  return { regular, bold };
}
