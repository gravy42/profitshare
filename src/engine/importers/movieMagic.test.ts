import { describe, expect, it } from 'vitest';
import { parseBudgetFile } from './budget';
import { kindFromStart, kindOf } from './fileKind';
import { isMovieMagicBudget, movieMagicMessage } from './movieMagic';
import { readSpreadsheet, SpreadsheetError } from './spreadsheet';

/** An invented file shaped like a Movie Magic Budgeting 7 .mbd: the six bytes it starts with, then filler from a
 *  fixed formula standing in for the enciphered budget, then a short plain note. It holds no budget of any kind. */
function inventedMbd(): Uint8Array {
  const head = [0x45, 0x50, 0x43, 0x43, 0x4a, 0x00];
  const filler: number[] = [];
  for (let i = 0, x = 7; i < 2048; i++) filler.push((x = (x * 1103515245 + 12345) >>> 0) >>> 24);
  const note = new TextEncoder().encode('\nVer : 7.0\nNote : invented for the Salt Flat tests\n');
  return Uint8Array.from([...head, ...filler, ...note]);
}
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const thrown = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(SpreadsheetError);
    return (e as Error).message;
  }
  throw new Error('nothing was thrown');
};

describe('Movie Magic Budgeting files', () => {
  const v7 = movieMagicMessage('Salt Flat.mbd');

  it('an .mbd is named for what it is, with the way to export it', () => {
    expect(v7).toMatch(/Movie Magic Budgeting file \(\.mbd\)/);
    expect(v7).toMatch(/Movie Magic Budgeting 10, which opens files from version 7/);
    expect(v7).toMatch(/File, Export, Tab Delimited/);
    expect(thrown(() => readSpreadsheet(inventedMbd(), 'Budget "Salt Flat".mbd'))).toBe(v7);
    expect(thrown(() => parseBudgetFile(buf(inventedMbd()), 'Budget "Salt Flat".mbd'))).toBe(v7);
  });

  it('a renamed .mbd is recognised by its first bytes, not called "not a spreadsheet"', () => {
    for (const name of ['Salt Flat.csv', 'Salt Flat.xlsx', 'Salt Flat.txt', 'Salt Flat.tsv', 'Salt Flat'])
      expect(thrown(() => parseBudgetFile(buf(inventedMbd()), name))).toBe(v7);
  });

  it('an .mmbx gets the version 10 sentence, whatever is inside', () => {
    const v10 = movieMagicMessage('Salt Flat.mmbx');
    expect(v10).toMatch(/Movie Magic Budgeting 10 file/);
    expect(v10).toMatch(/File, Export, Tab Delimited/);
    const csvInside = new TextEncoder().encode('Acct,Description,Total\n1101,Writer,500\n');
    expect(thrown(() => readSpreadsheet(csvInside, 'Salt Flat.MMBX'))).toBe(v10);
  });

  it('a .csv whose first cell happens to be EPCCJ still opens as a .csv (the zero byte is what counts)', () => {
    const text = new TextEncoder().encode('EPCCJ,Description,Total\n1101,Writer,500\n');
    expect(isMovieMagicBudget(text)).toBe(false);
    expect(readSpreadsheet(text, 'odd.csv').sheets[0].rows[1]).toEqual(['1101', 'Writer', '500']);
  });

  it('the sentences are plain: no arrows, no em-dashes', () => {
    for (const m of [v7, movieMagicMessage('x.mmbx')]) expect(m).not.toMatch(/[→—]/);
  });

  it('intake sorts both kinds of Movie Magic file, by name and by its start', () => {
    for (const name of ['Salt Flat.mbd', 'SALT FLAT.MBD', 'Salt Flat.mmbx']) expect(kindOf(name)).toBe('mbd');
    expect(kindFromStart('Salt Flat budget', inventedMbd().subarray(0, 16))).toBe('mbd');
    expect(kindFromStart('Salt Flat notes', new TextEncoder().encode('just some words'))).toBe('unknown');
    // the start wins over the name, so a renamed one never reaches the script or budget readers
    for (const name of ['Salt Flat.csv', 'Salt Flat.txt', 'Salt Flat.xlsx'])
      expect(kindFromStart(name, inventedMbd().subarray(0, 16))).toBe('mbd');
    expect(kindFromStart('Salt Flat.csv', new TextEncoder().encode('Acct,Total\n'))).toBe('budget');
    expect(kindOf('Salt Flat.xlsx')).toBe('budget');
    expect(kindOf('board.sex')).toBe('board');
    expect(kindOf('draft.fountain')).toBe('script');
    expect(kindOf('project.json')).toBe('project');
  });
});
