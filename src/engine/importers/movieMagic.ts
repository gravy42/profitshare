// Movie Magic Budgeting's own files, as opposed to its exports. Version 7 saves a budget as .mbd and version 10 keeps
// local files as .mmbx. ProfitShare reads neither, so the job here is only to know one when it arrives, by name or by
// its first bytes, and to say in one sentence how to get a file ProfitShare does read.
//
// What a version 7 .mbd looks like: it opens with the letters EPCCJ and a zero byte, everything after that up to a
// short plain-text note at the end (version, build, the computer it was saved on) is enciphered, and nothing in it is
// a spreadsheet or a known compressed format. Checked against a real Movie Magic Budgeting 7 file, 19 Nov 2026;
// that file is not in the repo. The zero byte matters: a .csv cannot have one, so a CSV whose first cell happens to be
// "EPCCJ" still opens as a CSV.
//
// The way forward, from Entertainment Partners' own pages, checked 19 Nov 2026:
// - Movie Magic Budgeting 10 imports .mbd files saved by version 7, and .mmbx files.
//   https://mmb-docs.ep.com/Projects_and_Budgets/importexport.html
// - Version 7 is "Legacy Movie Magic Budgeting", supported until 31 March 2025; its files can be imported into 10.
//   https://www.ep.com/support/legacy-movie-magic-budgeting/
// - Version 10 exports a budget with File, Export, then the format, for example Tab Delimited. ProfitShare reads a
//   tab-delimited .txt as a budget (see sniff in App.tsx and parseDelimited).
//   https://mmb-docs.ep.com/Projects_and_Budgets/importexport.html

/** A file name that is Movie Magic Budgeting's own format, version 7 (.mbd) or 10 (.mmbx). */
export const MOVIE_MAGIC_FILE = /\.(mbd|mmbx)$/i;

const MBD_START = [0x45, 0x50, 0x43, 0x43, 0x4a, 0x00]; // "EPCCJ" and a zero byte

/** Do these bytes start the way a Movie Magic Budgeting 7 .mbd does, whatever the file is called? */
export function isMovieMagicBudget(bytes: Uint8Array): boolean {
  return bytes.length >= MBD_START.length && MBD_START.every((x, i) => bytes[i] === x);
}

/** What to tell someone who brought one in. A name ending .mmbx gets the version 10 wording; anything else (an .mbd,
 *  or a file of any name that starts like one) gets the version 7 wording, which also says version 10 opens it. */
export function movieMagicMessage(filename = ''): string {
  return /\.mmbx$/i.test(filename)
    ? 'This is a Movie Magic Budgeting 10 file, which ProfitShare does not read. Open it in Movie Magic Budgeting, choose File, Export, Tab Delimited, and drop the file that makes here.'
    : 'This is a Movie Magic Budgeting file (.mbd). It is locked, so ProfitShare cannot read it. Open it in Movie Magic Budgeting 10, which opens files from version 7, choose File, Export, Tab Delimited, and drop the file that makes here.';
}
