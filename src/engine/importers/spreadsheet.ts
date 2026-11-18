import { parseDelimited } from './delimited';
import { LIMITS, newBudget, SpreadsheetError, tooBig, type Cell, type Workbook } from './sheetLimits';
import { readXlsx } from './xlsxReader';

export { LIMITS, SpreadsheetError } from './sheetLimits';
export type { Cell, SheetRows, Workbook } from './sheetLimits';

/** Read a budget spreadsheet a user dropped: an Excel .xlsx workbook, or delimited text (.csv, .tsv, .txt).
 *  What the file is gets decided from its first bytes, not its name, so a .csv renamed .xlsx still opens and an
 *  .xlsx renamed .csv does too. Old binary Excel (.xls) is recognised and refused with a way forward.
 *  Every failure is a SpreadsheetError whose message is meant to be shown to the user as it is. */

export const OLD_EXCEL_MESSAGE = 'This is an older Excel file. Open it in Excel or Numbers and save it as .xlsx, then drop it here.';
const PASSWORD_MESSAGE = 'This Excel file is locked with a password, so it cannot be read. Open it in Excel, remove the password (File, Info, Protect Workbook), save it, and drop it here.';
const NOT_A_SHEET_MESSAGE = 'This file does not look like a spreadsheet. Budgets come in as Excel workbooks (.xlsx) or as .csv.';

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);
const ZIP = [0x50, 0x4b, 0x03, 0x04], ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];      // the container of .xls, and of password-protected .xlsx

/** Does the byte sequence appear in the file? One forward pass. */
function contains(b: Uint8Array, needle: number[]): boolean {
  const first = needle[0];
  outer: for (let i = b.indexOf(first); i >= 0 && i + needle.length <= b.length; i = b.indexOf(first, i + 1)) {
    for (let k = 1; k < needle.length; k++) if (b[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}
const utf16 = (s: string) => { const out: number[] = []; for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i), 0); return out; };

function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);        // drops a UTF-8 byte-order mark
}

export function readSpreadsheet(buf: ArrayBuffer | Uint8Array, filename = ''): Workbook {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length > LIMITS.fileBytes) throw tooBig.file(bytes.length);
  if (startsWith(bytes, ZIP) || startsWith(bytes, ZIP_EMPTY)) return readXlsx(bytes);
  if (startsWith(bytes, OLE)) throw new SpreadsheetError(contains(bytes, utf16('EncryptedPackage')) ? PASSWORD_MESSAGE : OLD_EXCEL_MESSAGE);

  const namedExcel = /\.xlsx?$/i.test(filename);
  const hasBom = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (!hasBom && bytes.subarray(0, 4096).indexOf(0) >= 0) throw new SpreadsheetError(namedExcel && /\.xls$/i.test(filename) ? OLD_EXCEL_MESSAGE : NOT_A_SHEET_MESSAGE);
  const text = decode(bytes);
  if (namedExcel) {
    // Some programs save a web page or an XML document under an Excel name. Excel opens those; we do not.
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    while (i < text.length && (text.charCodeAt(i) === 0x20 || text.charCodeAt(i) === 0x09 || text.charCodeAt(i) === 0x0a || text.charCodeAt(i) === 0x0d)) i++;
    if (text.charCodeAt(i) === 0x3c) throw new SpreadsheetError(OLD_EXCEL_MESSAGE);
  }
  return { sheets: [{ name: 'Sheet1', rows: parseDelimited(text, newBudget()) }] };
}

/** The rows of the sheet with this name, or undefined. (A lookup by comparison, never by property name.) */
export function sheetNamed(wb: Workbook, name: string): Cell[][] | undefined {
  for (const s of wb.sheets) if (s.name === name) return s.rows;
  return undefined;
}

/** Already read, or still the file's bytes? */
export const isWorkbook = (x: ArrayBuffer | Uint8Array | Workbook): x is Workbook => Array.isArray((x as Workbook).sheets);
