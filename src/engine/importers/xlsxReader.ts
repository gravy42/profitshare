import { unzipSync } from 'fflate';
import { chargeGrid, LIMITS, newBudget, SpreadsheetError, tooBig, type Budget, type Cell, type Workbook } from './sheetLimits';
import { decodeXml, rawAttr, scanXml } from './xmlScan';

/** Our own reader for Excel .xlsx workbooks: unzip, then scan four kinds of XML part (the workbook's sheet list, its
 *  relationships, the shared strings, each worksheet). It reads values only. Formulas are never evaluated: a formula
 *  cell gives the result Excel saved with it. Styles, number formats and dates are not interpreted, so a date comes
 *  out as Excel's serial number, as it did before.
 *
 *  The grid it returns for each sheet is what the importers were written against (the old library's
 *  sheet_to_json(sheet, { header: 1, defval: '', raw: true })):
 *    - the grid covers the sheet's declared used range (<dimension ref="A1:P40">) and, when a file has none, the
 *      box around its cells, so a sheet that starts at B3 gives rows that start at B3;
 *    - every row has the full width; an empty cell is ''; blank rows inside the range are kept;
 *    - errors (#DIV/0!, #N/A …) are '' and #NULL! is null; true/false are booleans; numbers are numbers.
 *
 *  Because the file may come from a stranger, nothing in it is ever used as a property name on a plain object
 *  (sheets are an array, relationships and parts are Maps), and sheetLimits.ts caps how much we unpack and build. */

const damaged = () => new SpreadsheetError('This Excel file could not be read: it looks damaged or incomplete. Open it in Excel or Numbers, save it again as .xlsx, and drop the new copy here.');
const notExcel = (what: string) => new SpreadsheetError(`${what} Open it in the app that made it, save or export it as an Excel workbook (.xlsx) or as .csv, and drop that here.`);

// ---- the zip ----

const partKey = (name: string) => (name.charCodeAt(0) === 0x2f ? name.slice(1) : name).toLowerCase();

interface Unpacked { parts: Map<string, Uint8Array>; names: Set<string> }
/** Unpack only the named parts. Sizes are checked from the zip's directory before anything is inflated, and the
 *  inflater is given a buffer of exactly the declared size, so a part cannot grow past what was checked. A stored
 *  (uncompressed) part is copied by its packed size whatever it declares, so the two must agree and the larger is
 *  what gets charged: otherwise many entries declaring 0 bytes could each point at one big block. */
function unpack(zip: Uint8Array, wanted: string[], spent: { bytes: number }): Unpacked {
  const want = new Set(wanted.map(partKey));
  const picked = new Map<string, string>();          // our key -> the entry's own name
  const names = new Set<string>();
  let entries = 0;
  const files = unzipSync(zip, {
    filter: f => {
      if (++entries > LIMITS.zipEntries) throw damaged();
      const key = partKey(f.name);
      if (names.size < LIMITS.zipEntries) names.add(key);
      if (!want.has(key) || picked.has(key) || f.name === '__proto__') return false;
      if (f.compression === 0 && f.size !== f.originalSize) throw damaged();
      spent.bytes += Math.max(f.size, f.originalSize);
      if (!(spent.bytes <= LIMITS.unzippedBytes)) throw tooBig.unzipped();
      picked.set(key, f.name);
      return true;
    },
  });
  const parts = new Map<string, Uint8Array>();
  for (const [key, name] of picked) {
    const data = Object.prototype.hasOwnProperty.call(files, name) ? files[name] : undefined;
    if (data !== undefined) parts.set(key, data);
  }
  return { parts, names };
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

/** "xl/" + "worksheets/sheet1.xml", "xl/" + "../x.xml", "/xl/y.xml" -> a path inside the zip. */
function resolvePart(baseDir: string, target: string): string {
  const out: string[] = [];
  for (const seg of (target.charCodeAt(0) === 0x2f ? target.slice(1) : baseDir + target).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const relsFor = (path: string) => { const d = dirOf(path); return `${d}_rels/${path.slice(d.length)}.rels`; };

// ---- the small parts ----

interface Rel { id: string; type: string; target: string }
function parseRels(xml: string): Rel[] {
  const rels: Rel[] = [];
  scanXml(xml, {
    open(name, from, to) {
      if (name !== 'Relationship') return;
      const id = rawAttr(xml, from, to, 'Id'), target = rawAttr(xml, from, to, 'Target');
      if (id === undefined || target === undefined || rawAttr(xml, from, to, 'TargetMode') === 'External') return;
      if (rels.length >= LIMITS.zipEntries) throw damaged();
      rels.push({ id: decodeXml(id), type: decodeXml(rawAttr(xml, from, to, 'Type') ?? ''), target: decodeXml(target) });
    },
    close() {}, text() {},
  });
  return rels;
}
const isType = (rel: Rel, kind: string) => rel.type.endsWith('/' + kind);

function parseSheetList(xml: string): { name: string; relId: string | undefined }[] {
  const sheets: { name: string; relId: string | undefined }[] = [];
  let inSheets = false;
  scanXml(xml, {
    open(name, from, to) {
      if (name === 'sheets') inSheets = true;
      else if (name === 'sheet' && inSheets) {
        const relId = rawAttr(xml, from, to, 'id', true);
        sheets.push({ name: decodeXml(rawAttr(xml, from, to, 'name') ?? ''), relId: relId === undefined ? undefined : decodeXml(relId) });
        if (sheets.length > LIMITS.sheets) throw tooBig.sheets(sheets.length);
      }
    },
    close(name) { if (name === 'sheets') inSheets = false; },
    text() {},
  });
  return sheets;
}

/** The shared strings, in order. A string is the text of its <t> elements joined (rich text is several runs);
 *  phonetic guides (<rPh>) are left out. Spaces are kept exactly as stored, with or without xml:space. */
function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let inSi = false, inT = false, phonetic = 0, cur = '';
  scanXml(xml, {
    open(name) {
      if (name === 'si') { inSi = true; cur = ''; }
      else if (name === 'rPh') phonetic++;
      else if (name === 't' && inSi && phonetic === 0) inT = true;
    },
    close(name) {
      if (name === 't') inT = false;
      else if (name === 'rPh') { if (phonetic > 0) phonetic--; }
      else if (name === 'si' && inSi) {
        inSi = false; inT = false; phonetic = 0;
        if (strings.length >= LIMITS.cells) throw tooBig.cells();
        strings.push(cur);
      }
    },
    text(from, to, raw) { if (inT) cur += raw ? xml.slice(from, to) : decodeXml(xml.slice(from, to)); },
  });
  return strings;
}

// ---- a worksheet ----

interface Box { r0: number; c0: number; r1: number; c1: number }
const BIG = 1e9;   // any row or column number past this is treated as "too far" without growing further

/** "A1:P40" -> a box, zero-based. Null unless it is a well-formed two-corner range. */
function parseDimension(ref: string): Box | null {
  let i = 0;
  const letters = () => { let v = 0, any = false; for (; i < ref.length; i++) { const c = ref.charCodeAt(i) - 64; if (c < 1 || c > 26) break; any = true; if (v < BIG) v = v * 26 + c; } return any ? v - 1 : -1; };
  const digits = () => { let v = 0, any = false; for (; i < ref.length; i++) { const c = ref.charCodeAt(i) - 48; if (c < 0 || c > 9) break; any = true; if (v < BIG) v = v * 10 + c; } return any ? v - 1 : -1; };
  const c0 = letters(), r0 = digits();
  if (ref.charCodeAt(i) !== 0x3a) return null;
  i++;
  const c1 = letters(), r1 = digits();
  if (i !== ref.length || c0 < 0 || r0 < 0 || c1 < c0 || r1 < r0) return null;
  return { r0, c0, r1, c1 };
}

/** An ISO date in a t="d" cell -> Excel's serial day number (days since 30 Dec 1899), read as written, no time zone. */
function isoToSerial(s: string): number | undefined {
  const num = (from: number, len: number) => {
    let v = 0;
    for (let k = from; k < from + len; k++) { const c = s.charCodeAt(k) - 48; if (!(c >= 0 && c <= 9)) return NaN; v = v * 10 + c; }
    return v;
  };
  const y = num(0, 4), mo = num(5, 2), d = num(8, 2);
  if (isNaN(y) || isNaN(mo) || isNaN(d) || s.charCodeAt(4) !== 0x2d || s.charCodeAt(7) !== 0x2d) return undefined;
  let h = 0, mi = 0, sec = 0;
  if (s.charCodeAt(10) === 0x54) {
    h = num(11, 2); mi = num(14, 2);
    if (isNaN(h) || isNaN(mi)) return undefined;
    if (s.charCodeAt(16) === 0x3a) { sec = parseFloat(s.slice(17, 30)); if (!isFinite(sec)) sec = 0; }
  }
  const ms = Date.UTC(y, mo - 1, d, h, mi, 0) + sec * 1000 - Date.UTC(1899, 11, 30);
  return isFinite(ms) ? ms / 86400000 : undefined;
}

function parseSheet(xml: string, strings: string[], sheetName: string, budget: Budget): Cell[][] {
  let dim: Box | null = null, sawData = false, inData = false;
  let rowIdx = -1, colIdx = -1, rowSeen = false, cellSeen = false;
  let minR = BIG, maxR = 0, minC = BIG, maxC = 0;
  const atRow: number[] = [], atCol: number[] = [], values: Cell[] = [];
  // the cell being read
  let inCell = false, cRow = 0, cCol = 0, cType: string | undefined, v: string | null = null, inline: string | null = null, hasFormula = false;
  let inV = false, inIs = false, inT = false, inF = false, phonetic = 0;

  const finishCell = () => {
    const hasV = v !== null && v !== '';
    let type = cType, val: Cell | undefined;
    if (type === undefined) {
      if (hasV) type = 'n';
      else if (!hasFormula) return;          // a styled but empty cell: not part of the sheet's extent
      // a formula saved without a result stays blank (it is not ours to work out), but its cell counts as used
    }
    switch (type) {
      case undefined: break;
      case 'n': if (hasV) { const x = parseFloat(v!); if (isFinite(x)) val = x; } break;
      case 's':
        if (hasV) {
          const k = parseInt(v!, 10);
          if (!(k >= 0 && k < strings.length)) throw damaged();
          val = strings[k];
        }
        break;
      case 'str': val = v ?? ''; break;
      case 'inlineStr': val = inline ?? ''; break;
      case 'b': val = v === '1' || v === 'true' || v === 'TRUE'; break;
      case 'e': if (v === '#NULL!') val = null; break;
      case 'd': if (hasV) val = isoToSerial(v!); break;
      default: if (hasV) val = v!;
    }
    if (cRow >= LIMITS.rows) throw tooBig.rows(sheetName);
    if (cCol >= LIMITS.columns) throw tooBig.columns(sheetName);
    cellSeen = true;
    if (cRow < minR) minR = cRow; if (cRow > maxR) maxR = cRow;
    if (cCol < minC) minC = cCol; if (cCol > maxC) maxC = cCol;
    if (val === undefined || val === '') return;
    if (++budget.cells > LIMITS.cells) throw tooBig.cells();
    // Shared strings are held once and cited by many cells, so the text has to be counted where it is used.
    if (typeof val === 'string' && (budget.chars += val.length) > LIMITS.chars) throw tooBig.text();
    atRow.push(cRow); atCol.push(cCol); values.push(val);
  };

  scanXml(xml, {
    open(name, from, to, selfClosing) {
      if (inCell) {
        if (name === 'v' && !inIs) { inV = true; v = v ?? ''; }
        else if (name === 'f' && !inIs) { inF = true; if (selfClosing && rawAttr(xml, from, to, 't') === 'shared') hasFormula = true; }
        else if (name === 'is') { inIs = true; inline = inline ?? ''; }
        else if (name === 'rPh') phonetic++;
        else if (name === 't' && inIs && phonetic === 0) inT = true;
        else if (name === 'c') { finishCell(); inCell = false; }       // a cell inside a cell: not valid; close the outer one
        if (inCell) return;
      }
      if (name === 'c' && inData) {
        let row = rowIdx, col = colIdx + 1;
        const ref = rawAttr(xml, from, to, 'r');
        if (ref !== undefined) {
          let i = 0, c = 0, r = 0;
          for (; i < ref.length; i++) { const d = ref.charCodeAt(i) - 64; if (d < 1 || d > 26) break; if (c < BIG) c = c * 26 + d; }
          const lettersEnd = i;
          for (; i < ref.length; i++) { const d = ref.charCodeAt(i) - 48; if (d < 0 || d > 9) break; if (r < BIG) r = r * 10 + d; }
          if (lettersEnd > 0 && i > lettersEnd && i === ref.length && r > 0) { row = r - 1; col = c - 1; }
        }
        if (row < 0) row = 0;
        colIdx = col;
        inCell = true; cRow = row; cCol = col; cType = rawAttr(xml, from, to, 't');
        v = null; inline = null; hasFormula = false; inV = inIs = inT = inF = false; phonetic = 0;
      } else if (name === 'row' && inData) {
        const r = rawAttr(xml, from, to, 'r');
        const n = r === undefined ? NaN : parseInt(r, 10);
        rowIdx = n >= 1 ? Math.min(n, BIG) - 1 : rowIdx + 1;
        colIdx = -1;
        if (!selfClosing) {
          if (rowIdx >= LIMITS.rows) throw tooBig.rows(sheetName);
          rowSeen = true;
          if (rowIdx < minR) minR = rowIdx; if (rowIdx > maxR) maxR = rowIdx;
        }
      } else if (name === 'sheetData') { inData = true; sawData = true; }
      else if (name === 'dimension' && !sawData && dim === null) {
        const ref = rawAttr(xml, from, to, 'ref');
        if (ref !== undefined) dim = parseDimension(ref);
      }
    },
    close(name) {
      if (inCell) {
        if (name === 'v') inV = false;
        else if (name === 'f') inF = false;
        else if (name === 't') inT = false;
        else if (name === 'rPh') { if (phonetic > 0) phonetic--; }
        else if (name === 'is') { inIs = false; inT = false; phonetic = 0; }
        else if (name === 'c' || name === 'row' || name === 'sheetData') { finishCell(); inCell = false; }
        if (inCell || name === 'c') return;
      }
      if (name === 'sheetData') inData = false;
    },
    text(from, to, raw) {
      if (!inCell) return;
      if (inV) v += raw ? xml.slice(from, to) : decodeXml(xml.slice(from, to));
      else if (inT) inline += raw ? xml.slice(from, to) : decodeXml(xml.slice(from, to));
      else if (inF && to > from) hasFormula = true;
    },
  });
  if (inCell) finishCell();

  // Which box of the sheet to hand back: the declared used range, widened to take in any cell outside it.
  // A declared range too large to build (a file can claim a million rows and hold ten) is ignored in favour of
  // the box around the cells themselves.
  const cells: Box | null = rowSeen && cellSeen ? { r0: minR, c0: minC, r1: maxR, c1: maxC } : null;
  const declared = dim as Box | null;
  let box: Box | null = cells;
  if (declared) {
    const u: Box = cells
      ? { r0: Math.min(declared.r0, cells.r0), c0: Math.min(declared.c0, cells.c0), r1: Math.max(declared.r1, cells.r1), c1: Math.max(declared.c1, cells.c1) }
      : declared;
    const rows = u.r1 - u.r0 + 1, cols = u.c1 - u.c0 + 1;
    if (rows <= LIMITS.rows && cols <= LIMITS.columns && budget.gridCells + rows * cols <= LIMITS.gridCells) box = u;
  }
  if (!box) return [];
  const nRows = box.r1 - box.r0 + 1, nCols = box.c1 - box.c0 + 1;
  chargeGrid(budget, sheetName, nRows, nCols);
  const grid: Cell[][] = [];
  for (let r = 0; r < nRows; r++) grid.push(new Array<Cell>(nCols).fill(''));
  for (let k = 0; k < values.length; k++) {
    const r = atRow[k] - box.r0, c = atCol[k] - box.c0;
    if (r >= 0 && r < nRows && c >= 0 && c < nCols) grid[r][c] = values[k];
  }
  return grid;
}

// ---- the workbook ----

const DEFAULT_WORKBOOK = 'xl/workbook.xml';

function read(zip: Uint8Array, budget: Budget): Workbook {
  const spent = { bytes: 0 };
  const first = unpack(zip, ['_rels/.rels', DEFAULT_WORKBOOK, relsFor(DEFAULT_WORKBOOK)], spent);
  const text = (u: Unpacked, path: string) => { const d = u.parts.get(partKey(path)); return d === undefined ? undefined : decodeText(d); };

  let wbPath = DEFAULT_WORKBOOK, wbParts = first;
  const rootRels = text(first, '_rels/.rels');
  const office = rootRels === undefined ? undefined : parseRels(rootRels).find(r => isType(r, 'officeDocument'));
  if (office) {
    const p = resolvePart('', office.target);
    if (partKey(p) !== partKey(DEFAULT_WORKBOOK)) { wbPath = p; wbParts = unpack(zip, [p, relsFor(p)], spent); }
  }
  const wbXml = text(wbParts, wbPath);
  if (wbXml === undefined || /\.bin$/i.test(wbPath)) {
    if (first.names.has('xl/workbook.bin') || /\.bin$/i.test(wbPath)) throw notExcel('This is an Excel Binary workbook (.xlsb), which ProfitShare does not read.');
    if (first.names.has('content.xml')) throw notExcel('This looks like an OpenDocument spreadsheet (.ods), which ProfitShare does not read.');
    if (first.names.has('index/document.iwa')) throw notExcel('This is an Apple Numbers file, which ProfitShare does not read.');
    throw notExcel('This file is not an Excel workbook, whatever its name says.');
  }
  const sheetList = parseSheetList(wbXml);
  if (!sheetList.length) throw damaged();
  const relsXml = text(wbParts, relsFor(wbPath));
  const rels = new Map<string, Rel>();
  for (const r of relsXml === undefined ? [] : parseRels(relsXml)) if (!rels.has(r.id)) rels.set(r.id, r);

  const base = dirOf(wbPath);
  const sharedRel = [...rels.values()].find(r => isType(r, 'sharedStrings'));
  const sharedPath = sharedRel ? resolvePart(base, sharedRel.target) : base + 'sharedStrings.xml';
  const sheetPaths = sheetList.map((s, i) => {
    const rel = s.relId === undefined ? undefined : rels.get(s.relId);
    if (!rel) return `${base}worksheets/sheet${i + 1}.xml`;
    return isType(rel, 'worksheet') ? resolvePart(base, rel.target) : null;       // chart sheets and the like have no grid
  });
  // Two sheets naming one part would have it read once per sheet: 200 sheets on one large part is minutes of work.
  const named = sheetPaths.filter((p): p is string => p !== null).map(partKey);
  if (new Set(named).size !== named.length || named.includes(partKey(sharedPath))) throw damaged();
  const second = unpack(zip, [sharedPath, ...sheetPaths.filter((p): p is string => p !== null)], spent);

  const sharedXml = text(second, sharedPath);
  const strings = sharedXml === undefined ? [] : parseSharedStrings(sharedXml);
  return {
    sheets: sheetList.map((s, i) => {
      const path = sheetPaths[i];
      if (path === null) return { name: s.name, rows: [] };
      const xml = text(second, path);
      if (xml === undefined) throw damaged();
      return { name: s.name, rows: parseSheet(xml, strings, s.name, budget) };
    }),
  };
}

/** Read an .xlsx workbook from its bytes. Throws a SpreadsheetError, in plain language, for anything it cannot read. */
export function readXlsx(bytes: Uint8Array, budget: Budget = newBudget()): Workbook {
  if (bytes.length > LIMITS.fileBytes) throw tooBig.file(bytes.length);
  try { return read(bytes, budget); }
  catch (e) {
    if (e instanceof SpreadsheetError) throw e;
    throw damaged();
  }
}
