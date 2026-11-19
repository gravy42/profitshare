// "Download all my projects" and its way back in. Every project this browser holds goes into one .zip, each as its own
// .profitshare.json exactly as Save would write it; Open takes the .zip (or the files) and brings each in as a project
// of its own. The list, the file names and the text of each project come from the same code the crash screen uses.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { downloadText, noteDownloaded, savedProjectList, savedProjectText, type KV } from './store';

interface ProjectFile { name: string; text: string }

/** "ProfitShare-projects-2026-11-18.zip": the day it was made, as the person's own clock has it. */
export function allProjectsZipName(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `ProfitShare-projects-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.zip`;
}

/** A .zip of the project files. Names come in already safe and unique (savedProjectList); one that is not is made so
 *  here all the same, since a name with a folder in it would be written as a folder. */
export function projectsZip(files: ProjectFile[], now: Date = new Date()): Uint8Array {
  const taken = new Set<string>(), tree: Zippable = {};
  const mtime = now.getFullYear() >= 1980 && now.getFullYear() <= 2099 ? now : new Date(2000, 0, 1);   // all the format can hold
  for (const f of files) {
    const clean = f.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '') || 'project.profitshare.json';
    const dot = /\.profitshare\.json$/i.test(clean) ? clean.length - '.profitshare.json'.length : clean.length;
    let name = clean;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${clean.slice(0, dot)}_${n}${clean.slice(dot)}`;
    taken.add(name.toLowerCase());
    tree[name] = [strToU8(f.text), { level: 3, mtime }];
  }
  return zipSync(tree);
}

// A .zip is somebody else's file until it has been read, and a small one can unpack into gigabytes. Only project
// files are unpacked, and never more than this.
const ZIP_LIMITS = { files: 200, fileBytes: 150_000_000, totalBytes: 400_000_000 };
const isProjectName = (path: string) => /\.json$/i.test(path) && !/(^|\/)(__MACOSX\/|\.)/.test(path);
/** The project files inside a .zip, as text, in the order they are in it. Folders are looked into; anything that is
 *  not a .json is passed over. Throws, in plain words, when it is not a .zip or holds more than the limits. */
export function readProjectsZip(bytes: Uint8Array, limits = ZIP_LIMITS): ProjectFile[] {
  let count = 0, total = 0;
  let files: Record<string, Uint8Array>;
  const tooBig = new Error('This .zip holds more than ProfitShare will unpack at once. Unzip it on your computer and open the project files from the folder.');
  try {
    files = unzipSync(bytes, {
      filter: f => {
        if (!isProjectName(f.name)) return false;
        count++; total += f.originalSize;
        if (count > limits.files || f.originalSize > limits.fileBytes || total > limits.totalBytes) throw tooBig;
        return true;
      },
    });
  } catch (e) {
    if (e === tooBig) throw e;
    throw new Error('This .zip could not be read. It may be damaged, or locked with a password.');
  }
  return Object.entries(files).map(([path, data]) => ({ name: path.split('/').pop() || path, text: strFromU8(data) }));
}

/** Every saved project, downloaded: one .zip, or with a single project just its file. Each one that went in is noted
 *  as saved to a file. Says what happened in a sentence. */
export async function downloadAllProjects(kv?: KV | null, now: Date = new Date()): Promise<{ count: number; fileName: string; said: string }> {
  const files: (ProjectFile & { id: string })[] = [];
  for (const p of kv === undefined ? savedProjectList() : savedProjectList(kv)) {
    const text = kv === undefined ? await savedProjectText(p.id) : await savedProjectText(p.id, kv);
    if (text !== null) files.push({ id: p.id, name: p.fileName, text });
  }
  if (files.length === 0) return { count: 0, fileName: '', said: 'There was nothing to download.' };
  const fileName = files.length === 1 ? files[0].name : allProjectsZipName(now);
  if (files.length === 1) downloadText(files[0].text, fileName);
  else downloadText(projectsZip(files, now), fileName, 'application/zip');
  for (const f of files) { if (kv === undefined) noteDownloaded(f.id); else noteDownloaded(f.id, kv, now.getTime()); }
  return { count: files.length, fileName, said: files.length === 1
    ? `1 project downloaded as ${fileName}. Look in your Downloads folder, and keep it somewhere safe.`
    : `${files.length} projects downloaded in ${fileName}. Look in your Downloads folder, and keep it somewhere safe.` };
}
