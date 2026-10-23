// AI breakdown: the model reads the scenes the way a 1st AD and a line producer would and proposes tags, a script
// day, a synopsis, silent cast and whether a scene is VFX only. Everything here is pure: the batches, the prompt,
// the checks on what comes back, and folding an accepted proposal into the board. The call itself lives in ai.ts
// and the review screen in ui/AiBreakdown.tsx; nothing lands on the board until the person accepts it.
import type { Board, Scene } from './types';
import { BREAKDOWN_CATEGORIES, addCast, same } from './breakdown';
import { setSceneUnit } from './board';

export const AI_CATEGORIES = BREAKDOWN_CATEGORIES.map(c => c.key as string);

/** What the model proposes for one scene. `cast` is silent cast only: speaking parts come from the cues already. */
export interface AiSceneTags {
  sceneId: string;
  scriptDay: string;
  synopsis: string;
  vfxOnly: boolean;
  cast: string[];
  elements: Record<string, string[]>;
}

/** Scenes in script order, the ones with text to read, cut into runs of `size`. */
export function aiBatches(board: Board, size = 15, only?: string[]): Scene[][] {
  const scenes = board.scenes.filter(s => s.text?.trim() && (!only || only.includes(s.id)));
  const out: Scene[][] = [];
  for (let i = 0; i < scenes.length; i += size) out.push(scenes.slice(i, i + size));
  return out;
}

export const BREAKDOWN_SYSTEM = `You break down a screenplay for scheduling and budgeting, reading it the way a first assistant director and a line producer read it for cost. You get a run of scenes with an id, the heading and the text (action flush left; character cues and dialogue indented).

For every scene return:
- script_day: the story day it happens on, as a number ("1", "2"...). Track story time across scenes: DAY/NIGHT changes, "next morning", clocks and countdowns. Keep counting from the story so far you are given.
- synopsis: one line, present tense, naming the beat ("Karl overrides the lock and gets out.").
- vfx_only: true only when the first unit has nothing to shoot: an all-CG exterior, a ship in space, no actor on screen. An actor on blue screen is not VFX only.
- silent_cast: names from the cast list who are on screen in this scene without speaking (a hand or a shadow counts). Not someone in a photo, a corpse or a severed head (those are props or makeup), a name plate, a voice off-screen or a blip on a monitor. Use the cast list spelling exactly. Leave out anyone who speaks.
- tags: every element the scene needs, each as a category and a label.

Labels: short and specific, the way a department head would list them ("Tree's futuristic 9mm gun", "Breakaway glass of water", "Roman floats in zero-G (wire rig)"). Reuse a label from the labels already in use, word for word, whenever it is the same thing; add the state in parentheses when it changes ("(disabled)", "(damaged)"). Never tag a cast member as an element.

What to catch:
- Visual Effects for CG, screen graphics and UI that must be built, holograms, comps through windows, digital gore. Special Effects for practical effects on the day: fog, water, rain, smoke, fire, blood rigs, breakaways. Mechanical Effects for rigged mechanisms: doors, clamps, gimbals, anything that moves on cue.
- Special Equipment for video playback that must be shot ahead (a recording on a monitor), wire rigs, process trailers, cranes.
- Stunts: every fight, fall, throw, carry, drag, wire or harness moment. Name the action.
- Makeup/Hair: wounds, blood, bruises, sweat, tears, wet hair, dirt, prosthetics, and how they carry from scene to scene.
- Props for what a person handles, including prosthetic body parts and dummies; Set Dressing for what is in the room; Art Department for graphics, signs, labels, logos and writing on walls.
- Background Actors for extras and for anonymous doubles (a hand double). Wardrobe for what the scene calls for or changes.
- Sound for effects that must be recorded or built (an alarm, a PA announcement, pounding on a hull); Music for songs played on screen.
- Camera for a shot that needs particular gear or a move the scene names (handheld POV, underwater, a drone).
- Notes for nudity, sex, sexual assault and intimacy-coordinator needs, children, weapons safety, and script problems such as a heading that does not match the action.
- Do not tag what is only mentioned in dialogue and never seen.

Return every scene you were given, by its id, through the record_breakdown tool.`;

/** The tool the model must answer through, so the reply is data, not prose. */
export const BREAKDOWN_TOOL = {
  name: 'record_breakdown',
  description: 'Record the breakdown of every scene in this run.',
  input_schema: {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The scene id exactly as given, e.g. sc12' },
            script_day: { type: 'string' },
            synopsis: { type: 'string' },
            vfx_only: { type: 'boolean' },
            silent_cast: { type: 'array', items: { type: 'string' } },
            tags: {
              type: 'array',
              items: {
                type: 'object',
                properties: { category: { type: 'string', enum: AI_CATEGORIES }, label: { type: 'string' } },
                required: ['category', 'label'],
              },
            },
          },
          required: ['id', 'script_day', 'synopsis', 'vfx_only', 'silent_cast', 'tags'],
        },
      },
    },
    required: ['scenes'],
  },
};

/** Labels the earlier runs used, so the same thing keeps one name across the script. Capped so the prompt stays small. */
export function labelsInUse(done: AiSceneTags[], cap = 400): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let n = 0;
  for (const t of done) for (const [cat, items] of Object.entries(t.elements)) for (const it of items) {
    const list = (out[cat] ??= []);
    if (n < cap && !list.some(x => same(x, it))) { list.push(it); n++; }
  }
  return out;
}

/** One run's prompt: the cast list, the labels in use, where the story has got to, then the scenes. */
export function breakdownPrompt(board: Board, batch: Scene[], done: AiSceneTags[] = []): string {
  const labels = labelsInUse(done);
  const recent = done.slice(-6);
  const lastDay = done.length ? done[done.length - 1].scriptDay : '';
  const sceneOf = new Map(board.scenes.map(s => [s.id, s]));
  return [
    `CAST LIST: ${board.castList.map(c => c.name).join(', ') || '(none yet)'}`,
    `CATEGORIES: ${AI_CATEGORIES.join(', ')}`,
    Object.keys(labels).length
      ? `LABELS ALREADY IN USE (reuse word for word when it is the same thing):\n${Object.entries(labels).map(([k, v]) => `${k}: ${v.join(' | ')}`).join('\n')}`
      : 'LABELS ALREADY IN USE: none yet, this is the start of the script.',
    recent.length
      ? `STORY SO FAR (the scenes just before these; the last one is on script day ${lastDay}):\n${recent.map(t => `Scene ${sceneOf.get(t.sceneId)?.number ?? '?'} (day ${t.scriptDay}): ${t.synopsis}`).join('\n')}`
      : 'STORY SO FAR: these are the first scenes; start at script day 1 unless the script says otherwise.',
    `SCENES:\n${batch.map(s => `### id=${s.id} | Scene ${s.number} | ${[s.ie, s.set, s.tod].filter(Boolean).join(' ')}\n${s.text}`).join('\n\n')}`,
  ].join('\n\n');
}

const str = (x: unknown) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');

/** Check what came back against what was sent: unknown scene ids, categories and cast names are dropped, labels are
 *  trimmed and de-duplicated, speaking cast is not repeated as silent cast. Throws when a scene sent is missing. */
export function parseBreakdownReply(input: unknown, batch: Scene[], board: Board): AiSceneTags[] {
  const rows: any[] = Array.isArray((input as any)?.scenes) ? (input as any).scenes : [];
  const wanted = new Map(batch.map(s => [s.id, s]));
  const castNames = new Set(board.castList.map(c => c.name.toUpperCase()));
  const out = new Map<string, AiSceneTags>();
  for (const r of rows) {
    const scene = wanted.get(str(r?.id));
    if (!scene || out.has(scene.id)) continue;
    const speaking = new Set(scene.cast.map(c => c.name.toUpperCase()));
    const named: string[] = (Array.isArray(r.silent_cast) ? r.silent_cast : []).map((x: unknown) => str(x).toUpperCase());
    const cast = [...new Set(named)].filter(n => castNames.has(n) && !speaking.has(n));
    const elements: Record<string, string[]> = {};
    for (const t of Array.isArray(r.tags) ? r.tags : []) {
      const cat = str(t?.category), label = str(t?.label).replace(/[.;,]+$/, '');
      if (!AI_CATEGORIES.includes(cat) || label.length < 2 || label.length > 90 || castNames.has(label.toUpperCase())) continue;
      const list = (elements[cat] ??= []);
      if (!list.some(x => same(x, label))) list.push(label);
    }
    out.set(scene.id, {
      sceneId: scene.id,
      scriptDay: str(r.script_day).replace(/^(?:day|d)\s*/i, ''),
      synopsis: str(r.synopsis),
      vfxOnly: r.vfx_only === true,
      cast,
      elements,
    });
  }
  const missing = batch.filter(s => !out.has(s.id));
  if (missing.length) throw new Error(`the reply left out scene${missing.length > 1 ? 's' : ''} ${missing.map(s => s.number).join(', ')}`);
  return batch.map(s => out.get(s.id)!);
}

/** The part of a proposal that would change the scene: tags it doesn't have yet, cast not on it yet. */
export function whatsNew(scene: Scene, t: AiSceneTags): AiSceneTags {
  const elements: Record<string, string[]> = {};
  for (const [cat, items] of Object.entries(t.elements)) {
    const fresh = items.filter(it => !(scene.elements[cat] ?? []).some(x => same(x, it)));
    if (fresh.length) elements[cat] = fresh;
  }
  return { ...t, cast: t.cast.filter(n => !scene.cast.some(c => c.name === n)), elements };
}

/** Keys for the review screen's tick boxes: one per tag, per silent cast member, and per scene field. */
export const pickKey = {
  tag: (sceneId: string, cat: string, label: string) => `${sceneId}|tag|${cat}|${label}`,
  cast: (sceneId: string, name: string) => `${sceneId}|cast|${name}`,
  day: (sceneId: string) => `${sceneId}|day`,
  synopsis: (sceneId: string) => `${sceneId}|synopsis`,
  vfx: (sceneId: string) => `${sceneId}|vfx`,
};

/** Fold the accepted parts of a proposal into the board. Adds by default: nothing the scene has is taken away.
 *  `replace` swaps the covered scenes' tags for the accepted ones (cast is never removed). A VFX-only pick parks the
 *  scene off the first unit the way the strip's unit button does. Unticked keys in `rejected` are left out. */
export function applyAiBreakdown(board: Board, proposals: AiSceneTags[], rejected: Set<string> = new Set(), opts: { replace?: boolean } = {}): Board {
  let b = board;
  for (const t of proposals) {
    const scene = b.scenes.find(s => s.id === t.sceneId);
    if (!scene) continue;
    const elements: Record<string, string[]> = opts.replace ? {} : Object.fromEntries(Object.entries(scene.elements).map(([k, v]) => [k, [...v]]));
    for (const [cat, items] of Object.entries(t.elements)) for (const it of items) {
      if (rejected.has(pickKey.tag(t.sceneId, cat, it))) continue;
      const list = (elements[cat] ??= []);
      if (!list.some(x => same(x, it))) list.push(it);
    }
    for (const k of Object.keys(elements)) if (!elements[k].length) delete elements[k];
    const next: Scene = {
      ...scene, elements,
      scriptDay: t.scriptDay && !rejected.has(pickKey.day(t.sceneId)) ? t.scriptDay : scene.scriptDay,
      synopsis: t.synopsis && !rejected.has(pickKey.synopsis(t.sceneId)) ? t.synopsis : scene.synopsis,
    };
    b = { ...b, scenes: b.scenes.map(s => s.id === scene.id ? next : s) };
    for (const name of t.cast) if (!rejected.has(pickKey.cast(t.sceneId, name))) b = addCast(b, t.sceneId, name);
    if (t.vfxOnly && !scene.unit && !rejected.has(pickKey.vfx(t.sceneId))) b = setSceneUnit(b, t.sceneId, 'vfx');
  }
  return b;
}
