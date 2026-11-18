/** What a spreadsheet reader hands the budget importers: every sheet in workbook order, each as a grid of rows.
 *  A cell is text, a number, true/false, or '' when it is empty (null only for Excel's #NULL! error, as before).
 *  Every row of a sheet has the same width; blank rows inside the sheet are kept so row numbers still line up. */
export type Cell = string | number | boolean | null;
export interface SheetRows { name: string; rows: Cell[][] }
export interface Workbook { sheets: SheetRows[] }

/** An error whose message is written for the person who dropped the file, not for a programmer. */
export class SpreadsheetError extends Error {
  constructor(message: string) { super(message); this.name = 'SpreadsheetError'; }
}

/** Hard ceilings, so a file built to exhaust memory (a "zip bomb", a sheet claiming a billion rows) is refused
 *  quickly instead of hanging the tab. A long feature budget is a few thousand rows of about twenty columns:
 *  these are two orders of magnitude above that. */
export const LIMITS = {
  /** The file as dropped. */
  fileBytes: 50 * 1024 * 1024,
  /** Everything we unpack from inside an .xlsx, added up. */
  unzippedBytes: 100 * 1024 * 1024,
  /** Entries in the .xlsx's zip directory. */
  zipEntries: 10_000,
  sheets: 200,
  /** Highest row / column a cell may sit on. */
  rows: 200_000,
  columns: 2_000,
  /** Cells with something in them, across the whole file. */
  cells: 500_000,
  /** Letters of text in the cells, across the whole file, counted each time a cell uses them. */
  chars: 20_000_000,
  /** Cells in the grids we hand back (filled and blank), across the whole file. */
  gridCells: 3_000_000,
} as const;

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
const count = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ',');   // 200000 -> 200,000 (anchored, linear)

export const tooBig = {
  file: (bytes: number) => new SpreadsheetError(`This file is ${mb(bytes)}, and ProfitShare reads spreadsheets up to ${mb(LIMITS.fileBytes)}. Save a copy with only the budget sheets in it and drop that.`),
  unzipped: () => new SpreadsheetError(`This spreadsheet unpacks to more than ${mb(LIMITS.unzippedBytes)}, which is far bigger than any budget. It was not opened. Save a copy with only the budget sheets in it and drop that.`),
  sheets: (n: number) => new SpreadsheetError(`This workbook has ${count(n)} sheets, and ProfitShare reads up to ${count(LIMITS.sheets)}. Save a copy with only the budget sheets in it and drop that.`),
  rows: (sheet: string) => new SpreadsheetError(`${where(sheet)} goes past row ${count(LIMITS.rows)}, which is more than ProfitShare reads. Delete the unused rows at the bottom, or save a copy with only the budget in it, and drop that.`),
  columns: (sheet: string) => new SpreadsheetError(`${where(sheet)} goes past ${count(LIMITS.columns)} columns, which is more than ProfitShare reads. Delete the unused columns on the right, or save a copy with only the budget in it, and drop that.`),
  cells: () => new SpreadsheetError(`This spreadsheet has more than ${count(LIMITS.cells)} filled cells, which is more than ProfitShare reads. Save a copy with only the budget sheets in it and drop that.`),
  text: () => new SpreadsheetError('This spreadsheet holds far more text than a budget does, so it was not opened. Save a copy with only the budget sheets in it and drop that.'),
  grid: (sheet: string) => new SpreadsheetError(`${where(sheet)} is spread over too large an area to read (more than ${count(LIMITS.gridCells)} cells, counting the blank ones). Delete the unused rows and columns, or save a copy with only the budget in it, and drop that.`),
};
const where = (sheet: string) => sheet ? `The sheet "${sheet.length > 40 ? sheet.slice(0, 40) + '…' : sheet}"` : 'This file';

/** Shared across the sheets of one file so the ceilings apply to the file, not to each sheet. */
export interface Budget { cells: number; gridCells: number; chars: number }
export const newBudget = (): Budget => ({ cells: 0, gridCells: 0, chars: 0 });

/** Check a grid of `rows` × `columns` against the ceilings and charge it to the file's budget. */
export function chargeGrid(budget: Budget, sheet: string, rows: number, columns: number): void {
  if (rows > LIMITS.rows) throw tooBig.rows(sheet);
  if (columns > LIMITS.columns) throw tooBig.columns(sheet);
  budget.gridCells += rows * columns;
  if (budget.gridCells > LIMITS.gridCells) throw tooBig.grid(sheet);
}
