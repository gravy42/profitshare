// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, unzipSync, strToU8, type Zippable } from 'fflate';
const unzipParts = (z: Uint8Array) => unzipSync(z);
import * as XLSX from 'xlsx'; // dev dependency only: writes fixtures and is the reference the reader is checked against
import {
  readSpreadsheet,
  sheetNamed,
  LIMITS,
  OLD_EXCEL_MESSAGE,
  SpreadsheetError,
  type Cell,
  type Workbook,
} from './spreadsheet';
import { readXlsx } from './xlsxReader';
import { parseDelimited, guessSeparator } from './delimited';
import { decodeXml, scanXml } from './xmlScan';
import { parseBudgetFile } from './budget';
import { parseShamelXlsx } from './shamelXlsx';

// ---------------------------------------------------------------------------------------------------------------
// The reference: what the importers got from the old library, with the options they passed.
// ---------------------------------------------------------------------------------------------------------------
const OLD_OPTS = { header: 1, defval: '', raw: true } as const;
const oldSheets = (wb: XLSX.WorkBook) =>
  wb.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], OLD_OPTS) }));
const oldXlsx = (bytes: Uint8Array) => oldSheets(XLSX.read(bytes, { type: 'array' }));
const oldCsv = (text: string) => oldSheets(XLSX.read(text, { type: 'string', raw: true }))[0].rows;
const sameAsOld = (bytes: Uint8Array) => {
  const mine = readXlsx(bytes).sheets;
  expect(mine).toEqual(oldXlsx(bytes));
  return mine;
};

const fixtureDir = resolve(process.cwd(), 'tools/fixtures');
const fixture = (f: string) => new Uint8Array(readFileSync(resolve(fixtureDir, f)));
const written = (wb: XLSX.WorkBook, opts: XLSX.WritingOptions = {}) =>
  new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', ...opts }) as ArrayBuffer);
const book = (sheets: [string, XLSX.WorkSheet][]) => {
  const wb = XLSX.utils.book_new();
  for (const [n, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, n);
  return wb;
};
const aoa = (rows: unknown[][], opts?: XLSX.AOA2SheetOpts & { origin?: string | { r: number; c: number } }) =>
  XLSX.utils.aoa_to_sheet(rows, opts);

/** A fixed-seed generator so the "many workbooks" tests are the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A hand-made .xlsx: the smallest set of parts a workbook needs, with the worksheet XML given by the test.
const CT =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>SHEETS<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>';
const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const sheetXml = (data: string, before = '') =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${NS}>${before}<sheetData>${data}</sheetData></worksheet>`;
function handMade(sheets: { name: string; xml: string }[], sst?: string, extra: Zippable = {}): Uint8Array {
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      CT.replace(
        'SHEETS',
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join(''),
      ),
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook ${NS}><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${RT}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="${RT}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml);
  });
  if (sst !== undefined)
    files['xl/sharedStrings.xml'] = strToU8(
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sst}</sst>`,
    );
  return zipSync({ ...files, ...extra });
}
const one = (data: string, sst?: string, before = '') =>
  handMade([{ name: 'Sheet1', xml: sheetXml(data, before) }], sst);
const message = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SpreadsheetError);
    return (e as Error).message;
  }
  throw new Error('expected a SpreadsheetError');
};

// ---------------------------------------------------------------------------------------------------------------
describe('the .xlsx reader gives the importers the rows the old library gave them', () => {
  const xlsxFixtures = readdirSync(fixtureDir).filter(f => /\.xlsx$/i.test(f));
  it('finds the repo fixtures', () => {
    expect(xlsxFixtures.length).toBeGreaterThanOrEqual(2);
  });
  for (const f of xlsxFixtures)
    it(`fixture ${f}`, () => {
      const sheets = sameAsOld(fixture(f));
      expect(sheets.length).toBeGreaterThan(0);
      expect(sheets.some(s => s.rows.length > 1)).toBe(true);
    });

  it('strings, numbers, booleans, blanks and blank rows', () => {
    const rows = [
      ['Acct', 'Description', 'Amount', 'Rate', 'Total', 'Paid'],
      ['1100', 'Story rights', 1, 2500, 2500, true],
      [],
      ['1200', '', 0, 0.125, -3.5e-7, false],
      [null, 'Only a description'],
      ['', '', '', '', '', ''],
      ['2000', 'Line with a trailing blank', 3, undefined, 1e15, null],
    ];
    for (const bookSST of [false, true]) sameAsOld(written(book([['Details', aoa(rows)]]), { bookSST }));
  });

  it('sparse sheets: cells far apart, a sheet that does not start at A1, an empty sheet', () => {
    const sparse: XLSX.WorkSheet = {
      '!ref': 'B3:H12',
      B3: { t: 's', v: 'corner' },
      H12: { t: 'n', v: 12 },
      D7: { t: 'b', v: true },
    };
    const offset = aoa(
      [
        ['x', 1],
        ['y', 2],
      ],
      { origin: 'C4' },
    );
    const empty: XLSX.WorkSheet = {};
    const single: XLSX.WorkSheet = { '!ref': 'A1', A1: { t: 's', v: 'alone' } };
    const lateOnly: XLSX.WorkSheet = { '!ref': 'F20', F20: { t: 'n', v: 20 } };
    const sheets = sameAsOld(
      written(
        book([
          ['Sparse', sparse],
          ['Offset', offset],
          ['Empty', empty],
          ['Single', single],
          ['Late', lateOnly],
        ]),
      ),
    );
    expect(sheets[0].rows.length).toBe(10);
    expect(sheets[0].rows[0]).toEqual(['corner', '', '', '', '', '', '']);
    expect(sheets[1].rows.slice(3)).toEqual([
      ['', '', 'x', 1],
      ['', '', 'y', 2],
    ]); // the writer declares the range from A1
    expect(sheets[2].rows).toEqual([]);
    expect(sheets[4].rows).toEqual([[20]]);
  });

  it('formulas give the saved result and are never evaluated', () => {
    const ws: XLSX.WorkSheet = {
      '!ref': 'A1:D3',
      A1: { t: 'n', v: 2 },
      B1: { t: 'n', v: 3 },
      C1: { t: 'n', v: 6, f: 'A1*B1' },
      D1: { t: 's', v: 'six', f: 'TEXT(C1,"0")&""' },
      A2: { t: 'b', v: true, f: 'A1<B1' },
      B2: { t: 'n', v: 999, f: '1+1' },
      C2: { t: 'e', v: 0x07, f: '1/0' },
      A3: { t: 's', v: '', f: '""' },
    };
    const sheets = sameAsOld(written(book([['F', ws]])));
    expect(sheets[0].rows[0]).toEqual([2, 3, 6, 'six']);
    expect(sheets[0].rows[1]).toEqual([true, 999, '', '']); // 999 is what the file says 1+1 is, and that is what we report
  });

  it('errors: #NULL! is null, every other error is blank', () => {
    const codes = [0x00, 0x07, 0x0f, 0x17, 0x1d, 0x24, 0x2a];
    const ws: XLSX.WorkSheet = { '!ref': 'A1:G1' };
    codes.forEach((v, i) => {
      ws[XLSX.utils.encode_cell({ r: 0, c: i })] = { t: 'e', v };
    });
    const sheets = sameAsOld(written(book([['E', ws]])));
    expect(sheets[0].rows).toEqual([[null, '', '', '', '', '', '']]);
  });

  it('text that needs care: unicode, XML entities, spaces, line breaks, control characters, things that look like escapes', () => {
    const tricky = [
      'Ünïcödé — “quotes” ñ',
      '日本語のテキスト',
      'emoji 🎬🎞 and 𝒮cript',
      'ÅÄÖ åäö ß €',
      'Tom & Jerry <b>not bold</b> "q" \'a\'',
      '&amp; already escaped',
      '&lt;tag&gt;',
      'a &#65; b',
      '5 < 6 > 4 &',
      '  leading and trailing  ',
      ' ',
      '\ttab\tinside',
      'line one\nline two',
      'carriage\r\nreturn',
      'bell\u0007char',
      '_x',
      '_xZZZZ_',
      '_x00_',
      'x_x004',
      '__proto__',
      'constructor',
      'toString',
      '=SUM(A1:A9)',
      "'apostrophe first",
      '0123',
      '1e5',
      'TRUE',
      '#N/A',
      '2026-03-04',
    ];
    for (const bookSST of [false, true]) {
      const sheets = sameAsOld(written(book([['Text', aoa(tricky.map((t, i) => [t, i, t + t]))]]), { bookSST }));
      expect(sheets[0].rows.map(r => r[0])).toEqual(tricky);
    }
  });

  it('several sheets, in workbook order, with awkward names', () => {
    const names = [
      'TopSheet',
      'Zebra',
      'Accounts',
      'R&D <draft>',
      'Bob\'s "cut"',
      'Détails ünï',
      '日本',
      '  spaced  ',
      'toString',
      '_x',
    ];
    const wb = book(
      names.map((n, i) => [
        n,
        aoa([
          [n, i],
          ['row', i * 2],
        ]),
      ]),
    );
    const sheets = sameAsOld(written(wb));
    expect(sheets.map(s => s.name)).toEqual(names);
    expect(sheetNamed({ sheets }, 'Accounts')).toEqual([
      ['Accounts', 2],
      ['row', 4],
    ]);
    expect(sheetNamed({ sheets }, 'constructor')).toBeUndefined();
    expect(sheetNamed({ sheets }, '__proto__')).toBeUndefined();
  });

  it('hidden sheets are read like any other, as before', () => {
    const wb = book([
      ['Shown', aoa([['a']])],
      ['Hidden', aoa([['b']])],
    ]);
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
    expect(sameAsOld(written(wb)).map(s => s.name)).toEqual(['Shown', 'Hidden']);
  });

  it('a wide sheet and a long sheet', () => {
    const wide = [
      Array.from({ length: 700 }, (_, c) => (c % 3 ? c : `col ${c}`)),
      Array.from({ length: 700 }, (_, c) => (c % 5 ? '' : c / 7)),
    ];
    const long = Array.from({ length: 12000 }, (_, r) => [
      String(1000 + r),
      `Line ${r}`,
      r % 7,
      r * 1.25,
      r % 11 ? 'FICA1, FUI' : '',
    ]);
    for (const bookSST of [false, true])
      sameAsOld(
        written(
          book([
            ['Wide', aoa(wide)],
            ['Long', aoa(long)],
          ]),
          { bookSST },
        ),
      );
  });

  it('dates are left as Excel serial numbers (the importers never used dates)', () => {
    const ws = aoa([
      ['Start', new Date(Date.UTC(2026, 2, 4))],
      ['n', 46085.5],
    ]);
    const sheets = sameAsOld(written(book([['D', ws]])));
    expect(typeof sheets[0].rows[0][1]).toBe('number');
  });

  it('120 generated workbooks of mixed content match cell for cell', () => {
    const rand = rng(20261118);
    const words = [
      'Director',
      'Grip & Electric',
      'Küche',
      '<wrap>',
      '"Lena"',
      '  pad  ',
      'a\nb',
      '日',
      '',
      '0',
      '12.50',
      '$1,200',
      '(300)',
      '_x0009_',
      "it's",
      'ünï',
      '&amp;',
      ';',
      ',',
    ];
    const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
    for (let n = 0; n < 120; n++) {
      const sheetCount = 1 + Math.floor(rand() * 4);
      const sheets: [string, XLSX.WorkSheet][] = [];
      for (let s = 0; s < sheetCount; s++) {
        const rows = Math.floor(rand() * 30),
          cols = 1 + Math.floor(rand() * 12),
          density = rand();
        const data: unknown[][] = [];
        for (let r = 0; r < rows; r++) {
          const row: unknown[] = [];
          for (let c = 0; c < cols; c++) {
            const k = rand();
            if (k > density) row.push(pick([null, undefined, '']));
            else if (k < density * 0.4) row.push(pick(words));
            else if (k < density * 0.8)
              row.push(pick([0, 1, -1, 0.1, 1234567.891, 1e-9, 2.5e12, Math.round(rand() * 1e6) / 100]));
            else row.push(rand() < 0.5);
          }
          data.push(rand() < 0.15 ? [] : row);
        }
        const origin = rand() < 0.25 ? { r: Math.floor(rand() * 5), c: Math.floor(rand() * 5) } : undefined;
        sheets.push([`S${n}_${s}`, aoa(data, origin ? { origin } : undefined)]);
      }
      sameAsOld(written(book(sheets), { bookSST: rand() < 0.5, compression: rand() < 0.5 }));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe(".xlsx details the old library's writer does not produce, hand-made, still matching the old reader", () => {
  it('shared strings: plain, rich-text runs, phonetic guides left out, xml:space, empty', () => {
    const sst =
      '<si><t>plain</t></si>' +
      '<si><r><rPr><b/></rPr><t>Bold</t></r><r><t xml:space="preserve"> and plain </t></r><r><t>end</t></r></si>' +
      '<si><r><t>東京</t></r><rPh sb="0" eb="2"><t>トウキョウ</t></rPh><phoneticPr fontId="1"/></si>' +
      '<si><t xml:space="preserve">  kept  </t></si>' +
      '<si><t/></si>' +
      '<si><t>A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos; &#233; &#x4E2D;</t></si>' +
      '<si><t>tab_x0009_cr_x000D_under_x005F_x0041_</t></si>';
    const data =
      '<row r="1">' +
      [0, 1, 2, 3, 4, 5, 6].map(i => `<c r="${'ABCDEFG'[i]}1" t="s"><v>${i}</v></c>`).join('') +
      '</row>';
    const sheets = sameAsOld(one(data, sst));
    expect(sheets[0].rows[0]).toEqual([
      'plain',
      'Bold and plain end',
      '東京',
      '  kept  ',
      '',
      'A & B <c> "d" \'e\' é 中',
      'tab\tcr\runder_x0041_',
    ]);
  });

  it('inline strings, t="str" formula text, booleans, errors, plain and scientific numbers', () => {
    const data =
      '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>inline</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><r><t>rich </t></r><r><rPr><i/></rPr><t>inline</t></r></is></c>' +
      '<c r="C1" t="str"><f>A1&amp;"!"</f><v>inline!</v></c>' +
      '<c r="D1" t="b"><v>1</v></c><c r="E1" t="b"><v>0</v></c>' +
      '<c r="F1" t="e"><v>#DIV/0!</v></c><c r="G1" t="e"><v>#NULL!</v></c>' +
      '<c r="H1"><v>42</v></c><c r="I1" t="n"><v>-1.5E-3</v></c><c r="J1" s="3"><v>46085</v></c>' +
      '<c r="K1" t="str"><v></v></c><c r="L1" t="inlineStr"><is><t></t></is></c><c r="M1" s="2"/><c r="N1"><f>SUM(H1:I1)</f></c>' +
      '</row>';
    const sheets = sameAsOld(one(data));
    expect(sheets[0].rows[0]).toEqual([
      'inline',
      'rich inline',
      'inline!',
      true,
      false,
      '',
      null,
      42,
      -0.0015,
      46085,
      '',
      '',
      '',
      '',
    ]); // the last is a formula saved with no result: blank, not worked out
  });

  it('rows and cells without addresses, sparse addresses, rows out of order, gaps', () => {
    sameAsOld(one('<row><c><v>1</v></c><c><v>2</v></c></row><row><c t="str"><v>a</v></c></row>'));
    sameAsOld(
      one(
        '<row r="2"><c r="B2"><v>1</v></c><c><v>2</v></c><c r="F2"><v>6</v></c><c><v>7</v></c></row><row r="7"><c r="C7" t="str"><v>seven</v></c></row>',
      ),
    );
    sameAsOld(one('<row r="5"><c r="A5"><v>5</v></c></row><row r="2"><c r="D2"><v>2</v></c></row><row r="9"></row>'));
    const sheets = sameAsOld(
      one('<row r="3"><c r="C3"><v>1</v></c></row><row r="4"/><row r="6"><c r="E6" t="b"><v>1</v></c></row>'),
    );
    expect(sheets[0].rows).toEqual([
      [1, '', ''],
      ['', '', ''],
      ['', '', ''],
      ['', '', true],
    ]);
  });

  it('the declared range (<dimension>) sets where the grid starts and how far it runs', () => {
    const cells = '<row r="2"><c r="B2"><v>1</v></c></row><row r="3"><c r="C3"><v>2</v></c></row>';
    expect(sameAsOld(one(cells, undefined, '<dimension ref="A1:D5"/>'))[0].rows).toEqual([
      ['', '', '', ''],
      ['', 1, '', ''],
      ['', '', 2, ''],
      ['', '', '', ''],
      ['', '', '', ''],
    ]);
    expect(sameAsOld(one(cells, undefined, '<dimension ref="B2:C3"/>'))[0].rows).toEqual([
      [1, ''],
      ['', 2],
    ]);
    expect(sameAsOld(one(cells))[0].rows).toEqual([
      [1, ''],
      ['', 2],
    ]); // none declared
    expect(sameAsOld(one(cells, undefined, '<dimension ref="B2"/>'))[0].rows).toEqual([
      [1, ''],
      ['', 2],
    ]); // one-cell declarations are not trusted
    expect(sameAsOld(one('', undefined, '<dimension ref="A1:B2"/>'))[0].rows).toEqual([
      ['', ''],
      ['', ''],
    ]);
  });

  it('namespace prefixes, comments, CDATA, processing instructions and odd spacing in the XML', () => {
    const xml = `<?xml version="1.0"?>\n<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>pre</x:t></x:is></x:c><x:c r="B1"><x:v>2</x:v></x:c></x:row></x:sheetData></x:worksheet>`;
    expect(sameAsOld(handMade([{ name: 'P', xml }]))[0].rows).toEqual([['pre', 2]]);
    const odd = sheetXml(
      '<!-- a comment with <c r="Z9"><v>9</v></c> in it --><row r="1" spans="1:2" ><c  r="A1"  t="str" ><v>a&gt;b</v></c ><c r="B1" t="str"><v><![CDATA[<raw> & kept]]></v></c></row >',
    );
    expect(readXlsx(handMade([{ name: 'O', xml: odd }])).sheets[0].rows).toEqual([['a>b', '<raw> & kept']]);
  });

  it('sheets are found through the workbook relationships, whatever the files are called', () => {
    const files: Zippable = {
      '_rels/.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${RT}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
      '[Content_Types].xml': strToU8(
        CT.replace(
          'SHEETS',
          '<Override PartName="/xl/worksheets/zz.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/other/aa.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
        ),
      ),
      'xl/workbook.xml': strToU8(
        `<workbook ${NS}><sheets><sheet name="Second file, first sheet" sheetId="7" r:id="rIdB"/><sheet name="First file, second sheet" sheetId="3" r:id="rIdA"/></sheets></workbook>`,
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdA" Type="${RT}/worksheet" Target="/xl/other/aa.xml"/><Relationship Id="rIdB" Type="${RT}/worksheet" Target="worksheets/zz.xml"/><Relationship Id="rIdS" Type="${RT}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      ),
      'xl/other/aa.xml': strToU8(sheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>')),
      'xl/worksheets/zz.xml': strToU8(sheetXml('<row r="1"><c r="A1" t="s"><v>1</v></c></row>')),
      'xl/sharedStrings.xml': strToU8(
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>from aa</t></si><si><t>from zz</t></si></sst>',
      ),
    };
    const sheets = sameAsOld(zipSync(files));
    expect(sheets).toEqual([
      { name: 'Second file, first sheet', rows: [['from zz']] },
      { name: 'First file, second sheet', rows: [['from aa']] },
    ]);
  });

  it('where we knowingly differ from the old reader, we are the more careful one', () => {
    // cells outside a too-small declared range: the old reader dropped them, we keep them
    const outside = one(
      '<row r="1"><c r="A1"><v>1</v></c></row><row r="4"><c r="C4"><v>4</v></c></row>',
      undefined,
      '<dimension ref="A1:A2"/>',
    );
    expect(oldXlsx(outside)[0].rows).toEqual([[1], ['']]);
    expect(readXlsx(outside).sheets[0].rows).toEqual([
      [1, '', ''],
      ['', '', ''],
      ['', '', ''],
      ['', '', 4],
    ]);
    // a number that is not a number: the old reader handed the importers NaN, we hand them a blank
    const nan = one('<row r="1"><c r="A1"><v>abc</v></c><c r="B1"><v>2</v></c></row>');
    expect(oldXlsx(nan)[0].rows[0][0]).toBeNaN();
    expect(readXlsx(nan).sheets[0].rows).toEqual([['', 2]]);
    // a character reference above U+FFFF: the old reader cut it to 16 bits
    const astral = one('<row r="1"><c r="A1" t="str"><v>&#x1F3AC;</v></c></row>');
    expect(readXlsx(astral).sheets[0].rows).toEqual([['🎬']]);
    // an ISO date cell (t="d"): a serial number that does not depend on the computer's time zone
    const iso = one(
      '<row r="1"><c r="A1" t="d"><v>2026-03-04T12:00:00Z</v></c><c r="B1" t="d"><v>2026-03-04</v></c></row>',
    );
    expect(readXlsx(iso).sheets[0].rows).toEqual([[46085.5, 46085]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('the importers, end to end, give the same budget through the new reader as through the old one', () => {
  it('the Shamel sample: sheet by sheet the same rows, and the import reconciles', () => {
    const bytes = fixture('Budget_SaltFlat_Draft3.xlsx');
    const old = oldXlsx(bytes);
    const wb = readSpreadsheet(bytes, 'Budget_SaltFlat_Draft3.xlsx');
    for (const n of ['Budget Metadata', 'TopSheet', 'Accounts', 'Details'])
      expect(sheetNamed(wb, n)).toEqual(old.find(s => s.name === n)!.rows);
    const imp = parseShamelXlsx(wb);
    expect(imp.lines.length).toBeGreaterThan(50);
    expect(
      parseBudgetFile(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        'Budget_SaltFlat_Draft3.xlsx',
      ).source,
    ).toBe('shamel');
  });
  it('a Shamel workbook whose metadata sheet names a key "__proto__" changes nothing outside itself', () => {
    const wb = book([
      [
        'Budget Metadata',
        aoa([
          ['__proto__', 'polluted'],
          ['constructor', 'x'],
          ['Project Name', 'HOLLOW PINES'],
          ['Location Shoot Days', 9],
        ]),
      ],
      [
        'TopSheet',
        aoa([
          ['Acct', 'Description', 'a', 'b', 'Total'],
          ['1100', 'STORY', 0, 0, 100],
        ]),
      ],
      [
        'Accounts',
        aoa([
          ['Account#', 'Description'],
          ['1101', 'Writer'],
        ]),
      ],
      [
        'Details',
        aoa([
          ['Acct', 'Description', 'x', 'Fringes', 'Tags', 'Amount', 'Unit', 'Rate'],
          ['1101', 'Draft', '', '__proto__', '', 1, 'FLAT', 100],
        ]),
      ],
    ]);
    const imp = parseShamelXlsx(readSpreadsheet(written(wb), 'b.xlsx'));
    expect(imp.name).toBe('HOLLOW PINES');
    expect(imp.shootDays).toBe(9);
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    expect(typeof {}.toString).toBe('function');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('delimited text (.csv, .tsv, .txt)', () => {
  const same = (text: string) => {
    const mine = parseDelimited(text);
    expect(mine).toEqual(oldCsv(text));
    return mine;
  };

  it('the Movie Magic export fixture reads the same as before', () => {
    const text = new TextDecoder().decode(fixture('mmb-export.csv'));
    expect(same(text).length).toBeGreaterThan(10);
    expect(readSpreadsheet(fixture('mmb-export.csv'), 'mmb-export.csv').sheets).toEqual([
      { name: 'Sheet1', rows: oldCsv(text) },
    ]);
  });

  it('quoted fields: separators, line breaks and doubled quotes inside', () => {
    expect(
      same('Acct,Description,Total\n1100,"Rights, story",2500\n1200,"She said ""no""",10\n1300,"two\nlines",5\n'),
    ).toEqual([
      ['Acct', 'Description', 'Total'],
      ['1100', 'Rights, story', '2500'],
      ['1200', 'She said "no"', '10'],
      ['1300', 'two\nlines', '5'],
    ]);
    expect(same('a,"b\r\nc",d\r\n"","""",e\r\n')).toEqual([
      ['a', 'b\nc', 'd'],
      ['', '"', 'e'],
    ]);
  });

  it('line endings: \\r\\n, \\n, a lone \\r, with and without a final one', () => {
    for (const nl of ['\r\n', '\n', '\r'])
      for (const end of ['', nl])
        expect(same(`a,b${nl}c,d${nl}e,f${end}`)).toEqual([
          ['a', 'b'],
          ['c', 'd'],
          ['e', 'f'],
        ]);
  });

  it('a byte-order mark is dropped, in UTF-8 and UTF-16', () => {
    const text = 'Acct,Description\n1100,Über';
    const rows = [
      ['Acct', 'Description'],
      ['1100', 'Über'],
    ];
    expect(parseDelimited('﻿' + text)).toEqual(rows);
    expect(
      readSpreadsheet(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]), 'a.csv').sheets[0].rows,
    ).toEqual(rows);
    const le = new Uint8Array(2 + text.length * 2);
    le[0] = 0xff;
    le[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      le[2 + i * 2] = text.charCodeAt(i) & 255;
      le[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    expect(readSpreadsheet(le, 'a.txt').sheets[0].rows).toEqual(rows);
  });

  it("values stay text exactly as written; blanks are ''; rows are padded to the widest", () => {
    expect(same('n,s,b,d\n 007 ,TRUE,"$1,200.00",2026-03-04\n1\n,,\n')).toEqual([
      ['n', 's', 'b', 'd'],
      [' 007 ', 'TRUE', '$1,200.00', '2026-03-04'],
      ['1', '', '', ''],
      ['', '', '', ''],
    ]);
  });

  it('blank lines are kept as blank rows; a trailing separator adds a column only when the line ends', () => {
    expect(same('a\n\nb\n\n')).toEqual([['a'], [''], ['b'], ['']]);
    expect(same('a,b,\nc,d,\n')).toEqual([
      ['a', 'b', ''],
      ['c', 'd', ''],
    ]);
    expect(same('a,b,')).toEqual([['a', 'b']]);
  });

  it("the separator is worked out from the text: comma, tab, semicolon, pipe, and Excel's sep= line", () => {
    expect(same('a\tb\tc\n1\t2,5\t3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2,5', '3'],
    ]);
    expect(same('a;b;c\n1,5;2;3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1,5', '2', '3'],
    ]);
    expect(same('a|b|c\n1|2|3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(same('sep=;\na;b,c\n')).toEqual([['a', 'b,c']]);
    expect(same('sep=|\r\na|b,c;d\r\n')).toEqual([['a', 'b,c;d']]);
    expect(same('"a,a,a,a";b;c\n')).toEqual([['a,a,a,a', 'b', 'c']]); // separators inside quotes do not vote
    expect(guessSeparator('a,b\tc')).toBe(','); // a tie goes to the comma
    expect(guessSeparator('no separators at all')).toBe(',');
    expect(same('just one column\nsecond line\n')).toEqual([['just one column'], ['second line']]);
  });

  it('malformed quoting does what it did before, and never fails', () => {
    for (const t of [
      'a,"unclosed\nb,c\n',
      'a,b"c",d\n',
      '"a"b,c\n',
      '"',
      '""',
      '"""',
      'a,"',
      '"a""',
      ',\n,',
      '\n',
      '\r\n\r\n',
      ' ',
      ',',
      '"a",,"b"\n,,\n',
    ])
      same(t);
  });

  it('400 generated texts match the old reader', () => {
    const rand = rng(424242);
    const atoms = [
      'a',
      'B',
      '1',
      '2.5',
      ' ',
      '"',
      '""',
      ',',
      ';',
      '\t',
      '|',
      '\n',
      '\r\n',
      '\r',
      'é',
      '日',
      '$',
      '-',
      '(3)',
      'x y',
      '"q,r"',
      '"s\nt"',
      '"u""v"',
    ];
    for (let n = 0; n < 400; n++) {
      let t = '';
      const len = 1 + Math.floor(rand() * 60); // starts with a letter: the old reader mistook some first bytes for other file formats
      for (let i = 0; i < len; i++) t += atoms[Math.floor(rand() * atoms.length)];
      same('h' + t);
    }
  });

  it('a .csv that starts the way other old formats do is still read as text', () => {
    // the old library took these openings for a SYLK file and a dBASE file and failed or returned nonsense
    expect(
      readSpreadsheet(new TextEncoder().encode('ID;Description;Total\n1;Grip;100\n'), 'a.csv').sheets[0].rows,
    ).toEqual([
      ['ID', 'Description', 'Total'],
      ['1', 'Grip', '100'],
    ]);
    expect(readSpreadsheet(new TextEncoder().encode('1\t\t\tx\n2\t\t\ty\n'), 'a.tsv').sheets[0].rows).toEqual([
      ['1', '', '', 'x'],
      ['2', '', '', 'y'],
    ]);
  });

  it('a Movie Magic style .csv imports as a budget through the whole path', () => {
    const csv =
      'Acct#,Description,Amount,Units,X,Rate,Subtotal\r\n1100,STORY & RIGHTS,,,,,\r\n1101,"Option, novel",1,Allow,1,"2,500.00","2,500.00"\r\n2001,"Gaffer ""Red"" Ortiz",3,Weeks,1,1800,5400\r\n';
    const imp = parseBudgetFile(new TextEncoder().encode(csv).buffer as ArrayBuffer, 'export.csv');
    expect(imp.source).toBe('generic');
    expect(imp.lines.map(l => [l.accountId, l.description, l.amount, l.rate])).toEqual([
      ['1101', 'Option, novel', 1, 2500],
      ['2001', 'Gaffer "Red" Ortiz', 3, 1800],
    ]);
    expect(imp.reportedTotal).toBe(7900);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('file types: what is accepted and what is refused, in plain words', () => {
  const xlsxBytes = written(
    book([
      [
        'Budget',
        aoa([
          ['Acct', 'Description', 'Amount', 'Rate', 'Total'],
          ['1101', 'Writer', 1, 500, 500],
        ]),
      ],
    ]),
  );
  const csvBytes = new TextEncoder().encode('Acct,Description,Amount,Rate,Total\n1101,Writer,1,500,500\n');
  const tsvBytes = new TextEncoder().encode('Acct\tDescription\tAmount\tRate\tTotal\n1101\tWriter\t1\t500\t500\n');
  const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

  it('.xlsx, .csv, .tsv and .txt import; the content decides, not the name', () => {
    for (const [bytes, name] of [
      [xlsxBytes, 'b.xlsx'],
      [csvBytes, 'b.csv'],
      [tsvBytes, 'b.tsv'],
      [tsvBytes, 'b.txt'],
      [csvBytes, 'b.txt'],
      [xlsxBytes, 'b.csv'],
      [csvBytes, 'b.xlsx'],
      [tsvBytes, 'b.xls'],
      [xlsxBytes, 'b.xls'],
    ] as const) {
      const imp = parseBudgetFile(buf(bytes), name);
      expect(imp.lines.map(l => [l.accountId, l.description, l.amount, l.rate])).toEqual([['1101', 'Writer', 1, 500]]);
    }
  });

  it('an old binary .xls is refused with what to do about it', () => {
    const xls = new Uint8Array(
      XLSX.write(
        book([
          [
            'Budget',
            aoa([
              ['Acct', 'Description'],
              ['1101', 'Writer'],
            ]),
          ],
        ]),
        { type: 'array', bookType: 'biff8' },
      ) as ArrayBuffer,
    );
    expect(message(() => readSpreadsheet(xls, 'old.xls'))).toBe(
      'This is an older Excel file. Open it in Excel or Numbers and save it as .xlsx, then drop it here.',
    );
    expect(message(() => readSpreadsheet(xls, 'renamed.xlsx'))).toBe(OLD_EXCEL_MESSAGE);
    expect(message(() => parseBudgetFile(buf(xls), 'old.xls'))).toBe(OLD_EXCEL_MESSAGE);
    const biff2 = new Uint8Array(
      XLSX.write(book([['B', aoa([['a', 1]])]]), { type: 'array', bookType: 'biff2' }) as ArrayBuffer,
    );
    expect(message(() => readSpreadsheet(biff2, 'older.xls'))).toBe(OLD_EXCEL_MESSAGE);
  });

  it('a web page or XML saved under an Excel name is refused the same way', () => {
    const html = new TextEncoder().encode(
      '<html><body><table><tr><td>Acct</td><td>Description</td></tr></table></body></html>',
    );
    expect(message(() => readSpreadsheet(html, 'export.xls'))).toBe(OLD_EXCEL_MESSAGE);
    const xml2003 = new TextEncoder().encode(
      '﻿<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?><Workbook/>',
    );
    expect(message(() => readSpreadsheet(xml2003, 'export.xlsx'))).toBe(OLD_EXCEL_MESSAGE);
  });

  it('a password-protected workbook says so', () => {
    const ole = new Uint8Array(2048);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const name = 'EncryptedPackage';
    for (let i = 0; i < name.length; i++) ole[1024 + i * 2] = name.charCodeAt(i);
    expect(message(() => readSpreadsheet(ole, 'locked.xlsx'))).toMatch(/locked with a password/);
  });

  it('other spreadsheet formats inside a zip (.xlsb, .ods, Numbers) and plain zips are named, not guessed at', () => {
    expect(
      message(() =>
        readSpreadsheet(
          new Uint8Array(
            XLSX.write(book([['B', aoa([['a', 1]])]]), { type: 'array', bookType: 'xlsb' }) as ArrayBuffer,
          ),
          'b.xlsx',
        ),
      ),
    ).toMatch(/Excel Binary workbook \(\.xlsb\)/);
    expect(
      message(() =>
        readSpreadsheet(
          new Uint8Array(XLSX.write(book([['B', aoa([['a', 1]])]]), { type: 'array', bookType: 'ods' }) as ArrayBuffer),
          'b.xlsx',
        ),
      ),
    ).toMatch(/OpenDocument spreadsheet/);
    expect(message(() => readSpreadsheet(zipSync({ 'Index/Document.iwa': new Uint8Array(4) }), 'b.xlsx'))).toMatch(
      /Apple Numbers/,
    );
    expect(message(() => readSpreadsheet(zipSync({ 'holiday.txt': strToU8('hello') }), 'b.xlsx'))).toMatch(
      /not an Excel workbook/,
    );
  });

  it('a picture or other binary file renamed to a spreadsheet is refused', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
    expect(message(() => readSpreadsheet(png, 'budget.xlsx'))).toMatch(/does not look like a spreadsheet/);
    expect(message(() => readSpreadsheet(png, 'budget.csv'))).toMatch(/does not look like a spreadsheet/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('hostile and broken files are refused quickly, in plain words, and change nothing', () => {
  const plain = (m: string) => {
    expect(m).not.toMatch(
      /TypeError|undefined|null|NaN|\bat \w+\.|Cannot read|is not a function|RangeError|fflate|inflate|XML|zip\b/i,
    );
    expect(m.length).toBeGreaterThan(30);
    return m;
  };
  const quick = <T>(fn: () => T, ms = 4000): T => {
    const t = performance.now();
    const out = fn();
    expect(performance.now() - t).toBeLessThan(ms);
    return out;
  };

  it('prototype pollution: names and text taken from the file never become property names', () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    const evil = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', '__defineGetter__'];
    const sst = evil.map(e => `<si><t>${e}</t></si>`).join('');
    const data =
      '<row r="1">' +
      evil.map((_, i) => `<c r="${'ABCDEF'[i]}1" t="s"><v>${i}</v></c>`).join('') +
      '</row><row r="2"><c r="A2" t="inlineStr"><is><t>__proto__</t></is></c><c r="B2" t="str"><v>{"__proto__":{"polluted":1}}</v></c></row>';
    const bytes = handMade(
      evil.map(name => ({ name, xml: sheetXml(data) })),
      sst,
      {
        __proto__: strToU8('polluted'),
        constructor: strToU8('polluted'),
        'xl/__proto__': strToU8('polluted'),
      },
    );
    const wb = readSpreadsheet(bytes, '__proto__.xlsx');
    expect(wb.sheets.map(s => s.name)).toEqual(evil);
    expect(wb.sheets[0].rows[0]).toEqual(evil);
    expect(Array.isArray(wb.sheets)).toBe(true);
    expect(Object.getPrototypeOf(wb)).toBe(Object.prototype);
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
    expect(({} as any).polluted).toBeUndefined();
    expect(sheetNamed(wb, '__proto__')).toBe(wb.sheets[0].rows);
    try {
      parseBudgetFile(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        'x.xlsx',
      );
    } catch {
      /* not a budget: fine */
    }
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
  });

  it('a relationship that points at "__proto__" or outside the workbook is just a missing sheet', () => {
    for (const target of ['__proto__', '/__proto__', '../../../../etc/passwd', 'constructor']) {
      const bytes = handMade([{ name: 'S', xml: sheetXml('') }], undefined, {
        'xl/_rels/workbook.xml.rels': strToU8(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}/worksheet" Target="${target}"/></Relationships>`,
        ),
        __proto__: strToU8(sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>')),
      });
      plain(message(() => readSpreadsheet(bytes, 'x.xlsx')));
    }
    expect(({} as any).polluted).toBeUndefined();
  });

  it('a zip bomb: a part that unpacks past the ceiling is refused before it is unpacked', () => {
    const big = new Uint8Array(LIMITS.unzippedBytes + 1024); // zeros: about 100 KB in the zip
    const bytes = quick(
      () => handMade([{ name: 'S', xml: '' }], undefined, { 'xl/worksheets/sheet1.xml': big }),
      20000,
    );
    expect(bytes.length).toBeLessThan(1024 * 1024);
    expect(plain(quick(() => message(() => readSpreadsheet(bytes, 'bomb.xlsx')), 1000))).toMatch(
      /unpacks to more than 100 MB/,
    );
  });

  it('a zip bomb in pieces: many sheets that are each allowed but together are not', () => {
    const part = new Uint8Array(30 * 1024 * 1024);
    const sheets = Array.from({ length: 5 }, (_, i) => ({ name: `S${i}`, xml: '' }));
    const extra: Zippable = {};
    sheets.forEach((_, i) => {
      extra[`xl/worksheets/sheet${i + 1}.xml`] = part;
    });
    const bytes = handMade(sheets, undefined, extra);
    expect(plain(quick(() => message(() => readSpreadsheet(bytes, 'bomb.xlsx')), 1000))).toMatch(
      /unpacks to more than/,
    );
  });

  it('a part that lies about its size cannot unpack past what it declared', () => {
    const honest = handMade([
      {
        name: 'S',
        xml: sheetXml('<row r="1">' + '<c t="str"><v>padding padding padding</v></c>'.repeat(5000) + '</row>'),
      },
    ]);
    // find sheet1's entry in the zip's directory and shrink its declared size to 100 bytes
    const lied = honest.slice();
    const view = new DataView(lied.buffer);
    let patched = 0;
    for (let i = 0; i + 46 < lied.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      const nameLen = view.getUint16(i + 28, true);
      const name = new TextDecoder().decode(lied.subarray(i + 46, i + 46 + nameLen));
      if (name === 'xl/worksheets/sheet1.xml') {
        view.setUint32(i + 24, 100, true);
        patched++;
      }
    }
    expect(patched).toBe(1);
    plain(message(() => readSpreadsheet(lied, 'liar.xlsx')));
  });

  it('too many sheets', () => {
    const sheets = Array.from({ length: LIMITS.sheets + 1 }, (_, i) => ({ name: `S${i}`, xml: sheetXml('') }));
    expect(plain(message(() => readSpreadsheet(handMade(sheets), 'many.xlsx')))).toMatch(/201 sheets.*up to 200/);
  });

  it('a cell placed absurdly far down or across', () => {
    expect(
      plain(message(() => readSpreadsheet(one('<row r="1048576"><c r="A1048576"><v>1</v></c></row>'), 'x.xlsx'))),
    ).toMatch(/"Sheet1" goes past row 200,000/);
    expect(plain(message(() => readSpreadsheet(one('<row r="1"><c r="XFD1"><v>1</v></c></row>'), 'x.xlsx')))).toMatch(
      /"Sheet1" goes past 2,000 columns/,
    );
    expect(
      plain(
        message(() =>
          readSpreadsheet(
            one('<row r="99999999999999999999"><c r="ZZZZZZZZZZZZZZZZ99999999999999999999"><v>1</v></c></row>'),
            'x.xlsx',
          ),
        ),
      ),
    ).toMatch(/goes past/);
  });

  it('two cells far apart: the blank grid between them would be enormous', () => {
    const m = message(() =>
      quick(() =>
        readSpreadsheet(
          one('<row r="1"><c r="A1"><v>1</v></c></row><row r="150000"><c r="BXX150000"><v>2</v></c></row>'),
          'x.xlsx',
        ),
      ),
    );
    expect(plain(m)).toMatch(/spread over too large an area/);
  });

  it('a declared range of the whole grid around a small sheet is ignored, not obeyed', () => {
    const wb = quick(() =>
      readSpreadsheet(
        one(
          '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row>',
          undefined,
          '<dimension ref="A1:XFD1048576"/>',
        ),
        'x.xlsx',
      ),
    );
    expect(wb.sheets[0].rows).toEqual([[1, 2]]);
    const none = quick(() => readSpreadsheet(one('', undefined, '<dimension ref="A1:XFD1048576"/>'), 'x.xlsx'));
    expect(none.sheets[0].rows).toEqual([]);
  });

  it('too many filled cells', () => {
    const row = (r: number) => `<row r="${r}">` + '<c><v>1</v></c>'.repeat(1000) + '</row>';
    let data = '';
    for (let r = 1; r <= 501; r++) data += row(r);
    expect(plain(message(() => quick(() => readSpreadsheet(one(data), 'x.xlsx'), 15000)))).toMatch(
      /more than 500,000 filled cells/,
    );
  });

  it('too many shared strings', () => {
    const sst = '<si><t>a</t></si>'.repeat(LIMITS.cells + 1);
    expect(
      plain(
        message(() =>
          quick(() => readSpreadsheet(one('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', sst), 'x.xlsx'), 15000),
        ),
      ),
    ).toMatch(/more than 500,000 filled cells/);
  });

  it('a file over the size ceiling is refused before it is looked at', () => {
    const big = new Uint8Array(LIMITS.fileBytes + 1);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    expect(plain(message(() => quick(() => readSpreadsheet(big, 'big.xlsx'), 500)))).toMatch(
      /This file is 50 MB.*up to 50 MB/,
    );
    expect(
      plain(
        message(() => quick(() => readSpreadsheet(new Uint8Array(LIMITS.fileBytes + 1).fill(0x61), 'big.csv'), 500)),
      ),
    ).toMatch(/up to 50 MB/);
  });

  it('text files: too many rows, too many columns, too large a grid', () => {
    expect(plain(message(() => parseDelimited('a\n'.repeat(LIMITS.rows + 1))))).toMatch(/goes past row 200,000/);
    expect(plain(message(() => parseDelimited('a,'.repeat(LIMITS.columns + 1))))).toMatch(/goes past 2,000 columns/);
    expect(plain(message(() => quick(() => parseDelimited('a,'.repeat(1999) + 'a\n' + 'b\n'.repeat(5000)))))).toMatch(
      /too large an area/,
    );
    expect(plain(message(() => quick(() => parseDelimited(('a,'.repeat(9) + 'a\n').repeat(50001)), 15000)))).toMatch(
      /more than 500,000 filled cells/,
    );
  });

  it('text built to make a careless pattern crawl is read in a blink', () => {
    const n = 300000;
    quick(() => parseDelimited('"'.repeat(n)));
    quick(() => parseDelimited('"' + 'a""'.repeat(n / 3)));
    quick(() => parseDelimited(' '.repeat(n) + '\n' + '\t'.repeat(1000)), 4000);
    quick(() => decodeXml('&'.repeat(n)));
    quick(() => decodeXml('&#'.repeat(n / 2)));
    quick(() => decodeXml('_x'.repeat(n / 2)));
    quick(() => decodeXml('&amp' + ' '.repeat(n)));
    expect(decodeXml('&'.repeat(50))).toBe('&'.repeat(50));
    // long runs inside the workbook's own XML: spaces in tags, an unclosed quote, thousands of nested or unclosed tags
    const longTag = one(
      `<row r="1"${' '.repeat(n)}><c r="A1"${' '.repeat(n)}t="str"><v>${'&'.repeat(n)}</v></c></row>`,
    );
    expect(quick(() => readSpreadsheet(longTag, 'x.xlsx')).sheets[0].rows[0][0]).toBe('&'.repeat(n));
    const nested = one('<row r="1">' + '<c>'.repeat(n / 3) + '<v>1</v>' + '</c>'.repeat(n / 3) + '</row>');
    quick(() => {
      try {
        readSpreadsheet(nested, 'x.xlsx');
      } catch (e) {
        expect(e).toBeInstanceOf(SpreadsheetError);
      }
    });
    const deep = one('<row r="1"><c t="inlineStr"><is>' + '<r>'.repeat(n / 3) + '<t>deep</t></is></c></row>');
    quick(() => {
      try {
        readSpreadsheet(deep, 'x.xlsx');
      } catch (e) {
        expect(e).toBeInstanceOf(SpreadsheetError);
      }
    });
  });

  it('a document that declares its own entities (the "billion laughs" trick) is refused, and nothing is expanded', () => {
    const lol = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><worksheet ${NS}><sheetData><row r="1"><c r="A1" t="str"><v>&lol2;</v></c></row></sheetData></worksheet>`;
    plain(message(() => readSpreadsheet(handMade([{ name: 'S', xml: lol }]), 'lol.xlsx')));
    expect(decodeXml('&lol2; &unknown; &#xFFFFFFFF; &#99999999; &;')).toBe(
      '&lol2; &unknown; &#xFFFFFFFF; &#99999999; &;',
    );
  });

  it("broken files give a readable error, never a programmer's one", () => {
    const good = handMade(
      [{ name: 'S', xml: sheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }],
      '<si><t>a</t></si>',
    );
    const cases: [string, Uint8Array][] = [
      ['cut off half way', good.slice(0, good.length >> 1)],
      ['cut off near the end', good.slice(0, good.length - 30)],
      ['just the zip signature', new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
      ['an empty zip', new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      ['a shared string that is not there', one('<row r="1"><c r="A1" t="s"><v>5</v></c></row>', '<si><t>a</t></si>')],
      [
        'a shared string index that is not a number',
        one('<row r="1"><c r="A1" t="s"><v>x</v></c></row>', '<si><t>a</t></si>'),
      ],
      ['a negative shared string index', one('<row r="1"><c r="A1" t="s"><v>-1</v></c></row>', '<si><t>a</t></si>')],
      ['shared strings but no table', one('<row r="1"><c r="A1" t="s"><v>0</v></c></row>')],
      ['no sheets listed', handMade([])],
      [
        'a sheet file that is missing',
        handMade([{ name: 'S', xml: '' }], undefined, {
          'xl/_rels/workbook.xml.rels': strToU8(
            `<Relationships><Relationship Id="rId1" Type="${RT}/worksheet" Target="worksheets/gone.xml"/></Relationships>`,
          ),
        }),
      ],
      ['an unclosed tag', handMade([{ name: 'S', xml: '<worksheet><sheetData><row r="1"><c r="A1' }])],
      ['an unclosed comment', handMade([{ name: 'S', xml: '<worksheet><!-- <sheetData>' }])],
      [
        'an unclosed attribute',
        handMade([{ name: 'S', xml: '<worksheet><sheetData><row r="1><c/></row></sheetData></worksheet>' }]),
      ],
      [
        'a workbook part that is not XML',
        handMade([{ name: 'S', xml: sheetXml('') }], undefined, {
          'xl/workbook.xml': new Uint8Array([0xff, 0xfe, 0x00, 0xd8, 0x00, 0x00]),
        }),
      ],
    ];
    for (const [label, bytes] of cases) {
      let m = '';
      try {
        readSpreadsheet(bytes, 'broken.xlsx');
        m = `(${label}: no error)`;
      } catch (e) {
        expect(e, label).toBeInstanceOf(SpreadsheetError);
        m = (e as Error).message;
      }
      expect(plain(m), label).toMatch(/damaged or incomplete|not an Excel workbook/);
    }
    // flipping bytes anywhere in a real workbook never produces anything but a workbook or a readable refusal
    const fix = fixture('generic-budget.xlsx');
    const rand = rng(7);
    for (let n = 0; n < 300; n++) {
      const b = fix.slice();
      for (let k = 0; k < 1 + Math.floor(rand() * 8); k++) b[Math.floor(rand() * b.length)] = Math.floor(rand() * 256);
      try {
        const wb: Workbook = readSpreadsheet(b, 'flipped.xlsx');
        expect(Array.isArray(wb.sheets)).toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(SpreadsheetError);
        plain((e as Error).message);
      }
    }
  });

  it('the scanner refuses what it does not understand instead of guessing', () => {
    const seen: string[] = [];
    scanXml('<a x="1>2"><b:c/>t&amp;<![CDATA[<raw>]]></a>', {
      open: n => seen.push('<' + n),
      close: n => seen.push('>' + n),
      text: (f, t) => seen.push(`${f}-${t}`),
    });
    expect(seen).toEqual(['<a', '<c', '>c', '17-23', '32-37', '>a']);
    expect(() => scanXml('<!DOCTYPE x>', { open() {}, close() {}, text() {} })).toThrow();
    expect(() => scanXml('<a', { open() {}, close() {}, text() {} })).toThrow();
  });
});

describe('files built to get round the limits', () => {
  const cell = (ref: string, v: string) => `<row><c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c></row>`;
  it('refuses a stored part whose directory entry lies about its size', () => {
    const zip = zipSync(
      {
        ...Object.fromEntries(
          Object.entries(unzipParts(handMade([{ name: 'A', xml: sheetXml(cell('A1', 'x'.repeat(4000))) }]))),
        ),
      },
      { level: 0 },
    );
    expect(readSpreadsheet(zip, 'b.xlsx').sheets[0].rows[0][0]).toHaveLength(4000); // honest and stored: fine
    const lied = zip.slice();
    const view = new DataView(lied.buffer);
    let patched = 0;
    for (let i = 0; i + 46 <= lied.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      const nameLen = view.getUint16(i + 28, true),
        name = new TextDecoder().decode(lied.subarray(i + 46, i + 46 + nameLen));
      if (name === 'xl/worksheets/sheet1.xml') {
        view.setUint32(i + 24, 0, true);
        patched++;
      }
    }
    expect(patched).toBe(1);
    expect(message(() => readSpreadsheet(lied, 'b.xlsx'))).toMatch(/damaged or incomplete/);
  });
  it('refuses two sheets that point at the same part', () => {
    const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${RT}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
    const file = handMade(
      [
        { name: 'A', xml: sheetXml(cell('A1', 'x')) },
        { name: 'B', xml: sheetXml(cell('A1', 'y')) },
      ],
      undefined,
      { 'xl/_rels/workbook.xml.rels': strToU8(rels) },
    );
    expect(message(() => readSpreadsheet(file, 'b.xlsx'))).toMatch(/damaged or incomplete/);
  });
  it('counts a shared string every time a cell uses it', () => {
    const big = 'x'.repeat(1_000_000);
    const rows = Array.from({ length: 25 }, (_, i) => `<row><c r="A${i + 1}" t="s"><v>0</v></c></row>`).join('');
    expect(
      message(() =>
        readSpreadsheet(handMade([{ name: 'A', xml: sheetXml(rows) }], `<si><t>${big}</t></si>`), 'b.xlsx'),
      ),
    ).toMatch(/far more text than a budget/);
    const few = Array.from({ length: 5 }, (_, i) => `<row><c r="A${i + 1}" t="s"><v>0</v></c></row>`).join('');
    expect(
      readSpreadsheet(handMade([{ name: 'A', xml: sheetXml(few) }], `<si><t>${big}</t></si>`), 'b.xlsx').sheets[0].rows,
    ).toHaveLength(5);
  });
  it('reads a .csv saved by Excel on Windows (Windows-1252) as well as UTF-8', () => {
    const win = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x2c, 0xa3, 0x35, 0x0a]); // Café,£5
    expect(readSpreadsheet(win, 'b.csv').sheets[0].rows[0]).toEqual(['Café', '£5']);
    expect(readSpreadsheet(strToU8('Café,£5\n'), 'b.csv').sheets[0].rows[0]).toEqual(['Café', '£5']);
  });
});
