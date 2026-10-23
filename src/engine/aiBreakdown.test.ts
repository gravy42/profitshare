import { describe, it, expect } from 'vitest';
import type { Board, Scene } from './types';
import { aiBatches, applyAiBreakdown, breakdownPrompt, labelsInUse, parseBreakdownReply, pickKey, whatsNew, BREAKDOWN_TOOL, AI_CATEGORIES, type AiSceneTags } from './aiBreakdown';
import { parkedScenes } from './board';

const scene = (n: number, text: string, extra: Partial<Scene> = {}): Scene => ({
  id: `sc${n}`, number: String(n), ie: 'INT', set: 'CONTROL ROOM - AMNESTY', tod: 'DAY', pages: '1', eighths: 4,
  synopsis: '', location: '', scriptDay: '', cast: [], elements: {}, text, ...extra,
});
const board = (): Board => ({
  castList: [{ id: 1, name: 'TREE' }, { id: 2, name: 'KARL' }],
  scenes: [
    scene(1, 'A small sleek space ship drifts.', { ie: 'EXT', set: 'AMNESTY (MOVING)' }),
    scene(2, 'Tree pulls a 9mm gun out of a cabinet.\n                    TREE\n          Take it.', { cast: [{ id: 1, name: 'TREE' }], elements: { Props: ['Gun'] } }),
    scene(3, 'Karl kicks away his spacesuit.'),
    scene(4, ''),
  ],
  strips: [1, 2, 3, 4].map(n => ({ type: 'scene' as const, sceneId: `sc${n}` })),
  targetEighthsPerDay: 40,
});
const reply = (over: Partial<Record<string, unknown>>[] = []) => ({
  scenes: [
    { id: 'sc1', script_day: '1', synopsis: 'The Amnesty travels.', vfx_only: true, silent_cast: [], tags: [{ category: 'Visual Effects', label: 'AMNESTY EXT (CG)' }] },
    { id: 'sc2', script_day: 'Day 1', synopsis: 'Tree offers her gun.', vfx_only: false, silent_cast: ['TREE', 'KARL'], tags: [{ category: 'Props', label: "Tree's 9mm gun" }, { category: 'Props', label: 'gun' }, { category: 'Set Dressing', label: 'Weapons cabinet' }] },
    ...over,
  ],
});

describe('AI breakdown', () => {
  it('batches only scenes with text, in script order', () => {
    expect(aiBatches(board(), 2).map(b => b.map(s => s.id))).toEqual([['sc1', 'sc2'], ['sc3']]);
    expect(aiBatches(board(), 15, ['sc3']).map(b => b.map(s => s.id))).toEqual([['sc3']]);
  });

  it('builds a prompt with the cast, the labels already used and the story so far', () => {
    const b = board();
    const done: AiSceneTags[] = [{ sceneId: 'sc1', scriptDay: '1', synopsis: 'The Amnesty travels.', vfxOnly: true, cast: [], elements: { 'Visual Effects': ['AMNESTY EXT (CG)'] } }];
    const p = breakdownPrompt(b, [b.scenes[1]], done);
    expect(p).toContain('CAST LIST: TREE, KARL');
    expect(p).toContain('Visual Effects: AMNESTY EXT (CG)');
    expect(p).toContain('Scene 1 (day 1): The Amnesty travels.');
    expect(p).toContain('### id=sc2 | Scene 2 | INT CONTROL ROOM - AMNESTY DAY');
    expect(p).toContain('Tree pulls a 9mm gun');
    expect(breakdownPrompt(b, [b.scenes[0]])).toContain('start at script day 1');
  });

  it('offers the board its full category set, the three Movie Magic additions included', () => {
    expect(AI_CATEGORIES).toEqual(expect.arrayContaining(['Camera', 'Art Department', 'Mechanical Effects', 'Visual Effects']));
    expect((BREAKDOWN_TOOL.input_schema.properties.scenes.items.properties.tags.items.properties.category as any).enum).toEqual(AI_CATEGORIES);
  });

  it('checks the reply: drops unknown scenes, categories and cast, de-dupes labels, keeps speaking cast out of silent cast', () => {
    const b = board();
    const out = parseBreakdownReply(reply([
      { id: 'sc99', script_day: '1', synopsis: 'x', vfx_only: false, silent_cast: [], tags: [] },
    ]), [b.scenes[0], b.scenes[1]], b);
    expect(out.map(t => t.sceneId)).toEqual(['sc1', 'sc2']);
    expect(out[1].scriptDay).toBe('1');                         // "Day 1" → "1"
    expect(out[1].cast).toEqual(['KARL']);                      // TREE speaks in the scene already
    expect(out[1].elements.Props).toEqual(["Tree's 9mm gun", 'gun']);
    const odd = parseBreakdownReply({ scenes: [{ id: 'sc3', script_day: '1', synopsis: 's', vfx_only: false, silent_cast: ['STRANGER'], tags: [{ category: 'Lighting', label: 'Lamp' }, { category: 'Props', label: 'KARL' }, { category: 'Props', label: 'Spacesuit.' }] }] }, [b.scenes[2]], b);
    expect(odd[0].cast).toEqual([]);                            // not on the cast list
    expect(odd[0].elements).toEqual({ Props: ['Spacesuit'] }); // unknown category and a cast name as a prop are dropped
  });

  it('throws when a scene sent is missing from the reply', () => {
    const b = board();
    expect(() => parseBreakdownReply({ scenes: [] }, [b.scenes[0]], b)).toThrow(/left out scene 1/);
  });

  it('shows only what is new for a scene', () => {
    const b = board();
    const [, t2] = parseBreakdownReply(reply(), [b.scenes[0], b.scenes[1]], b);
    expect(whatsNew(b.scenes[1], t2).elements).toEqual({ Props: ["Tree's 9mm gun"], 'Set Dressing': ['Weapons cabinet'] });
  });

  it('adds the accepted tags, keeps what the scene had, and leaves out what was unticked', () => {
    const b = board();
    const props = parseBreakdownReply(reply(), [b.scenes[0], b.scenes[1]], b);
    const rejected = new Set([pickKey.tag('sc2', 'Set Dressing', 'Weapons cabinet'), pickKey.synopsis('sc2'), pickKey.vfx('sc1')]);
    const next = applyAiBreakdown(b, props, rejected);
    const s2 = next.scenes[1];
    expect(s2.elements).toEqual({ Props: ['Gun', "Tree's 9mm gun"] });
    expect(s2.scriptDay).toBe('1');
    expect(s2.synopsis).toBe('');                               // unticked
    expect(s2.cast.map(c => c.name)).toEqual(['TREE', 'KARL']);
    expect(next.scenes[0].unit).toBeUndefined();                // VFX-only suggestion unticked
    expect(b.scenes[1].elements).toEqual({ Props: ['Gun'] });   // the board passed in is untouched
  });

  it('parks a VFX-only scene when that is ticked, and replace swaps the tags', () => {
    const b = board();
    const props = parseBreakdownReply(reply(), [b.scenes[0], b.scenes[1]], b);
    const next = applyAiBreakdown(b, props, new Set(), { replace: true });
    expect(next.scenes[0].unit).toBe('vfx');
    expect(parkedScenes(next).map(s => s.id)).toEqual(['sc1']);
    expect(next.strips[next.strips.length - 1]).toEqual({ type: 'scene', sceneId: 'sc1' });
    expect(next.scenes[1].elements).toEqual({ Props: ["Tree's 9mm gun", 'gun'], 'Set Dressing': ['Weapons cabinet'] });   // the scene's own "Gun" is gone; the list is the AI's
  });

  it('collects labels across runs without repeats', () => {
    const l = labelsInUse([
      { sceneId: 'a', scriptDay: '1', synopsis: '', vfxOnly: false, cast: [], elements: { Props: ['Gun', 'Note'] } },
      { sceneId: 'b', scriptDay: '1', synopsis: '', vfxOnly: false, cast: [], elements: { Props: ['gun'], Sound: ['Alarm'] } },
    ]);
    expect(l).toEqual({ Props: ['Gun', 'Note'], Sound: ['Alarm'] });
  });
});
