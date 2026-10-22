// Optional AI help on the Pitch tab. Off unless the person pastes their own Anthropic key, which lives in this
// browser's storage only (never in the project file, never in the repo). Calls go straight from the browser to
// api.anthropic.com; the project brief sent with each request is the pitch, the budget figures and the schedule
// in a few hundred words, so the person should know that much leaves their machine when they press Draft.
import type { Project } from './engine/types';
import { withPitch, compGroups, compStats, projections } from './engine/pitch';
import { topSheet } from './engine/budget';
import { sagReport } from './engine/sag';
import { shootDays, parkedScenes } from './engine/board';
import { recoupableBudget } from './engine/waterfall';
import { money } from './ui/format';
import { idbGet, idbSet, idbDel, idbKeys, STORES } from './idb';

const KEY = 'profitshare.ai.key';
const MODEL = 'profitshare.ai.model';
export const DEFAULT_MODEL = 'claude-sonnet-4-5';

export interface AiSettings { key: string; model: string }
export function aiSettings(): AiSettings {
  try { return { key: localStorage.getItem(KEY) ?? '', model: localStorage.getItem(MODEL) || DEFAULT_MODEL }; } catch { return { key: '', model: DEFAULT_MODEL }; }
}
export function saveAiSettings(s: AiSettings) {
  try { if (s.key) localStorage.setItem(KEY, s.key); else localStorage.removeItem(KEY); localStorage.setItem(MODEL, s.model || DEFAULT_MODEL); } catch { /* private window */ }
}
export function forgetAi() { try { localStorage.removeItem(KEY); localStorage.removeItem(MODEL); } catch { /* ignore */ } }
export const aiReady = () => !!aiSettings().key;

const headers = (key: string) => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });

/** The models this key can use, newest first; empty when the call fails (the person can still type an id). */
export async function listModels(key: string): Promise<{ id: string; name: string }[]> {
  const r = await fetch('https://api.anthropic.com/v1/models?limit=50', { headers: headers(key) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.data ?? []).map((m: any) => ({ id: m.id, name: m.display_name ?? m.id }));
}

// ---- documents the AI reads: a look book, a treatment, a deck, as PDFs kept in this browser only ----
export interface AiDoc { id: string; name: string; size: number; added: string }
const DOC_META = (id: string) => `meta:${id}`, DOC_DATA = (id: string) => `data:${id}`;
export async function aiDocs(): Promise<AiDoc[]> {
  const keys = await idbKeys(STORES.docs).catch(() => [] as string[]);
  const metas = await Promise.all(keys.filter(k => k.startsWith('meta:')).map(k => idbGet<AiDoc>(STORES.docs, k)));
  return metas.filter((m): m is AiDoc => !!m).sort((a, b) => a.added.localeCompare(b.added));
}
export async function addAiDoc(file: File): Promise<AiDoc> {
  if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(0)} MB; the model reads PDFs up to about 30 MB and 100 pages.`);
  const id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const meta: AiDoc = { id, name: file.name, size: file.size, added: new Date().toISOString() };
  await idbSet(STORES.docs, DOC_DATA(id), await file.arrayBuffer());
  await idbSet(STORES.docs, DOC_META(id), meta);
  return meta;
}
export async function removeAiDoc(id: string) { await idbDel(STORES.docs, DOC_DATA(id)); await idbDel(STORES.docs, DOC_META(id)); }
const b64 = (buf: ArrayBuffer) => { const bytes = new Uint8Array(buf); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
async function docBlocks(): Promise<any[]> {
  const docs = await aiDocs();
  const out: any[] = [];
  for (const d of docs) { const data = await idbGet<ArrayBuffer>(STORES.docs, DOC_DATA(d.id)); if (data) out.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(data) }, title: d.name }); }
  return out;
}

/** One completion. The documents in the browser's store ride along with every request. Throws with the API's message on failure. */
export async function ask(system: string, prompt: string, opts: { maxTokens?: number; model?: string } = {}): Promise<string> {
  const s = aiSettings();
  if (!s.key) throw new Error('No API key. Paste one under AI assist on the Pitch tab.');
  const docs = await docBlocks();
  const content = docs.length ? [...docs, { type: 'text', text: prompt }] : prompt;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: headers(s.key),
    body: JSON.stringify({ model: opts.model ?? s.model, max_tokens: opts.maxTokens ?? 1200, system, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) {
    let msg = `${r.status}`; try { const j = await r.json(); msg = j.error?.message ?? msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  const j = await r.json();
  return (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
}

/** What the model is told about the film: the pitch so far, the money, the schedule, the deal. Pure; tested. */
export function projectBrief(p0: Project): string {
  const p = withPitch(p0); const pitch = p.pitch!;
  const e = p; const ts = topSheet(e); const sag = sagReport(e);   // the views hand over the project with the deal applied; applying it again inflated the budget the model was told
  const days = shootDays(p.board); const parked = parkedScenes(p.board);
  const pr = projections(p);
  const sets = [...new Set(p.board.scenes.filter(s => !s.unit).map(s => s.set))];
  const cast = p.board.castList.slice(0, 12).map(c => c.name).join(', ');
  const comps = compGroups(pitch.comps).map(g => { const st = compStats(g.comps); return `${g.group}: ${g.comps.map(c => `${c.title}${c.year ? ` (${c.year})` : ''}${c.budget ? ` budget ${money(c.budget)}` : ''}${c.worldwide ? ` worldwide ${money(c.worldwide)}` : ''}`).join('; ')}${st.medianMultiple ? ` — median ${st.medianMultiple.toFixed(1)}× budget` : ''}`; }).join('\n');
  const research = (pitch.research ?? []).filter(r => r.title || r.body).map(r => `[${r.kind}] ${r.title}${r.body ? `: ${r.body.slice(0, 400)}` : ''}${r.url ? ` (${r.url})` : ''}`).join('\n');
  const team = (pitch.team ?? []).filter(t => t.name).map(t => `${t.name}, ${t.role}${t.bio ? `: ${t.bio.slice(0, 300)}` : ''}`).join('\n');
  const tiers = p.tiers.map(t => `${t.name} ×${t.multiplier}`).join(', ');
  return [
    `FILM: ${p.name} (${p.version})`,
    pitch.logline && `LOGLINE: ${pitch.logline}`,
    pitch.why && `WHY THIS FILM: ${pitch.why}`,
    (pitch.audience.primary || pitch.audience.secondary) && `AUDIENCE: ${pitch.audience.primary} | ${pitch.audience.secondary} | ${pitch.audience.notes}`,
    pitch.sections.filter(s => s.heading || s.body).length && `THE CASE SO FAR:\n${pitch.sections.map(s => `## ${s.heading}\n${s.body}`).join('\n')}`,
    `SCRIPT: ${p.board.scenes.length} scenes${parked.length ? ` (${parked.length} off the first unit)` : ''}, ${days.length} shoot days planned, ${p.board.castList.length} speaking parts${cast ? ` (${cast})` : ''}, ${sets.length} sets${sets.length ? `: ${sets.slice(0, 10).join('; ')}` : ''}`,
    `MONEY: budget to raise ${money(ts.cashBudget)} (contingency ${p.contingencyPct}%); investors put in ${money(recoupableBudget(p))}; ${money(ts.pointsValue)} of wages and fees traded for points; deferred ${money(ts.deferredTotal)}; SAG tier target ${sag.target.name}, qualifies as ${sag.qualifying.name}${sag.dic ? ' with Diversity in Casting' : ''}; total production cost ${money(sag.totalProductionCost)}`,
    `DEAL: investors recoup ${p.waterfall.recoupPct}% then the pool takes ${p.waterfall.poolPct}% of net; ${p.participants.length} participants hold points by tier (${tiers}); everyone on the film shares the back end`,
    pitch.revenue.some(r => r.low || r.mid || r.high) && `PROJECTIONS (gross → net → investor return): low ${money(pr.low.gross)} → ${money(pr.low.net)} → ${pr.low.multiple.toFixed(2)}×; mid ${money(pr.mid.gross)} → ${money(pr.mid.net)} → ${pr.mid.multiple.toFixed(2)}×; high ${money(pr.high.gross)} → ${money(pr.high.net)} → ${pr.high.multiple.toFixed(2)}×`,
    comps && `COMPARABLES:\n${comps}`,
    research && `RESEARCH:\n${research}`,
    team && `TEAM:\n${team}`,
    pitch.ask && `THE ASK: ${pitch.ask}`,
  ].filter(Boolean).join('\n\n');
}

export const SYSTEM = `You help an independent filmmaker write the investor-facing parts of a film pitch. Write in plain, confident, specific prose in the filmmaker's own first person where that fits. Use the brief and any documents attached (a look book, a treatment, a deck): their logline, story, style and tone are the filmmaker's own words and come first. Never invent facts, names, numbers or quotes that are not in the brief or the documents; where both are silent, leave a bracketed note like [add: the festival strategy] rather than making something up. No em dashes. No bullet points unless asked. No headings unless asked. Keep it tight: an investor reads this in a minute.`;

export type DraftWhat = 'logline' | 'why' | 'audience' | 'section' | 'ask' | 'deck';
export interface WholePitch { logline: string; why: string; audience: [string, string, string]; sections: { heading: string; body: string }[]; ask: string }
/** Every written part at once, from the brief and the documents. */
export async function draftWholePitch(p: Project): Promise<WholePitch> {
  const text = await ask(SYSTEM, draftPrompt('deck', projectBrief(p)), { maxTokens: 4000 });
  const json = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  const start = json.indexOf('{'), end = json.lastIndexOf('}');
  const o = JSON.parse(json.slice(start, end + 1));
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const aud = Array.isArray(o.audience) ? o.audience.map(str) : [];
  return { logline: str(o.logline), why: str(o.why), audience: [aud[0] ?? '', aud[1] ?? '', aud[2] ?? ''], sections: Array.isArray(o.sections) ? o.sections.map((s: any) => ({ heading: str(s?.heading), body: str(s?.body) })).filter((s: any) => s.heading || s.body) : [], ask: str(o.ask) };
}
export function draftPrompt(what: DraftWhat, brief: string, extra = ''): string {
  const task: Record<DraftWhat, string> = {
    logline: 'Write a logline for the film in one or two sentences: protagonist, want, obstacle, what is at stake. Return only the logline.',
    why: 'Write "Why this film, why now" in 120 to 180 words, first person, from the filmmaker to an investor. Return only the paragraph(s).',
    audience: 'Describe the primary audience, the secondary audience, and how the film reaches them, each in two or three sentences. Return exactly three paragraphs in that order, separated by blank lines, no labels.',
    section: `Write a pitch section for the heading given below, 120 to 200 words, as a case an investor should believe. Return only the body text.\nHEADING: ${extra}`,
    ask: 'Write "The ask" in 60 to 100 words: what is being raised, the structure in one sentence (investors recoup with their premium, then the split), what an investor gets, and a closing line inviting the conversation. Return only the text.',
    deck: 'Draft every written part of the pitch as JSON: {"logline": string, "why": string, "audience": [primary, secondary, how we reach them], "sections": [{"heading": string, "body": string}], "ask": string}. Why this film 120 to 180 words in the first person; three to five sections, each 80 to 140 words, headed as the case an investor should believe (the story, the audience and why now, the look, the plan, the money); the ask 60 to 100 words. Return only JSON, no code fence.',
  };
  return `${task[what]}\n\nBRIEF ABOUT THE FILM:\n${brief}`;
}
