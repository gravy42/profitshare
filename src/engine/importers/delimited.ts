import { chargeGrid, LIMITS, newBudget, tooBig, type Budget, type Cell } from './sheetLimits';

/** Our own reader for comma / tab / semicolon / pipe separated text (.csv, .tsv, .txt budget exports).
 *
 *  It reproduces, on purpose, what the spreadsheet library we used to ship did with the same text, so budgets that
 *  imported before import the same now:
 *    - the separator is whichever of , tab ; | appears most often outside quotes in the first 1,024 characters
 *      (ties go to comma, then tab, then semicolon), unless the first line is Excel's "sep=;" hint;
 *    - a field that starts with a double quote runs to its closing quote, and may contain the separator, line breaks
 *      and doubled quotes ("" is one "); the outer quotes come off only when the field both starts and ends with one;
 *    - every value stays text exactly as written (no trimming, no number or date guessing: the importer does that);
 *    - \r\n, \n and a lone \r all end a row; a blank line is kept as a blank row; a final line break adds no row;
 *    - every row is padded with '' to the width of the widest row.
 *  One pass over the text by index, no regular expressions on the content. */

const QUOTE = 0x22, LF = 0x0a, CR = 0x0d;
const SEPARATORS = [0x2c, 0x09, 0x3b, 0x7c];            // , tab ; |   in tie-break order (first wins)

/** Which separator the text uses. Looks at the first 1,024 characters only. */
export function guessSeparator(text: string): string {
  const counts = [0, 0, 0, 0];
  let quoted = false;
  const end = Math.min(text.length, 1024);
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) quoted = !quoted;
    else if (!quoted) { const k = SEPARATORS.indexOf(c); if (k >= 0) counts[k]++; }
  }
  let best = 0;
  for (let k = 1; k < counts.length; k++) if (counts[k] > counts[best]) best = k;
  return String.fromCharCode(SEPARATORS[best]);
}

export function parseDelimited(input: string, budget: Budget = newBudget()): Cell[][] {
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;      // byte-order mark
  let sep: string;
  if (text.startsWith('sep=') && text.charCodeAt(5) === CR && text.charCodeAt(6) === LF) { sep = text.charAt(4); text = text.slice(7); }
  else if (text.startsWith('sep=') && (text.charCodeAt(5) === CR || text.charCodeAt(5) === LF)) { sep = text.charAt(4); text = text.slice(6); }
  else sep = guessSeparator(text);
  const sepCode = sep.charCodeAt(0);
  text = text.split('\r\n').join('\n');

  const rows: string[][] = [];
  let width = 0, filled = 0;
  let row = 0, col = 0, start = 0, quoted = false;
  let startsQuoted = text.charCodeAt(0) === QUOTE;
  const finish = (end: number, endedBy: number) => {
    let s = text.slice(start, end);
    if (s.length >= 2 && s.charCodeAt(0) === QUOTE && s.charCodeAt(s.length - 1) === QUOTE) s = s.slice(1, -1).split('""').join('"');
    else if (s === '"') s = '';
    if (row >= LIMITS.rows) throw tooBig.rows('');
    if (col >= LIMITS.columns) throw tooBig.columns('');
    while (rows.length <= row) rows.push([]);
    if (s !== '') {
      const r = rows[row];
      while (r.length < col) r.push('');
      r.push(s);
      if (++filled + budget.cells > LIMITS.cells) throw tooBig.cells();
    }
    if (col + 1 > width) width = col + 1;
    start = end + 1; startsQuoted = text.charCodeAt(start) === QUOTE;
    if (endedBy === sepCode) col++; else { col = 0; row++; }
  };
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) { if (startsQuoted) quoted = !quoted; }
    else if (!quoted && (c === sepCode || c === LF || c === CR)) finish(i, c);
  }
  if (n - start > 0) finish(n, LF);

  budget.cells += filled;
  chargeGrid(budget, '', rows.length, width);
  for (const r of rows) while (r.length < width) r.push('');
  return rows;
}
