// Lays a narration track onto the demo.
//   node tools/vo-mux.mjs analyze demo/vo.mp3     → demo/vo-timing.json (one duration per cue, found by the 1.5 s pauses)
//   node tools/demo.mjs                            → re-records with each cue held for its read; writes demo/cue-times.json
//   node tools/vo-mux.mjs mux demo/vo.mp3          → demo/profitshare-demo.mp4 with each cue placed where its caption appears
// The narration is demo/voiceover.txt rendered in Chadwick's Pawd Studio (12 cues separated by [PAUSE: 1.5s]).
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

if (cmd === 'mux') {
  const { bounds } = JSON.parse(readFileSync(root + 'demo/vo-timing.json', 'utf8'));
  const { cues } = JSON.parse(readFileSync(root + 'demo/cue-times.json', 'utf8'));
  const video = existsSync(root + 'demo/profitshare-demo.webm') ? root + 'demo/profitshare-demo.webm' : root + 'demo/profitshare-demo-silent.mp4';
  const n = Math.min(bounds.length, cues.length);
  const parts = [], labels = [];
  for (let i = 0; i < n; i++) {
    const [s, e] = bounds[i]; const at = Math.max(0, Math.round((cues[i] + OFFSET) * 1000));
    parts.push(`[1:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS,adelay=${at}|${at}[c${i}]`); labels.push(`[c${i}]`);
  }
  const filter = parts.join(';') + `;${labels.join('')}amix=inputs=${n}:normalize=0:dropout_transition=0,alimiter=limit=0.89[vo]`;
  const out = root + 'demo/profitshare-demo.mp4';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', voPath, '-filter_complex', filter, '-map', '0:v', '-map', '[vo]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('wrote demo/profitshare-demo.mp4 with narration');
}
