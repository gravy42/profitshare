import { strToU8, zipSync } from 'fflate';

/** Our own writer for Excel .xlsx workbooks, the other half of importers/xlsxReader.ts: sheets of rows of cells, zipped
 *  with fflate. It writes values and a little formatting (money, percentages, bold, column widths, a frozen header)
 *  and nothing else: no formulas, no dates, no merged cells.
 *
 *  It never writes a formula, on purpose. A budget carries text other people typed (a line called "=SUM(A1)" or
 *  "+1 day", an imported description), and a spreadsheet that runs that text as a formula can be made to leak or
 *  fetch things. Every piece of text goes out as a text cell, and text that starts the way a formula does (= + - @)
 *  also carries Excel's own "this is text" mark, so it stays text even when someone edits the cell and presses Enter. */

export type CellFormat = 'general' | 'money' | 'percent';
export type CellValue = string | number | boolean | null | undefined;
/** A cell with formatting. `percent` takes a fraction (0.1 shows as 10.00%). */
export interface StyledCell { value: CellValue; format?: CellFormat; bold?: boolean }
export type SheetCell = CellValue | StyledCell;

export interface SheetSpec {
  name: string;
  rows: SheetCell[][];
  /** Column widths in characters, by column. A column with no width keeps Excel's default. */
  widths?: (number | undefined)[];
  /** Rows at the top that stay put while the rest scrolls (1 = the header row). */
  freezeRows?: number;
  /** Rows at the top written in bold. Defaults to `freezeRows`. */
  headerRows?: number;
}

// ---- text ----

/** Characters XML 1.0 cannot carry at all (most control characters, the two "not a character" code points) and half
 *  of a surrogate pair on its own. They are dropped: a file with one of them in it does not open. */
function cleanText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    if (c === 0xfffe || c === 0xffff) continue;
    out += s[i];
  }
  return out;
}

/** Text made safe to sit inside an XML element or attribute. */
export function escapeXml(s: string): string {
  return cleanText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** The text of a cell. Excel reads "_x000D_" inside a string as a character code, so text that happens to contain
 *  that pattern has its underscore written the long way, and a carriage return (which XML would turn into a line
 *  feed) is written as its code. */
function cellText(s: string): string {
  return escapeXml(s.replace(/_(?=x[0-9A-Fa-f]{4}_)/g, '_x005F_')).replace(/\r/g, '_x000D_');
}

/** Does this text start the way a formula does? (A tab or a carriage return in front counts too: some programs skip them.) */
export const looksLikeFormula = (s: string) => /^[=+\-@\t\r]/.test(s);

// ---- sheet names ----

/** A name Excel accepts for a sheet: none of \ / ? * [ ] :, no apostrophe at either end, at most 31 characters,
 *  never blank, and never the same as an earlier sheet (Excel compares them without regard to case). */
export function safeSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    let base = cleanText(String(raw ?? '')).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
    base = [...base].slice(0, 31).join('').trim();
    if (!base) base = `Sheet${i + 1}`;
    if (base.toLowerCase() === 'history') base = 'History_';      // a name Excel keeps for itself
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const tail = ` (${n})`;
      name = [...base].slice(0, 31 - tail.length).join('').trim() + tail;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// ---- cells ----

/** A1, B1 … Z1, AA1. */
export function cellRef(row: number, col: number): string {
  let s = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s + (row + 1);
}

const isStyled = (c: SheetCell): c is StyledCell => typeof c === 'object' && c !== null;

const MONEY_FORMAT_ID = 164;                                         // the first number Excel leaves for a workbook's own formats
const MONEY_FORMAT = '"$"#,##0.00;-"$"#,##0.00';
const PERCENT_FORMAT_ID = 10;                                        // Excel's built-in 0.00%
const FORMAT_ID: Record<CellFormat, number> = { general: 0, money: MONEY_FORMAT_ID, percent: PERCENT_FORMAT_ID };

/** The workbook's cell styles, made as they are asked for. Style 0 is the plain one every workbook must have. */
class Styles {
  private ids = new Map<string, number>([['general|0|0', 0]]);
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  id(format: CellFormat, bold: boolean, quote: boolean): number {
    const key = `${format}|${bold ? 1 : 0}|${quote ? 1 : 0}`;
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.xfs.length;
      this.ids.set(key, id);
      this.xfs.push(`<xf numFmtId="${FORMAT_ID[format]}" fontId="${bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"${format !== 'general' ? ' applyNumberFormat="1"' : ''}${bold ? ' applyFont="1"' : ''}${quote ? ' quotePrefix="1"' : ''}/>`);
    }
    return id;
  }
  xml(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<numFmts count="1"><numFmt numFmtId="${MONEY_FORMAT_ID}" formatCode="${escapeXml(MONEY_FORMAT)}"/></numFmts>`
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>';
  }
}

/** Every piece of text in the workbook, written once and pointed at by number. */
class SharedStrings {
  private index = new Map<string, number>();
  private list: string[] = [];
  private uses = 0;
  id(s: string): number {
    this.uses++;
    let i = this.index.get(s);
    if (i === undefined) { i = this.list.length; this.index.set(s, i); this.list.push(s); }
    return i;
  }
  xml(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.uses}" uniqueCount="${this.list.length}">`
      + this.list.map(s => `<si><t xml:space="preserve">${cellText(s)}</t></si>`).join('')
      + '</sst>';
  }
}

function sheetXml(sheet: SheetSpec, styles: Styles, strings: SharedStrings): string {
  const header = Math.max(0, sheet.headerRows ?? sheet.freezeRows ?? 0);
  const freeze = Math.max(0, Math.floor(sheet.freezeRows ?? 0));
  let width = 0;
  const rows: string[] = [];
  sheet.rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((cell, c) => {
      const value = isStyled(cell) ? cell.value : cell;
      const format = (isStyled(cell) && cell.format) || 'general';
      const bold = (isStyled(cell) && cell.bold) || r < header;
      const ref = cellRef(r, c);
      let xml = '';
      if (typeof value === 'number') {
        // a number Excel cannot hold (infinity, not-a-number) is left as an empty cell, never written as text that looks like one
        if (Number.isFinite(value)) { const s = styles.id(format, bold, false); xml = `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${value}</v></c>`; }
      } else if (typeof value === 'boolean') {
        const s = styles.id('general', bold, false);
        xml = `<c r="${ref}"${s ? ` s="${s}"` : ''} t="b"><v>${value ? 1 : 0}</v></c>`;
      } else if (typeof value === 'string' && value !== '') {
        // always a text cell (t="s"), whatever it starts with: this writer has no way to write a formula
        const s = styles.id('general', bold, looksLikeFormula(value));
        xml = `<c r="${ref}"${s ? ` s="${s}"` : ''} t="s"><v>${strings.id(value)}</v></c>`;
      }
      if (xml) { cells.push(xml); if (c + 1 > width) width = c + 1; }
    });
    if (cells.length) rows.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  });
  const last = Math.max(1, sheet.rows.length);
  const cols = (sheet.widths ?? []).map((w, i) => w && w > 0 ? `<col min="${i + 1}" max="${i + 1}" width="${Math.min(255, Math.round(w * 100) / 100)}" customWidth="1"/>` : '').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<dimension ref="A1:${cellRef(last - 1, Math.max(1, width) - 1)}"/>`
    + '<sheetViews><sheetView workbookViewId="0">'
    + (freeze ? `<pane ySplit="${freeze}" topLeftCell="${cellRef(freeze, 0)}" activePane="bottomLeft" state="frozen"/>` : '')
    + '</sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${rows.join('')}</sheetData>`
    + '</worksheet>';
}

/** The bytes of an .xlsx workbook with these sheets, in this order. `date` is the time stamped on the parts inside
 *  the file (give one to get the same bytes twice). */
export function writeXlsx(sheets: SheetSpec[], opts: { date?: Date } = {}): Uint8Array {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }];   // a workbook with no sheet does not open
  const names = safeSheetNames(list.map(s => s.name));
  const styles = new Styles(), strings = new SharedStrings();
  const sheetParts = list.map(s => sheetXml(s, styles, strings));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'http://schemas.openxmlformats.org';
  const files: Record<string, string> = {
    '[Content_Types].xml': head + `<Types xmlns="${NS}/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheetParts.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + '</Types>',
    '_rels/.rels': head + `<Relationships xmlns="${NS}/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + '</Relationships>',
    'xl/workbook.xml': head + `<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships">`
      + '<bookViews><workbookView/></bookViews>'
      + `<sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
      + '</workbook>',
    'xl/_rels/workbook.xml.rels': head + `<Relationships xmlns="${NS}/package/2006/relationships">`
      + sheetParts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheetParts.length + 1}" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId${sheetParts.length + 2}" Type="${NS}/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
      + '</Relationships>',
    'xl/styles.xml': styles.xml(),
    'xl/sharedStrings.xml': strings.xml(),
  };
  sheetParts.forEach((xml, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = xml; });
  // the zip format can only stamp a time from 1980 to 2099
  const mtime = opts.date && opts.date.getFullYear() >= 1980 && opts.date.getFullYear() < 2100 ? opts.date : new Date();
  const zipped: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const [name, text] of Object.entries(files)) zipped[name] = [strToU8(text), { mtime }];
  return zipSync(zipped, { level: 6 });
}
