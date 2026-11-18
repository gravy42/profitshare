// "Send it": the files of the deck. A web deck (.html) and PDFs for anyone, and a set for each person with a link
// ending of their own; one person per file. The work is in ./deckSendFiles (loaded when the panel comes into view,
// or when a download is first asked for).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Recipient } from '../engine/types';
import type { DeckImage } from '../deck-runtime/data';
import { deckFileName, estimateEverything, estimateText, heavyFileWarning, sendSummary, type AskKind } from '../engine/deckExport';
import { fileSize } from '../engine/deckEdit';
import { withPitch } from '../engine/pitch';
import { focusSoon, goToId, PANEL } from './jump';

interface Row { key: string; name: string; ending?: string }
interface Sendable { id: string; at: number; slug: string; name: string }
interface Job { text: string; done: number; total: number }
interface Built { bytes: number; images: DeckImage[] }
/** What a button asks for. Kept as words, not as a function, so it is carried out on the project as it is when it runs. */
type Action = { kind: 'web'; row: string } | { kind: 'pdf'; row: string; ask?: AskKind } | { kind: 'all'; sure?: boolean };
type Work = typeof import('./deckSendFiles');

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
const cancelled = () => new DOMException('Cancelled.', 'AbortError');
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// ---------- loading the code that makes the files ----------

/** The export code could not be fetched (offline, most often). Not a fault in the deck. */
export class LoadFailed extends Error { constructor() { super('The export code could not be loaded.'); this.name = 'LoadFailed'; } }
let work: Promise<Work> | null = null;
/** The export code, loaded once. A browser remembers a module that failed to arrive and fails it again without
 *  asking the network, so after a failure the same file is asked for under a new address (its own, with a mark on
 *  the end), which the browser has never seen fail. A failed try is forgotten here too: the next click tries again. */
export function loadWork(load: () => Promise<Work> = () => import('./deckSendFiles'), again: (url: string) => Promise<Work> = url => import(/* @vite-ignore */ url)): Promise<Work> {
  if (!work) {
    const mine: Promise<Work> = load().catch(async (err: unknown) => {
      const url = /(?:https?|file):\/\/[^\s'"]+\.js/.exec(err instanceof Error ? err.message : String(err))?.[0];   // browsers name the file that did not arrive
      if (url) { try { return await again(`${url}?again=${Date.now().toString(36)}`); } catch { /* still not there */ } }
      throw new LoadFailed();
    });
    work = mine;
    mine.catch(() => { if (work === mine) work = null; });
  }
  return work;
}
/** For tests: forget what was loaded. */
export const forgetWork = () => { work = null; };

/** `project` is the project as the page was given it (the same object until something in it changes: sizes and
 *  prepared files are remembered against it). `fixes` is the list of things to fix, as text: a question about them
 *  stays up until it is answered or the list itself changes. */
export default function DeckSend({ project: given, today, people, sendable, fixes, fixesId }: {
  project: Project; today: string; people: Recipient[]; sendable: Sendable[]; fixes: string[]; fixesId: string;
}) {
  const project = useMemo(() => withPitch(given), [given]);
  const film = project.name;
  const summary = useMemo(() => { try { return sendSummary(project); } catch { return null; } }, [project]);
  const twoAsks = !!summary?.twoAsks;
  const rows: Row[] = [{ key: '', name: 'Anyone (no name on it)' }, ...sendable.map(r => ({ key: r.id, name: r.name || r.slug, ending: r.slug }))];
  const got = new Set(sendable.map(r => r.id));
  const noFile = people.map((r, at) => ({ r, at })).filter(({ r }) => !got.has(r.id) && !!(r.name.trim() || r.slug.trim() || r.coverLine.trim() || (r.note ?? '').trim()));
  const fixCount = fixes.length;
  const fixesKey = fixes.join('\n');

  const [job, setJob] = useState<Job | null>(null);
  const [said, setSaid] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, setPending] = useState<{ what: string; action: Action; estimate?: string } | null>(null);
  const [sizes, setSizes] = useState<{ project: Project; built: Map<string, Built> }>({ project, built: new Map() });
  const built = sizes.project === project ? sizes.built : null;   // a size is true only of the project it was made from
  const [missingFonts, setMissingFonts] = useState<string[]>([]);
  const stop = useRef<AbortController | null>(null);
  const running = useRef(false);   // one piece of work at a time, whatever the page has or has not drawn yet
  const alive = useRef(true);
  const box = useRef<HTMLDivElement>(null);
  const now = useRef({ project, rows, twoAsks, film, today, slides: summary?.slides ?? 0 });
  now.current = { project, rows, twoAsks, film, today, slides: summary?.slides ?? 0 };
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current?.abort(); }; }, []);
  // a question about things to fix goes when the things to fix change, not when the project is merely handed over again (its pictures coming back from the browser's store)
  const askedAbout = useRef(fixesKey);
  useEffect(() => { if (askedAbout.current !== fixesKey) { askedAbout.current = fixesKey; setPending(p => (p && !p.estimate ? null : p)); } }, [fixesKey]);
  // fetch the export code while the panel is on screen (and the network is there), not at the moment of the click
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { io.disconnect(); loadWork().catch(() => undefined); } });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const record = (p: Project, key: string, b: Built) => setSizes(s => { const m = new Map(s.project === p ? s.built : []); m.set(key, b); return { project: p, built: m }; });
  const who = (row: Row) => (row.ending ? row.name : 'anyone');
  const describe = (a: Action): string => {
    if (a.kind === 'all') return 'every file';
    const row = rows.find(r => r.key === a.row);
    return `the ${a.kind === 'web' ? 'web deck' : 'PDF'} for ${row ? who(row) : 'them'}`;
  };

  /** Runs one piece of work with the progress line and Cancel; says what went wrong in words. A file is handed to the
   *  browser only while the panel is still there and the work has not been cancelled. */
  const run = async (first: string, body: (w: Work, signal: AbortSignal, step: (j: Job) => void, save: (blob: Blob, name: string) => void) => Promise<string | null>) => {
    if (running.current) return;
    running.current = true;
    const ctl = new AbortController(); stop.current = ctl;
    setSaid(null); setPending(null); setJob({ text: first, done: 0, total: 0 });
    try {
      const w = await loadWork();
      if (ctl.signal.aborted) throw cancelled();
      const save = (blob: Blob, name: string) => { if (!alive.current || ctl.signal.aborted) throw cancelled(); w.downloadBlob(blob, name); };
      const done = await body(w, ctl.signal, j => { if (alive.current && !ctl.signal.aborted) setJob(j); }, save);
      if (alive.current && done) setSaid({ text: done });
    } catch (err) {
      if (!alive.current) return;
      if (isAbort(err) || ctl.signal.aborted) setSaid({ text: 'Cancelled. Nothing was downloaded.' });
      else if (err instanceof LoadFailed) setSaid({ text: 'Could not load the export code. Check your connection and try again.', bad: true });
      else { console.error('The deck could not be made into a file', err); setSaid({ text: 'That file could not be made. Nothing in your project has changed; try once more, and if it fails again, download the project file and report it.', bad: true }); }
    } finally {
      running.current = false;
      if (stop.current === ctl) stop.current = null;
      if (alive.current) setJob(null);
    }
  };

  /** Carries out what a button asked for, on the project as it is now. */
  const perform = (a: Action) => {
    const { project: p, rows: all, twoAsks: two, film: name, today: day, slides } = now.current;
    if (a.kind === 'web' || a.kind === 'pdf') {
      const row = all.find(r => r.key === a.row);
      if (!row) { setPending(null); setSaid({ text: 'That person no longer has a file: their link ending changed.', bad: true }); return; }
      if (a.kind === 'web') void run('Making the web deck…', async (w, _signal, _step, save) => {
        const prep = await w.prepare(p, day);
        const blob = w.webDeck(prep, row.ending);
        const file = deckFileName(name, 'html', { ending: row.ending });
        if (alive.current) { record(p, row.key, { bytes: blob.size, images: prep.data.images }); setMissingFonts(prep.missingFonts); }
        save(blob, file);
        return `Downloaded ${file} (${fileSize(blob.size)}).`;
      });
      else void run('Getting the slides ready…', async (w, signal, step, save) => {
        const prep = await w.prepare(p, day);
        const file = deckFileName(name, 'pdf', { ending: row.ending, ask: a.ask });
        const blob = await w.pdfDeck(prep, { recipient: row.ending, ask: a.ask, signal, onProgress: (d, t) => step({ text: `${file}: slide ${d} of ${t}`, done: d, total: t }) });
        if (alive.current) setMissingFonts(prep.missingFonts);
        save(blob, file);
        return `Downloaded ${file} (${fileSize(blob.size)}).`;
      });
      return;
    }
    void run('Getting the files ready…', async (w, signal, step, save) => {
      const prep = await w.prepare(p, day);
      const asks: (AskKind | undefined)[] = two ? ['with-grants', 'without-grants'] : [undefined];
      const total = all.length * (1 + asks.length);
      const files: { name: string; data: Uint8Array }[] = [];
      let n = 0;
      for (const row of all) {
        if (signal.aborted) throw cancelled();
        const html = w.webDeck(prep, row.ending);
        const htmlName = deckFileName(name, 'html', { ending: row.ending });
        files.push({ name: htmlName, data: await w.blobBytes(html) });
        if (alive.current) record(p, row.key, { bytes: html.size, images: prep.data.images });
        if (n === 0) {
          // the first web deck is made: now the size of the whole download can be said, before the slow part
          const est = estimateText(estimateEverything(html.size, all.length, all.length * asks.length, slides, prep.data.images), total);
          if (est.big && !a.sure) { if (alive.current) setPending({ what: 'every file', action: { kind: 'all', sure: true }, estimate: est.text }); return null; }
          step({ text: `${est.text} File 1 of ${total}: ${htmlName}`, done: 1, total });
          await new Promise(r => setTimeout(r, 900));   // long enough to read
        }
        step({ text: `File ${++n} of ${total}: ${htmlName}`, done: n, total });
        for (const ask of asks) {
          const file = deckFileName(name, 'pdf', { ending: row.ending, ask });
          const at = n;
          const blob = await w.pdfDeck(prep, { recipient: row.ending, ask, signal, onProgress: (d, t) => step({ text: `File ${at + 1} of ${total}: ${file}, slide ${d} of ${t}`, done: at + d / Math.max(1, t), total }) });
          files.push({ name: file, data: await w.blobBytes(blob) });
          n++;
        }
      }
      if (alive.current) setMissingFonts(prep.missingFonts);
      const zip = w.zipOf(files);
      const file = deckFileName(name, 'zip');
      save(zip, file);
      return `Downloaded ${file}: ${files.length} files, ${fileSize(zip.size)}.`;
    });
  };
  /** A download waits for a yes when the deck still has things to fix. */
  const ask = (a: Action) => { if (running.current) return; if (fixCount > 0) { askedAbout.current = fixesKey; setSaid(null); setPending({ what: describe(a), action: a }); } else perform(a); };

  const busy = !!job;
  const heavy = built ? rows.map(r => ({ r, b: built.get(r.key) })).filter(x => x.b && heavyFileWarning(x.b.bytes, x.b.images)) : [];
  const pdfLabel = (row: Row, a?: AskKind) => `Download the PDF for ${who(row)}${a ? (a === 'with-grants' ? ', with grants' : ', without grants') : ''}`;
  const pdfCount = rows.length * (twoAsks ? 2 : 1);

  return (
    <div className="pd-send" id={PANEL.send} ref={box}>
      <h3>Send it</h3>
      <p className="help"><b>Files you can send.</b> The web deck is one file that opens in any browser, with the switches working and no internet needed. The PDF is the same slides, still, one to a page{twoAsks ? ', with the grants counted or without them' : ''}. Each person gets files of their own: nobody else's name, note or cover line is in them. Making the files sends nothing anywhere and fetches nothing from outside this app: it is done in this browser, and the only thing read is the app's own font files, from where the app itself is.</p>

      <div className="pd-sendwrap">
        <table className="pd-sendtable">
          <thead><tr><th scope="col">For</th><th scope="col">Web deck</th><th scope="col">PDF</th><th scope="col">Size of the web deck</th></tr></thead>
          <tbody>
            {rows.map(row => {
              const b = built?.get(row.key);
              return (
                <tr key={row.key || 'anyone'}>
                  <th scope="row">{row.name}{row.ending && <span className="pd-sendfile"> #{row.ending}</span>}</th>
                  <td><button type="button" className="btn small" disabled={busy} aria-label={`Download the web deck for ${who(row)}`} title={deckFileName(film, 'html', { ending: row.ending })} onClick={() => ask({ kind: 'web', row: row.key })}>Download web deck</button></td>
                  <td>
                    {twoAsks ? (
                      <span className="pd-sendpair">
                        <button type="button" className="btn small" disabled={busy} aria-label={pdfLabel(row, 'with-grants')} title={deckFileName(film, 'pdf', { ending: row.ending, ask: 'with-grants' })} onClick={() => ask({ kind: 'pdf', row: row.key, ask: 'with-grants' })}>PDF, with grants</button>
                        <button type="button" className="btn small" disabled={busy} aria-label={pdfLabel(row, 'without-grants')} title={deckFileName(film, 'pdf', { ending: row.ending, ask: 'without-grants' })} onClick={() => ask({ kind: 'pdf', row: row.key, ask: 'without-grants' })}>PDF, without grants</button>
                      </span>
                    ) : <button type="button" className="btn small" disabled={busy} aria-label={pdfLabel(row)} title={deckFileName(film, 'pdf', { ending: row.ending })} onClick={() => ask({ kind: 'pdf', row: row.key })}>Download PDF</button>}
                  </td>
                  <td className="pd-sendsize">{b ? fileSize(b.bytes) : <span className="hint">Shown once it is made</span>}</td>
                </tr>
              );
            })}
            {noFile.map(({ r, at }) => (
              <tr key={r.id} className="pd-nofile">
                <th scope="row">{r.name.trim() || 'Someone with no name yet'}</th>
                <td colSpan={3}><span className="pd-bad">No file: fix the link ending.</span> <button type="button" className="pd-link" onClick={() => { goToId(PANEL.people); focusSoon(`#pd-slug-${at}`); }}>Go to their link ending</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row pd-sendall">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => ask({ kind: 'all' })}>Download everything</button>
        <span className="hint">One .zip with every file above: {rows.length} web deck{rows.length === 1 ? '' : 's'} and {pdfCount} PDF{pdfCount === 1 ? '' : 's'}. How big it will be is said before the PDFs are made.</span>
      </div>

      {pending && !busy && (
        <div className="pd-sendask" role="group" aria-label={pending.estimate ? 'A big download' : 'Things to fix before you send'}>
          {pending.estimate
            ? <span>{pending.estimate}</span>
            : <span>{fixCount === 1 ? 'There is 1 thing to fix on this deck.' : `There are ${fixCount} things to fix on this deck.`} You can still download {pending.what} as it stands.</span>}
          {pending.estimate
            ? <button type="button" className="btn small" onClick={() => setPending(null)}>Not now</button>
            : <button type="button" className="btn small" onClick={() => { setPending(null); goToId(fixesId); }}>Show me</button>}
          <button type="button" className="btn small" autoFocus onClick={() => { const a = pending.action; setPending(null); perform(a); }}>Download anyway</button>
        </div>
      )}
      <div className={`pd-status${job || said ? ' on' : ''}`} role="status" aria-live="polite">
        {job && <><span>{job.text}</span>{job.total > 0 && <progress value={job.done} max={job.total} aria-label="How far along" />}<button type="button" className="btn small" onClick={() => stop.current?.abort()}>Cancel</button></>}
        {!job && said && <><span className={said.bad ? 'pd-bad' : undefined}>{said.text}</span><button type="button" className="pd-mini" aria-label="Dismiss this message" onClick={() => setSaid(null)}>×</button></>}
      </div>

      {heavy.map(({ r, b }) => <p key={r.key} className="pd-bad small">{r.ending ? `${r.name}'s web deck: ` : 'The web deck for anyone: '}{heavyFileWarning(b!.bytes, b!.images)}</p>)}
      {summary && (
        <p className="hint pd-sendfonts">
          <b>Fonts inside these files:</b> {summary.inside.length ? `${list(summary.inside)}.` : 'none. The deck uses fonts every computer has.'}
          {summary.leftOut.length > 0 && <> <b>Not inside:</b> {list(summary.leftOut)}. Its box under Design system is not ticked, so readers see the next font in the list. <button type="button" className="pd-link" onClick={() => goToId(PANEL.design)}>Go to Design system</button></>}
          {' '}Pictures go in at 1,600 pixels on the long side at most, drawn again so that nothing a camera wrote beside them (the place, the date) goes along, and only the ones a slide uses. Hidden slides are never in a file.
        </p>
      )}
      {missingFonts.length > 0 && <p className="pd-bad small">{list(missingFonts)} could not be read just now (the app needs its own font files, and this browser could not get them), so the last file went without {missingFonts.length === 1 ? 'it' : 'them'} and uses a standard font instead. Reload the page while online and download again.</p>}

      <details className="pd-where">
        <summary>Where to put it</summary>
        <ol>
          <li><b>Email it.</b> The simplest way. Attach the web deck or the PDF to your note. The web deck is a single .html file: it opens in any browser when it is double-clicked, on a computer or a phone, with no internet. Some mail services hold back .html attachments; if yours does, attach the PDF, or put the web deck in a .zip.</li>
          <li><b>Put it on a file share that serves web pages.</b> Some file-sharing and static-hosting services show an .html file as a page when someone opens its link. One that only offers the file as a download works too: the reader opens it from their downloads.</li>
          <li><b>Host it on your own site.</b> Upload the file to your website, or to GitHub Pages (free for a public repository), and give out an address on your own domain that forwards to it. Anyone who has the address can open the file, so give each person's file a name that is not easy to guess.</li>
        </ol>
        <p className="hint"><b>Link endings.</b> Each person's file already opens as theirs: there is nothing to add to its address. {twoAsks ? <>Any of these files opens on the ask it was made for; add <code>#without</code> to the end of its address to open on the larger ask (no grants), or <code>#with</code> for the smaller one. </> : null}A file never holds more than one person, so no link ending can show one person's deck to another.</p>
      </details>
    </div>
  );
}
