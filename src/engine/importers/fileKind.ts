import { isMovieMagicBudget, MOVIE_MAGIC_FILE } from './movieMagic';

/** What a file someone brought in is, as far as its name says. App.tsx sends each kind to its reader. */
export type FileKind = 'project' | 'zip' | 'budget' | 'board' | 'script' | 'mbd' | 'unknown';

export function kindOf(name: string): FileKind {
  if (/\.json$/i.test(name)) return 'project';
  if (/\.zip$/i.test(name)) return 'zip';
  if (/\.(xlsx|xls|csv|tsv)$/i.test(name)) return 'budget';
  if (/\.sex$/i.test(name)) return 'board';
  if (/\.(fdx|pdf|fountain|txt|text)$/i.test(name)) return 'script';
  if (MOVIE_MAGIC_FILE.test(name)) return 'mbd';
  return 'unknown';
}

/** One look at a file's first bytes before its name decides: a Movie Magic budget is named for what it is whether it
 *  lost its .mbd on the way or was renamed .csv or .txt. Anything else keeps its name's kind. */
export function kindFromStart(name: string, start: Uint8Array): FileKind {
  return isMovieMagicBudget(start) ? 'mbd' : kindOf(name);
}
