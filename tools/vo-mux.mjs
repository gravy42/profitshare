// Lays a narration track onto the demo.
//   node tools/vo-mux.mjs analyze demo/vo.mp3     → demo/vo-timing.json (one duration per cue, found by the 1.5 s pauses)
//   node tools/demo.mjs                            → re-records with each cue held for its read; writes demo/cue-times.json
//   node tools/vo-mux.mjs mux demo/vo.mp3          → demo/profitshare-demo.mp4 with each cue placed where its caption appears,
//                                                     a toggleable subtitle track inside it, and .srt / .vtt files beside it
// The narration is demo/voiceover.txt rendered in Chadwick's Pawd Studio (12 cues separated by [PAUSE: 1.5s]).
// Record with DEMO_CAPTIONS=off so the picture is clean and the words live in the subtitle track.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [cmd, voPath] = process.argv.slice(2);
if (!cmd || !voPath) { console.error('usage: vo-mux.mjs analyze|mux <vo.mp3>'); process.exit(1); }
const NOISE = process.env.VO_NOISE || '-38dB', MIN_SIL = process.env.VO_SILENCE || '0.9', OFFSET = +(process.env.VO_OFFSET || 0.15);

function segments() {
  const out = spawnSync('ffmpeg', ['-i', voPath, '-af', `silencedetect=noise=${NOISE}:d=${MIN_SIL}`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const dur = +(/Duration: (\d+):(\d+):([\d.]+)/.exec(out) || [0, 0, 0, 0]).slice(1).reduce((t, v, i) => t + v * [3600, 60, 1][i], 0);
  const sil = [...out.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map(m => [+m[1], +m[2]]);
  const segs = []; let pos = 0;
  for (const [s, e] of sil) { if (s - pos > 0.3) segs.push([pos, s]); pos = e; }
  if (dur - pos > 0.3) segs.push([pos, dur]);
  return { segs, dur };
}

if (cmd === 'analyze') {
  const { segs, dur } = segments();
  console.log(`${voPath}: ${dur.toFixed(1)} s, ${segs.length} spoken segments`);
  segs.forEach(([s, e], i) => console.log(`  cue ${i + 1}: ${s.toFixed(2)} → ${e.toFixed(2)}  (${(e - s).toFixed(2)} s)`));
  if (segs.length !== 12) console.warn(`expected 12 cues; got ${segs.length}. Tune VO_NOISE / VO_SILENCE, or check the pauses in the script.`);
  writeFileSync(root + 'demo/vo-timing.json', JSON.stringify({ cues: segs.map(([s, e]) => +(e - s).toFixed(2)), bounds: segs }, null, 1));
  console.log('wrote demo/vo-timing.json; now run: node tools/demo.mjs, then vo-mux.mjs mux');
}

/** The cue texts from the voice-over script, in order. */
function cueTexts() {
  const src = readFileSync(root + 'demo/voiceover.txt', 'utf8').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l));
  return src.join('\n').split(/\[PAUSE:[^\]]*\]/).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const ts = (s, sep) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = (s % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x.replace('.', sep)}`; };
/** Subtitle files: each cue split at sentence ends into pieces of no more than ~7 s (timed by word share), and a
 *  piece broken into two lines at the space nearest its middle when it runs long. */
function writeSubtitles(starts, bounds) {
  const texts = cueTexts();
  const twoLines = t => { if (t.length <= 42) return t; const m = Math.floor(t.length / 2); let k = t.lastIndexOf(' ', m); const r = t.indexOf(' ', m); if (r >= 0 && (k < 0 || r - m < m - k)) k = r; return k > 0 ? t.slice(0, k) + '\n' + t.slice(k + 1) : t; };
  const entries = [];
  for (let i = 0; i < Math.min(starts.length, bounds.length, texts.length); i++) {
    const dur = bounds[i][1] - bounds[i][0];
    const total = texts[i].split(' ').length;
    const secPerWord = dur / total;
    // sentences, with any sentence over ~8 s cut at the comma nearest its middle
    const sentences = texts[i].match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g).map(x => x.trim()).filter(Boolean).flatMap(sen => {
      if (sen.split(' ').length * secPerWord <= 8) return [sen];
      const m = Math.floor(sen.length / 2); const l = sen.lastIndexOf(',', m), r = sen.indexOf(',', m);
      const k = l < 0 ? r : r < 0 ? l : (m - l <= r - m ? l : r);
      return k > 0 ? [sen.slice(0, k + 1).trim(), sen.slice(k + 1).trim()] : [sen];
    });
    // group sentences so no piece runs much past 7 s
    const pieces = []; let cur = [];
    for (const sen of sentences) {
      const w = x => x.join(' ').split(' ').length;
      if (cur.length && (w(cur) + sen.split(' ').length) * secPerWord > 7) { pieces.push(cur.join(' ')); cur = []; }
      cur.push(sen);
    }
    if (cur.length) pieces.push(cur.join(' '));
    let t = starts[i] + OFFSET;
    for (const piece of pieces) {
      const d = piece.split(' ').length * secPerWord;
      entries.push({ a: t, b: t + d - 0.08, text: twoLines(piece) });
      t += d;
    }
  }
  writeFileSync(root + 'demo/profitshare-demo.srt', entries.map((e, i) => `${i + 1}\n${ts(e.a, ',')} --> ${ts(e.b, ',')}\n${e.text}\n`).join('\n'));
  writeFileSync(root + 'demo/profitshare-demo.vtt', 'WEBVTT\n\n' + entries.map(e => `${ts(e.a, '.')} --> ${ts(e.b, '.')}\n${e.text}\n`).join('\n'));
  return entries.length;
}

if (cmd === 'mux') {
  const { bounds } = JSON.parse(readFileSync(root + 'demo/vo-timing.json', 'utf8'));
  const { cues } = JSON.parse(readFileSync(root + 'demo/cue-times.json', 'utf8'));
  const nSub = writeSubtitles(cues, bounds);
  const video = existsSync(root + 'demo/profitshare-demo.webm') ? root + 'demo/profitshare-demo.webm' : root + 'demo/profitshare-demo-silent.mp4';
  const n = Math.min(bounds.length, cues.length);
  const parts = [], labels = [];
  for (let i = 0; i < n; i++) {
    const [s, e] = bounds[i]; const at = Math.max(0, Math.round((cues[i] + OFFSET) * 1000));
    parts.push(`[1:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS,adelay=${at}|${at}[c${i}]`); labels.push(`[c${i}]`);
  }
  const filter = parts.join(';') + `;${labels.join('')}amix=inputs=${n}:normalize=0:dropout_transition=0,alimiter=limit=0.89[vo]`;
  const out = root + 'demo/profitshare-demo.mp4';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', voPath, '-i', root + 'demo/profitshare-demo.srt', '-filter_complex', filter, '-map', '0:v', '-map', '[vo]', '-map', '2:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=Captions', '-disposition:s:0', '0', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log(`wrote demo/profitshare-demo.mp4 with narration and a ${nSub}-entry subtitle track (off by default; .srt and .vtt beside it)`);
}
