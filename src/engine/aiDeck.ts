// AI assist for the pitch deck: a cover line and a note for one person, a second line for a headline, and a read of
// the whole deck for problems. Optional, the person's own key, and every answer is a proposal they apply or discard.
// Everything here is pure: what is sent, the tool each answer must come through, and the check on what comes back
// (lengths capped, ids that are not on the deck dropped, whatever looks like markup kept as the text it is). The
// calls themselves are in ai.ts. The checks that need no model at all (`deckChecks`) are here too.
import type { DeckData, DeckSlide } from '../deck-runtime/data';
import { NOT_IN_FORM, sendsText, type AiRequest, type AiTool } from './aiMotion';
import { PROMISE_TEXT, promiseOfReturns } from './promise';

export { PROMISE_TEXT, promiseOfReturns };
/** Whether a piece of text reads like a promise of returns (see promise.ts: a net, not a proof). */
export const promisesReturns = (text: unknown): boolean => promiseOfReturns(text).flagged;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const COVER_MAX = 90, NOTE_MAX = 240, ABOUT_MAX = 2000, PUNCH_MAX = 90, PROBLEM_MAX = 220, PROBLEMS_MAX = 8, SLIDE_TEXT_MAX = 1500;

/** One line of plain text, cut to `max`. Control characters go; everything else (angle brackets too) is text. */
const line = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

// ---------- what a slide says, as text ----------

/** The kinds of thing a read of the deck sends, each with the words the page uses for it. This list is the one source
 *  for both: `slideText` can only label what it reads with a kind from here, and the page's sentence about what is
 *  sent is made from the same words. A test fails if a kind is read that is not listed, or listed and never read. */
export const CRITIQUE_SENT = [
  ['headline', 'headlines'], ['paragraph', 'paragraphs'], ['card', 'cards'], ['number', 'numbers and their sources'], ['team', 'team names and bios'],
  ['comp', 'comparable film titles'], ['terms', 'the deal terms shown on the model slide'], ['contact', 'your contact line'], ['film', 'the film\'s title'],
] as const;
export type SentKind = typeof CRITIQUE_SENT[number][0];
export const CRITIQUE_NOT_SENT = ['your budget lines', 'the figures on the money slide', 'pictures', 'the people you send the deck to'] as const;
export interface SlideWords { field: string; kind: SentKind; text: string }

/** A slide's words, field by field, the way its reader sees them: no pictures, no figures from the budget. `field`
 *  is where the editor has it; `kind` is what it is called when the page says what is sent. */
export function slideText(s: DeckSlide): SlideWords[] {
  const out: SlideWords[] = [];
  const add = (field: string, kind: SentKind, text: unknown) => { const t = typeof text === 'string' ? text.trim() : ''; if (t) out.push({ field, kind, text: t }); };
  add('eyebrow', 'headline', s.eyebrow); add('headline', 'headline', s.headline); add('punch', 'headline', s.punch);
  switch (s.layout) {
    case 'cover': add('tagline', 'paragraph', s.tagline); add('byline', 'paragraph', s.byline); break;
    case 'photo': add('body', 'paragraph', s.body); break;
    case 'text': add('body', 'paragraph', s.body); for (const a of s.aside ?? []) add('body', 'paragraph', [a.label, ...a.lines].join(': ')); add('closing', 'paragraph', s.closing); break;
    case 'cards': case 'ways': for (const c of s.cards) add('cards', 'card', [c.kicker, c.title, c.body, c.footnote].filter(Boolean).join(' | ')); break;
    case 'stats':
      if (s.lead) add('numbers', 'number', `${s.lead.value} ${s.lead.text} (source: ${s.lead.source})`);
      add('body', 'paragraph', s.body);
      for (const x of s.stats) add('numbers', 'number', `${x.value} ${x.label} (source: ${x.source})`);
      if (s.quote) add('body', 'paragraph', `"${s.quote.text}" ${s.quote.by}`);
      add('closing', 'paragraph', s.note); break;
    case 'timeline': for (const m of s.milestones) add('body', 'paragraph', `${m.when}: ${m.what}`); add('closing', 'paragraph', s.note); break;
    case 'comps': for (const g of s.groups) add('body', 'comp', `${g.group}: ${g.rows.map(r => `${r.title} ${r.year}`.trim()).join('; ')}`); add('closing', 'paragraph', s.callout); break;
    case 'team': for (const m of s.members) add('body', 'team', `${m.name}, ${m.role}: ${m.bio}`); if (s.aside) add('body', 'team', [s.aside.title, ...s.aside.lines].join(': ')); break;
    case 'model': add('body', 'paragraph', s.body); for (const x of s.steps) add('body', 'terms', `${x.label}: ${x.title}. ${x.body}`); add('closing', 'paragraph', s.closing); break;
    case 'numbers': add('body', 'paragraph', s.body); add('closing', 'paragraph', s.caseNote); break;
    case 'ask': add('ask', 'paragraph', s.withGrants); if (s.withoutGrants !== s.withGrants) add('ask', 'paragraph', s.withoutGrants); add('nextStep', 'paragraph', s.nextStep); add('contact', 'contact', s.contact); break;
    case 'closing': break;
  }
  add('footnote', 'paragraph', s.footnote);
  return out;
}

// ---------- checks that need no model ----------

/** A problem on the deck, tied to a slide and (when there is one) the field to open. */
export interface DeckProblem { slideId: string; field: string; message: string }

/** What can be said about the deck's words without asking anyone: text that reads as a promise of returns, and an
 *  ask with no way to answer it. (Missing sources, lost pictures and the rest are `deckWarnings`; a slide that is too
 *  full is found by measuring it.) */
export function deckChecks(d: DeckData): DeckProblem[] {
  const out: DeckProblem[] = [];
  for (const s of Array.isArray(d?.slides) ? d.slides : []) {
    const seen = new Set<string>();
    for (const t of slideText(s)) {
      const v = promiseOfReturns(t.text);
      if (!v.flagged || seen.has(t.field)) continue;
      seen.add(t.field);
      out.push({ slideId: s.id, field: t.field, message: `${PROMISE_TEXT} ("${v.phrase}")` });
    }
    if (s.layout === 'ask') {
      if (!s.contact.trim()) out.push({ slideId: s.id, field: 'contact', message: 'The ask does not say how to reach you.' });
      if (!s.nextStep.trim()) out.push({ slideId: s.id, field: 'nextStep', message: 'The ask does not say what you want the reader to do next.' });
    }
  }
  for (const r of Array.isArray(d?.recipients) ? d.recipients : []) {
    const v = [promiseOfReturns(r.note), promiseOfReturns(r.coverLine)].find(x => x.flagged);
    if (v) out.push({ slideId: `recipient:${r.slug}`, field: 'note', message: `${r.name || 'Someone'}: ${PROMISE_TEXT} ("${v.phrase}")` });
  }
  return out;
}

// ---------- for one person ----------

export interface PersonBrief { about: string; film: string; logline: string; askWith: string; askWithout: string; hasGrants: boolean }
export interface PersonSuggestion { coverLine: string; note: string; lead: 'with-grants' | 'without-grants'; flagged: boolean }   // flagged: the note or the line reads as a promise of returns

export const PERSON_SYSTEM = `You help an independent filmmaker tailor a pitch deck for one person or fund they are sending it to. From what the filmmaker pasted about that person, suggest: a cover line (the short line above the film's title, such as "Prepared for Ada Example."), a short note to them for the ask slide, and which ask they should read first.

Rules. Plain and specific. No flattery. Use only what the pasted text says about the person: never invent a fact about them, their work, their money or their tastes, and never guess. If the pasted text gives nothing to be specific about, keep the note general and short. Never say or suggest what the investment will return: no promises, no predictions, no "will". The note is at most 240 characters and reads as the filmmaker speaking to that person. No em dashes. Answer through the suggest_for_person tool only.`;

export function personTool(hasGrants: boolean): AiTool {
  return {
    name: 'suggest_for_person', description: 'Suggest a cover line, a note and which ask to show first for this one person.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['cover_line', 'note', 'lead'],
      properties: {
        cover_line: { type: 'string', maxLength: COVER_MAX },
        note: { type: 'string', maxLength: NOTE_MAX },
        lead: { type: 'string', enum: hasGrants ? ['with-grants', 'without-grants'] : ['with-grants'], description: 'with-grants: the smaller raise, grants counted. without-grants: the whole raise.' },
      },
    },
  };
}
/** Everything a request for one person carries, part by part: how the part is written into the prompt, and the
 *  words the page uses for it. The prompt is made from this list and so is the sentence that says what is sent. */
export const PERSON_SENT: { key: string; words: (hasGrants: boolean) => string; write: (b: PersonBrief) => string }[] = [
  { key: 'about', words: () => 'what you paste here', write: b => `ABOUT THE PERSON (pasted by the filmmaker):\n${(typeof b.about === 'string' ? b.about : '').trim().slice(0, ABOUT_MAX)}` },
  { key: 'film', words: () => 'the film\'s title', write: b => `THE FILM: ${line(b.film, 200)}` },
  { key: 'logline', words: () => 'its logline', write: b => `LOGLINE: ${line(b.logline, 600) || '(none yet)'}` },
  { key: 'asks', words: g => (g ? 'the two ask sentences from your deck, with the amounts in them (what you are raising and the grants figure)' : 'the ask sentence from your deck, with the amount in it (what you are raising)'),
    write: b => (b.hasGrants ? `THE ASK, WITH GRANTS COUNTED: ${line(b.askWith, 600)}\n\nTHE ASK, WITHOUT GRANTS: ${line(b.askWithout, 600)}` : `THE ASK: ${line(b.askWith, 600)}`) },
];
export const PERSON_NOT_SENT = ['your budget lines', 'anyone else you send the deck to', 'your slides', 'pictures'];
/** What is sent for one person: exactly the parts of `PERSON_SENT`, in order. */
export function personRequest(b: PersonBrief): AiRequest {
  return { system: PERSON_SYSTEM, prompt: PERSON_SENT.map(part => part.write(b)).join('\n\n'), tool: personTool(b.hasGrants) };
}
export function readPersonReply(input: unknown, hasGrants: boolean): PersonSuggestion {
  if (!isObj(input)) throw new Error(NOT_IN_FORM);
  const o = obj(input);
  const coverLine = line(own(o, 'cover_line'), COVER_MAX), note = line(own(o, 'note'), NOTE_MAX);
  if (!coverLine && !note) throw new Error('the answer had no cover line and no note in it');
  return { coverLine, note, lead: hasGrants && own(o, 'lead') === 'without-grants' ? 'without-grants' : 'with-grants', flagged: promisesReturns(coverLine) || promisesReturns(note) };
}
export const personSends = (hasGrants: boolean): string =>
  `${sendsText(PERSON_SENT.map(part => part.words(hasGrants)), PERSON_NOT_SENT)} What you paste is not saved in the project.`;

// ---------- a second line for a headline ----------

export const PUNCH_SYSTEM = `You write the second line of a slide's headline in a film's pitch deck. The headline is line one; the second line lands the point in a few words, in the same voice. You are given the slide's own headline and text and nothing else, so use only what they say: no new facts, no numbers that are not there, nothing about what an investment will return. Each option is one short line, under 80 characters, no em dashes, not a repeat of the headline. Give three options that differ from each other, through the suggest_second_lines tool only.`;
export const PUNCH_TOOL: AiTool = {
  name: 'suggest_second_lines', description: 'Three options for the second line of this slide\'s headline.',
  input_schema: { type: 'object', additionalProperties: false, required: ['options'], properties: { options: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', maxLength: PUNCH_MAX } } } },
};
export const PUNCH_SENT: { key: string; words: string; write: (headline: string, body: string) => string }[] = [
  { key: 'headline', words: 'this slide\'s headline', write: headline => `HEADLINE: ${line(headline, 300) || '(none yet)'}` },
  { key: 'text', words: 'the slide\'s own text (its paragraphs, cards, numbers and quote)', write: (_h, body) => `THE SLIDE'S TEXT:\n${(typeof body === 'string' ? body : '').trim().slice(0, SLIDE_TEXT_MAX) || '(none)'}` },
];
export const PUNCH_NOT_SENT = ['anything else on the deck', 'pictures', 'your budget'];
export function punchRequest(headline: string, body: string): AiRequest {
  return { system: PUNCH_SYSTEM, prompt: PUNCH_SENT.map(part => part.write(headline, body)).join('\n\n'), tool: PUNCH_TOOL };
}
/** Up to three options, each one line, none empty, none twice, none the headline again. An option that reads like a
 *  promise of returns is kept, so the page can show it flagged: the person sees what was suggested and why not to use it. */
export function readPunchReply(input: unknown, headline = ''): string[] {
  if (!isObj(input)) throw new Error(NOT_IN_FORM);
  const list = own(obj(input), 'options');
  const out: string[] = []; const said = new Set([line(headline, 300).toLowerCase()]);
  for (const x of Array.isArray(list) ? list : []) {
    const t = line(x, PUNCH_MAX);
    if (!t || said.has(t.toLowerCase())) continue;
    said.add(t.toLowerCase());
    out.push(t);
    if (out.length >= 3) break;
  }
  if (!out.length) throw new Error('the answer had no usable line in it');
  return out;
}
export const PUNCH_SENDS = sendsText(PUNCH_SENT.map(part => part.words), PUNCH_NOT_SENT);

// ---------- a read of the whole deck ----------

export const PROBLEM_KINDS = ['unsourced', 'vague', 'empty-headline', 'too-full', 'unclear-ask', 'promise', 'other'] as const;
export type ProblemKind = typeof PROBLEM_KINDS[number];
export const PROBLEM_FIELDS = ['headline', 'body', 'cards', 'numbers', 'ask', 'other'] as const;
export interface AiProblem extends DeckProblem { kind: ProblemKind }

export const CRITIQUE_SYSTEM = `You read an independent film's pitch deck the way a careful investor's adviser would, and report at most eight concrete problems, the most serious first. Each problem is tied to one slide by its id and says, in one or two plain sentences, what is wrong and what to do about it.

What to look for: a claim with no source, or a vague one ("huge audience", "proven demand"); a headline that says nothing; a slide with too much on it to take in; an ask that does not say what is being asked or what happens next; and anything that reads as a promise or a prediction of returns. Always report that last kind: the deck must never promise returns. The tokens {investors} and {grants} in the ask are filled in with live amounts; they are not a problem.

Do not rewrite the deck, do not praise it, and do not report what is fine. Do not report missing pictures or design. If you find nothing wrong, return an empty list. Answer through the report_problems tool only.`;

export function critiqueTool(slideIds: string[]): AiTool {
  return {
    name: 'report_problems', description: 'Report at most eight concrete problems, each tied to a slide.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['problems'],
      properties: {
        problems: {
          type: 'array', maxItems: PROBLEMS_MAX,
          items: {
            type: 'object', additionalProperties: false, required: ['slide_id', 'kind', 'problem'],
            properties: {
              slide_id: { type: 'string', enum: slideIds },
              field: { type: 'string', enum: [...PROBLEM_FIELDS], description: 'The part of the slide the problem is in.' },
              kind: { type: 'string', enum: [...PROBLEM_KINDS] },
              problem: { type: 'string', maxLength: PROBLEM_MAX },
            },
          },
        },
      },
    },
  };
}
/** What is sent for a read of the deck: everything written on its slides (each line labelled with its kind from
 *  `CRITIQUE_SENT`), slide by slide, with each slide's id and layout, and the film's title. No pictures, no
 *  recipients, no figures from the budget. */
export function critiqueRequest(d: DeckData): AiRequest {
  const slides = Array.isArray(d?.slides) ? d.slides : [];
  const body = slides.map((s, i) => {
    const text = slideText(s).map(t => `${t.kind} (${t.field}): ${t.text}`).join('\n').slice(0, SLIDE_TEXT_MAX);
    return `### slide ${i + 1} | id=${s.id} | layout=${s.layout}\n${text || '(no words of its own)'}`;
  }).join('\n\n');
  return { system: CRITIQUE_SYSTEM, prompt: `THE FILM: ${line(d?.film, 200)}\n\nTHE DECK, SLIDE BY SLIDE:\n\n${body}`, tool: critiqueTool(slides.map(s => s.id)) };
}
/** The problems that came back, checked: a slide id that is not on the deck is dropped, a kind or a field that is
 *  not on the list becomes "other", each message is one capped line of plain text, and there are eight at most. */
export function readCritiqueReply(input: unknown, slideIds: string[]): AiProblem[] {
  const list = isObj(input) ? own(input, 'problems') : undefined;
  if (!Array.isArray(list)) throw new Error(NOT_IN_FORM);   // only a list (an empty one too) is an answer; anything else is not "nothing to report"
  const out: AiProblem[] = []; const said = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    const r = obj(raw);
    const slideId = own(r, 'slide_id');
    const message = line(own(r, 'problem'), PROBLEM_MAX);
    if (typeof slideId !== 'string' || !slideIds.includes(slideId) || !message || said.has(`${slideId}|${message}`)) continue;
    said.add(`${slideId}|${message}`);
    const kind = own(r, 'kind'), field = own(r, 'field');
    out.push({ slideId, field: (PROBLEM_FIELDS as readonly unknown[]).includes(field) ? (field as string) : 'other', kind: (PROBLEM_KINDS as readonly unknown[]).includes(kind) ? (kind as ProblemKind) : 'other', message });
    if (out.length >= PROBLEMS_MAX) break;
  }
  return out;
}
export const CRITIQUE_SENDS = `Everything written on your slides is sent: ${CRITIQUE_SENT.slice(0, -1).map(k => k[1]).join(', ')}, and ${CRITIQUE_SENT[CRITIQUE_SENT.length - 1][1]}. Not sent: ${CRITIQUE_NOT_SENT.slice(0, -1).join(', ')}, or ${CRITIQUE_NOT_SENT[CRITIQUE_NOT_SENT.length - 1]}.`;
export const KIND_WORDS: Record<ProblemKind, string> = { unsourced: 'No source', vague: 'Vague', 'empty-headline': 'Headline says nothing', 'too-full': 'Too full', 'unclear-ask': 'Unclear ask', promise: 'Reads as a promise of returns', other: 'To check' };
