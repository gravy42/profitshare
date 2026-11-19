// The .xlsx writer, read back two ways: by the app's own reader (what an import of the file would see) and by the
// `xlsx` library as an independent referee (tests only; the app does not ship it).
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { unzipSync, strFromU8 } from 'fflate';
import { readSpreadsheet } from '../importers/spreadsheet';
import { cellRef, escapeXml, looksLikeFormula, safeSheetNames, writeXlsx, type SheetSpec } from './xlsxWriter';

const parts = (bytes: Uint8Array) => { const z = unzipSync(bytes); return new Map(Object.keys(z).map(k => [k, strFromU8(z[k])])); };
const referee = (bytes: Uint8Array) => XLSX.read(bytes, { type: 'array', cellStyles: true, cellNF: true });

describe('writeXlsx', () => {
  const sheet: SheetSpec = {
    name: 'Budget',
    rows: [
      ['Account', 'Description', 'Amount', 'Rate', 'Share', 'Paid'],
      ['1101', 'Writer & <director> "fee"', 2, { value: 1234.5, format: 'money' }, { value: 0.125, format: 'percent' }, true],
      ['1102', "it's a line\nwith a break", -3.25, { value: -10, format: 'money' }, null, false],
      ['', undefined, 0, '', { value: 'Total', bold: true }, { value: 1224.5, format: 'money', bold: true }],
    ],
    widths: [10, 40, undefined, 14], freezeRows: 1,
  };
  const bytes = writeXlsx([sheet, { name: 'Empty', rows: [] }], { date: new Date(2030, 0, 2) });

  it('is a zip that starts PK and gives the same bytes for the same date', () => {
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    expect(writeXlsx([sheet, { name: 'Empty', rows: [] }], { date: new Date(2030, 0, 2) })).toEqual(bytes);
  });

  it("comes back through the app's own reader: text, numbers, true and false, and blanks", () => {
    const wb = readSpreadsheet(bytes, 'x.xlsx');
    expect(wb.sheets.map(s => s.name)).toEqual(['Budget', 'Empty']);
    expect(wb.sheets[0].rows).toEqual([
      ['Account', 'Description', 'Amount', 'Rate', 'Share', 'Paid'],
      ['1101', 'Writer & <director> "fee"', 2, 1234.5, 0.125, true],
      ['1102', "it's a line\nwith a break", -3.25, -10, '', false],
      ['', '', 0, '', 'Total', 1224.5],
    ]);
  });

  it('comes back the same through the referee, with money, percentage and bold where they were asked for', () => {
    const wb = referee(bytes);
    expect(wb.SheetNames).toEqual(['Budget', 'Empty']);
    const ws = wb.Sheets.Budget;
    expect(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })).toEqual(readSpreadsheet(bytes).sheets[0].rows);
    expect(ws.D2).toMatchObject({ t: 'n', v: 1234.5, w: '$1,234.50' });
    expect(ws.D3).toMatchObject({ t: 'n', v: -10, w: '-$10.00' });
    expect(ws.E2).toMatchObject({ t: 'n', v: 0.125, w: '12.50%' });
    expect(ws.A2).toMatchObject({ t: 's', v: '1101' });           // an account number written as text stays text
    expect(ws.F2).toMatchObject({ t: 'b', v: true });
    expect(ws['!cols']![0].width).toBe(10); expect(ws['!cols']![1].width).toBe(40); expect(ws['!cols']![3].width).toBe(14);
  });

  it('writes the header row in bold, freezes it, and sets the column widths', () => {
    const p = parts(bytes); const xml = p.get('xl/worksheets/sheet1.xml')!; const styles = p.get('xl/styles.xml')!;
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<col min="2" max="2" width="40" customWidth="1"/>');
    expect(xml).toContain('<dimension ref="A1:F4"/>');
    const xfs = [...styles.matchAll(/<xf numFmtId="(\d+)" fontId="(\d)"[^>]*\/>/g)].slice(1);   // after the one in cellStyleXfs
    const styleOf = (ref: string) => { const s = new RegExp(`<c r="${ref}"(?: s="(\\d+)")?`).exec(xml)![1]; return xfs[Number(s ?? 0)]; };
    expect(styleOf('A1')[2]).toBe('1'); expect(styleOf('F1')[2]).toBe('1');      // bold face
    expect(styleOf('A2')[2]).toBe('0');
    expect(styleOf('F4')[2]).toBe('1'); expect(styleOf('F4')[1]).toBe('164');   // bold money
    expect(styleOf('E2')[1]).toBe('10');
    expect(p.get('xl/worksheets/sheet2.xml')).not.toContain('<pane');
  });

  it('never writes a formula: text that starts with = + - or @ is a text cell, marked as text', () => {
    const risky = ['=1+1', '+1 day', '-10% discount', '@SUM(A1)', '=HYPERLINK("http://example.invalid","x")', '\t=1', '-'];
    const out = writeXlsx([{ name: 'S', rows: risky.map(t => [t, 5, -5]) }]);
    const p = parts(out);
    for (const xml of p.values()) expect(xml).not.toMatch(/<f[ >/]/);
    expect(readSpreadsheet(out).sheets[0].rows.map(r => r[0])).toEqual(risky);
    const ws = referee(out).Sheets.S;
    risky.forEach((t, i) => { const c = ws[`A${i + 1}`]; expect(c.t).toBe('s'); expect(c.v).toBe(t); expect(c.f).toBeUndefined(); });
    expect(ws.C1).toMatchObject({ t: 'n', v: -5 });                 // a negative number is still a number
    // Excel's "this is text" mark, so editing the cell does not turn it into a formula
    const xml = p.get('xl/worksheets/sheet1.xml')!, styles = p.get('xl/styles.xml')!;
    const quoted = [...styles.matchAll(/<xf [^>]*\/>/g)].slice(1).findIndex(x => x[0].includes('quotePrefix="1"'));
    expect(quoted).toBeGreaterThan(0);
    for (let i = 1; i <= risky.length; i++) expect(xml).toContain(`<c r="A${i}" s="${quoted}" t="s">`);
    expect(risky.every(looksLikeFormula)).toBe(true); expect(looksLikeFormula('1-2')).toBe(false);
  });

  it('escapes what XML needs escaped and drops what XML cannot carry', () => {
    const hard = ['a & b < c > d "e" \'f\'', ']]> <!-- x --> <c r="A1"><f>1</f></c>', 'tab\there', 'nul\u0000 bell\u0007 esc\u001b gone', 'lone \ud800 half', 'emoji 🎬 kept', 'literal _x000D_ stays', 'carriage\r\nreturn', '  spaces kept  ', 'é ü 漢字'];
    const out = writeXlsx([{ name: 'S', rows: hard.map(t => [t]) }]);
    const expected = ['a & b < c > d "e" \'f\'', ']]> <!-- x --> <c r="A1"><f>1</f></c>', 'tab\there', 'nul bell esc gone', 'lone  half', 'emoji 🎬 kept', 'literal _x000D_ stays', 'carriage\r\nreturn', '  spaces kept  ', 'é ü 漢字'];
    expect(readSpreadsheet(out).sheets[0].rows.map(r => r[0])).toEqual(expected);
    expect(XLSX.utils.sheet_to_json<string[]>(referee(out).Sheets.S, { header: 1, raw: true }).map(r => r[0])).toEqual(expected);
    expect(escapeXml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  });

  it('leaves a number Excel cannot hold as an empty cell', () => {
    const out = writeXlsx([{ name: 'S', rows: [[1, Infinity, NaN, -Infinity, 2, 1e21, 0.1 + 0.2]] }]);
    expect(readSpreadsheet(out).sheets[0].rows[0]).toEqual([1, '', '', '', 2, 1e21, 0.1 + 0.2]);
    expect(XLSX.utils.sheet_to_json(referee(out).Sheets.S, { header: 1, defval: '', raw: true })[0]).toEqual([1, '', '', '', 2, 1e21, 0.1 + 0.2]);
  });

  it('gives every sheet a name Excel accepts', () => {
    expect(safeSheetNames(['Top sheet', 'A/B\\C?D*E[F]G:H', "'quoted'", '', '   ', 'x'.repeat(40), 'Budget', 'budget', 'BUDGET', 'History']))
      .toEqual(['Top sheet', 'A B C D E F G H', 'quoted', 'Sheet4', 'Sheet5', 'x'.repeat(31), 'Budget', 'budget (2)', 'BUDGET (3)', 'History_']);
    const long = 'y'.repeat(31);
    const names = safeSheetNames([long, long, long]);
    expect(names).toEqual([long, 'y'.repeat(27) + ' (2)', 'y'.repeat(27) + ' (3)']);
    expect(names.every(n => n.length <= 31)).toBe(true);
    const out = writeXlsx([{ name: 'Salt Flat: the <budget> & "more" / everything in it', rows: [['a']] }, { name: 'Salt Flat: the <budget> & "more" / everything in it', rows: [['b']] }]);
    const want = ['Salt Flat the <budget> & "more"', 'Salt Flat the <budget> & "m (2)'];
    expect(readSpreadsheet(out).sheets.map(s => s.name)).toEqual(want);
    expect(referee(out).SheetNames).toEqual(want);
  });

  it('writes a workbook that opens even with no sheets or no rows', () => {
    expect(readSpreadsheet(writeXlsx([])).sheets.map(s => s.name)).toEqual(['Sheet1']);
    expect(referee(writeXlsx([])).SheetNames).toEqual(['Sheet1']);
  });

  it('names columns past Z', () => {
    expect([cellRef(0, 0), cellRef(4, 25), cellRef(0, 26), cellRef(9, 701), cellRef(0, 702)]).toEqual(['A1', 'Z5', 'AA1', 'ZZ10', 'AAA1']);
  });
});
