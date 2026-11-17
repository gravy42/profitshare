// The pure parts of sending a deck: file names, picture sizes, the heavy-file warning, what is said about fonts, and
// the ZIP writer (read back here by walking the archive's own directory). Invented names only.
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/seed';
import { applyDeal } from './deal';
import { withPitch } from './pitch';
import type { Project } from './types';
import { BIG_DOWNLOAD_BYTES, ENDING_MAX, FILE_NAME_MAX, HEAVY_FILE_BYTES, PDF_SLIDE_BYTES, PICTURE_MAX_EDGE, ZIP_NAME_MAX_BYTES, biggestPictures, crc32, dataUrlMime, deckFileName, estimateEverything, estimateText, fitWithin, fontsLeftOut, heavyFileWarning, pictureFormat, sendSummary, zipName, zipStore } from './deckExport';
import { fileSize } from './deckEdit';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('file names', () => {
  it('are the film, "deck", the person and the ask, in lower-case words', () => {
    expect(deckFileName('Salt Flat', 'html')).toBe('salt-flat-deck.html');
    expect(deckFileName('Salt Flat', 'html', { ending: 'ada-example' })).toBe('salt-flat-deck-ada-example.html');
    expect(deckFileName('Salt Flat', 'pdf')).toBe('salt-flat-deck.pdf');
    expect(deckFileName('Salt Flat', 'pdf', { ask: 'with-grants' })).toBe('salt-flat-deck-with-grants.pdf');   // with two asks, a PDF's name always says which
    expect(deckFileName('Salt Flat', 'pdf', { ending: 'ada-example', ask: 'with-grants' })).toBe('salt-flat-deck-ada-example-with-grants.pdf');
    expect(deckFileName('Salt Flat', 'pdf', { ask: 'without-grants' })).toBe('salt-flat-deck-without-grants.pdf');
    expect(deckFileName('Salt Flat', 'pdf', { ending: 'placeholder-fund', ask: 'without-grants' })).toBe('salt-flat-deck-placeholder-fund-without-grants.pdf');
    expect(deckFileName('Salt Flat', 'html', { ending: 'ada-example', ask: 'without-grants' })).toBe('salt-flat-deck-ada-example.html');   // a web deck switches asks itself
    expect(deckFileName('Salt Flat', 'zip')).toBe('salt-flat-deck-files.zip');
  });
  it('are safe whatever the film is called', () => {
    expect(deckFileName('  SÓL: Płaski / "Cut 2"  ', 'html')).toBe('sol-p-aski-cut-2-deck.html');
    expect(deckFileName('', 'pdf')).toBe('film-deck.pdf');
    expect(deckFileName('../../etc/passwd', 'html', { ending: '../x' })).toBe('etc-passwd-deck-x.html');
    expect(deckFileName('x'.repeat(300), 'html').length).toBeLessThanOrEqual(70);
    expect(deckFileName(undefined as unknown as string, 'html')).toBe('film-deck.html');
    // a link ending gives at most 60 characters, and the whole name is never over 120: the film's name gives way
    const long = deckFileName('f'.repeat(300), 'pdf', { ending: 'e'.repeat(300), ask: 'without-grants' });
    expect(long).toBe(`${'f'.repeat(35)}-deck-${'e'.repeat(60)}-without-grants.pdf`);
    expect(long.length).toBe(FILE_NAME_MAX);
    expect(deckFileName('Salt Flat', 'html', { ending: `${'e'.repeat(59)}-x` })).toBe(`salt-flat-deck-${'e'.repeat(59)}.html`);   // never ends on a hyphen
    expect(ENDING_MAX).toBe(60);
  });
});

describe('pictures', () => {
  it('go in at 1,600 px on the long edge at most, the shape kept, never made larger', () => {
    expect(PICTURE_MAX_EDGE).toBe(1600);
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200, scale: 0.4 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600, scale: 0.4 });
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900, scale: 1 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(fitWithin(10_000, 3)).toMatchObject({ width: 1600, height: 1 });
    expect(fitWithin(1601, 1601)).toMatchObject({ width: 1600, height: 1600 });
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0, scale: 1 });
    expect(fitWithin(NaN, Infinity)).toEqual({ width: 0, height: 0, scale: 1 });
    expect(fitWithin(500, 250, 100)).toMatchObject({ width: 100, height: 50 });
  });
  it('are saved as JPEG unless they are see-through', () => {
    expect(pictureFormat('image/jpeg', false)).toBe('image/jpeg');
    expect(pictureFormat('image/jpeg', true)).toBe('image/jpeg');
    expect(pictureFormat('image/png', false)).toBe('image/jpeg');
    expect(pictureFormat('image/png', true)).toBe('image/png');
    expect(pictureFormat('image/webp', true)).toBe('image/png');
    expect(dataUrlMime('data:image/PNG;base64,AAAA')).toBe('image/png');
    expect(dataUrlMime('data:image/svg+xml,<svg/>')).toBe('image/svg+xml');
    expect(dataUrlMime('idb:')).toBe('');
    expect(dataUrlMime('data:text/html;base64,AAAA')).toBe('');
    expect(dataUrlMime(7 as unknown as string)).toBe('');
  });
});

describe('a heavy file', () => {
  const img = (id: string, alt: string, n: number) => ({ id, alt, src: `data:image/jpeg;base64,${'A'.repeat(n)}` });
  const images = [img('a', 'Look book picture', 4_000_000), img('b', 'The flat at dawn', 12_000_000), img('c', 'Dusk', 400), img('d', 'Noon', 8_000_000)];
  it('is said in megabytes, with the biggest pictures named, largest first', () => {
    expect(heavyFileWarning(HEAVY_FILE_BYTES, images)).toBe('');
    expect(heavyFileWarning(1_100_000, images)).toBe('');
    const said = heavyFileWarning(18_400_000, images);
    expect(said).toContain('This file is 18.4 MB.');
    expect(said).toContain('"The flat at dawn" (9.0 MB), "Noon" (6.0 MB), picture 1 of the deck (3.0 MB)');
    expect(heavyFileWarning(16_000_000, [])).toMatch(/^This file is 16\.0 MB\..*send the PDF\.$/);
    expect(biggestPictures(images, 2).map(p => p.id)).toEqual(['b', 'd']);
    expect(biggestPictures(undefined as never)).toEqual([]);
  });
  it('sizes read as people say them', () => {
    expect(fileSize(1_129_612)).toBe('1.1 MB');
    expect(fileSize(999_499)).toBe('999 KB');
    expect(fileSize(15_000_001)).toBe('15.0 MB');
    expect(fileSize(0)).toBe('1 KB');
  });
});

describe('what is said before a file is made', () => {
  const FONT = `data:font/woff2;base64,${'QUJD'.repeat(10)}`;
  const base = (): Project => withPitch(applyDeal(sampleProject()));
  it("names the font files that travel, the app's own typefaces the theme uses, and the files left behind", () => {
    const p = base();
    const q: Project = { ...p, waterfall: { ...p.waterfall, nonRecoupable: 50_000 }, pitch: { ...p.pitch!, lookbook: [{ id: 'x', dataUrl: 'data:image/png;base64,AAAA', caption: '', section: 'tone' }],
      design: { ...p.pitch!.design!, fonts: { title: '', body: 'Georgia, serif' }, fontFiles: [{ id: 'f1', role: 'title', family: 'Licensed Face', dataUrl: FONT, embedOk: true }, { id: 'f2', role: 'body', family: 'Unlicensed Face', dataUrl: FONT, embedOk: false }] } } };
    const s = sendSummary(q);
    expect(s.inside).toEqual(['Licensed Face (your title font file)']);   // the title has its own file, and the body's list ends on a font every computer has
    expect(sendSummary({ ...q, name: 'S\u00f3l P\u0142aski' }).inside).toEqual(['Licensed Face (your title font file)', 'Special Elite']);   // letters the file may lack: the app's face goes too
    expect(fontsLeftOut(q)).toEqual([{ family: 'Unlicensed Face', role: 'body' }]);
    expect(fontsLeftOut({ ...q, pitch: { ...q.pitch!, design: { ...q.pitch!.design!, fontFiles: [null, 7, { id: 'x', role: 'body', family: '', dataUrl: FONT }, { id: 'y', role: 'title', family: 'Gone', dataUrl: 'idb:' }] as never } } })).toEqual([]);
    expect(s.leftOut).toEqual(['Unlicensed Face (your body font file)']);
    expect(s.twoAsks).toBe(true);
    expect(s.slides).toBeGreaterThan(3);
    expect(q.pitch!.lookbook).toHaveLength(1);   // nothing in the project is touched to work it out
  });
  it('says one ask when there are no grants, and survives a project with no pitch', () => {
    const p = base();
    expect(sendSummary({ ...p, waterfall: { ...p.waterfall, nonRecoupable: 0 } }).twoAsks).toBe(false);
    const { pitch: _p, ...bare } = p;
    expect(() => sendSummary(bare as Project)).not.toThrow();
    expect(sendSummary(bare as Project).leftOut).toEqual([]);
  });
});

describe('how big "Download everything" will be', () => {
  const img = (n: number) => ({ id: 'i', alt: '', src: `data:image/jpeg;base64,${'A'.repeat(n)}` });
  it('is each web deck, and each PDF as its slides and one copy of every picture', () => {
    expect(estimateEverything(1_000_000, 3, 6, 7, [])).toBe(3_000_000 + 6 * 7 * PDF_SLIDE_BYTES);
    expect(estimateEverything(1_000_000, 1, 1, 2, [img(400_000), img(800_000)])).toBe(1_000_000 + 2 * PDF_SLIDE_BYTES + 300_000 + 600_000);
    expect(estimateEverything(NaN, 3, -1, 7, undefined as never)).toBe(0);
  });
  it('is said in words, with a warning over 50 MB', () => {
    expect(estimateText(12_054_514, 9)).toEqual({ big: false, text: 'About 12.1 MB in 9 files.' });
    expect(estimateText(900_000, 1).text).toBe('About 900 KB in 1 file.');
    expect(estimateText(BIG_DOWNLOAD_BYTES, 9).big).toBe(false);
    const big = estimateText(BIG_DOWNLOAD_BYTES + 1, 40);
    expect(big.big).toBe(true);
    expect(big.text).toMatch(/^About 50\.0 MB in 40 files\. That is a big download/);
  });
});

describe('CRC-32', () => {
  it('matches the known vectors', () => {
    expect(crc32(bytes(''))).toBe(0);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(Uint8Array.from([0]))).toBe(0xd202ef8d);
    expect(crc32(new Uint8Array(32).fill(0xff))).toBe(0xff6cab0b);
  });
});

/** Reads an archive the way an unzip tool does: the end record, then the directory, then each file where the directory says it is. */
function unzip(zip: Uint8Array): { name: string; data: Uint8Array; crc: number; method: number; flags: number; date: number; time: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true), dirSize = v.getUint32(end + 12, true), dirAt = v.getUint32(end + 16, true);
  expect(v.getUint16(end + 8, true)).toBe(count);
  expect(dirAt + dirSize).toBe(end);
  const out = []; let at = dirAt; const text = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true), time = v.getUint16(at + 12, true), date = v.getUint16(at + 14, true);
    const crc = v.getUint32(at + 16, true), packed = v.getUint32(at + 20, true), size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true), local = v.getUint32(at + 42, true);
    const name = text.decode(zip.subarray(at + 46, at + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint32(local + 14, true)).toBe(crc);
    expect(v.getUint32(local + 18, true)).toBe(packed);
    const lName = v.getUint16(local + 26, true), lExtra = v.getUint16(local + 28, true);
    expect(text.decode(zip.subarray(local + 30, local + 30 + lName))).toBe(name);
    const start = local + 30 + lName + lExtra;
    const raw = zip.subarray(start, start + packed);
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;
    expect(data.length).toBe(size);
    out.push({ name, data, crc, method, flags, date, time });
    at += 46 + nameLen + extra + comment;
  }
  expect(at).toBe(end);
  return out;
}

describe('the ZIP writer', () => {
  const files = [
    { name: 'salt-flat-deck.html', data: bytes('<!doctype html><p>Salt Flat</p>') },
    { name: 'salt-flat-deck-ada-example.pdf', data: Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) & 0xff) },
    { name: 'empty.txt', data: new Uint8Array(0) },
    { name: 'sól-płaski.html', data: bytes('ż') },
  ];
  it('round-trips every file: names, bytes and checksums, read back from the directory', () => {
    const back = unzip(zipStore(files));
    expect(back.map(f => f.name)).toEqual(files.map(f => f.name));
    back.forEach((f, i) => {
      expect([...f.data]).toEqual([...files[i].data]);
      expect(f.crc).toBe(crc32(files[i].data));
      expect(f.method).toBe(0);
      expect(f.flags & 0x0800).toBe(0x0800);   // names are UTF-8
    });
  });
  it('is the same archive for the same files, and carries the date it is given', () => {
    expect([...zipStore(files)]).toEqual([...zipStore(files)]);
    const dated = unzip(zipStore(files, { year: 2031, month: 3, day: 4, hour: 15, minute: 42 }))[0];
    expect(dated.date).toBe(((2031 - 1980) << 9) | (3 << 5) | 4);
    expect(dated.time).toBe((15 << 11) | (42 << 5));
    expect(unzip(zipStore(files))[0].date).toBe((1 << 5) | 1);
    expect(unzip(zipStore([]))).toEqual([]);
    expect(zipStore([]).length).toBe(22);
  });
  it('keeps names inside the archive and apart from each other', () => {
    expect(zipName('../../etc/passwd')).toBe('etc-passwd');
    expect(zipName('C:\\x\\y.html')).toBe('C-x-y.html');
    expect(zipName('..hidden')).toBe('hidden');
    expect(zipName('  ')).toBe('file');
    // never longer than a file system takes, cut between characters, the extension and the number kept
    const long = zipName(`${'\u017c'.repeat(400)}.html`);
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(ZIP_NAME_MAX_BYTES);
    expect(long).toMatch(/^\u017c+\.html$/);
    expect(zipName(`${'\ud83c\udfac'.repeat(100)}.pdf`, '-2')).toMatch(/^(\ud83c\udfac)+-2\.pdf$/);
    const twins = unzip(zipStore([{ name: `${'\u017c'.repeat(400)}.html`, data: bytes('1') }, { name: `${'\u017c'.repeat(400)}.html`, data: bytes('2') }, { name: 'n'.repeat(70_000), data: bytes('3') }]));
    expect(twins.map(f => new TextEncoder().encode(f.name).length <= ZIP_NAME_MAX_BYTES)).toEqual([true, true, true]);
    expect(new Set(twins.map(f => f.name)).size).toBe(3);
    expect(twins[1].name).toMatch(/-2\.html$/);
    expect(twins.map(f => new TextDecoder().decode(f.data))).toEqual(['1', '2', '3']);
    const back = unzip(zipStore([{ name: 'a.html', data: bytes('1') }, { name: 'A.html', data: bytes('2') }, { name: 'a.html', data: bytes('3') }, { name: 'noext', data: bytes('4') }, { name: 'noext', data: bytes('5') }]));
    expect(back.map(f => f.name)).toEqual(['a.html', 'A-2.html', 'a-3.html', 'noext', 'noext-2']);
    expect(back.map(f => new TextDecoder().decode(f.data))).toEqual(['1', '2', '3', '4', '5']);
  });
});
