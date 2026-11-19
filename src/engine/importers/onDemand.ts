// Everything that reads a file someone brings in (a budget spreadsheet, a Movie Magic board, a script), behind one
// door. The app asks for this module with import() the first time a file is dropped or picked, so the page that
// opens first does not carry the readers. (The PDF script reader is asked for on its own: it brings pdf.js with it.)
export { parseBudgetFile } from './budget';
export { parseSex } from './sex';
export { fdxTitle, parseFdx } from './fdx';
export { describeMerge, mergeScriptIntoBoard } from './merge';
export { parseScreenplayLines, parseScreenplayText } from './screenplay';
