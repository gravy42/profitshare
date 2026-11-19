// Movement on request: the person says how they want a slide to move, in their own words, and the model answers with
// settings from the fixed vocabulary (deck-runtime/motion.ts) and nothing else. Everything here is pure: what is
// sent, the tool the model must answer through (its schema IS the vocabulary), the check on what comes back, and the
// settings in words for the person to read before they apply them. The call itself is in ai.ts.
//
// What goes out: the request as typed, the name of the slide's layout, the vocabulary and, for a plan slide only
// (the one layout a picture can travel on), the ids and captions of the look book pictures. Not the pictures, not a
// word of the slide, nothing of the budget.
import type { SlideLayout, SlideMotion } from './types';
import { cleanMotion, ENTRANCES, MARKER_ENDS, MARKER_SIZE_MAX, MARKER_SIZE_MIN, markerPathOf, ORDERS, STAGGER_MAX } from '../deck-runtime/motion';

export interface MotionPicture { id: string; caption: string }
export interface AiTool { name: string; description: string; input_schema: Record<string, unknown> }
export interface AiRequest { system: string; prompt: string; tool: AiTool }

export const REQUEST_MAX = 400, NOTE_MAX = 200, PICTURES_MAX = 40, CAPTION_MAX = 80;

const LAYOUT_WORDS: Record<SlideLayout, string> = {
  cover: 'cover (the title on a card)', photo: 'picture and a line', look: 'look book (a page of pictures)', text: 'words (a headline and paragraphs)', cards: 'cards (two to four cards in a row)',
  stats: 'proof (one big number, smaller numbers, a quote)', timeline: 'plan (facts in big numbers above a timeline of milestones)', comps: 'comparable films (bars and a table)',
  team: 'team (a list of people)', model: 'how the money flows (three steps)', ways: 'ways to take part (cards in a row)', numbers: 'the money (figures and tables)',
  ask: 'the ask', closing: 'closing (the title once more)',
};

const MOTION_SYSTEM = `You set how one slide of a film's pitch deck moves when it comes into view. You can only use the settings of the set_movement tool; there is nothing else the deck can do. Your answer is the slide's whole movement: a setting you leave out is off, so include only what the request asks for.

The settings: how the parts of the slide arrive (entrance), whether they arrive together, one by one or last first (order), the gap between one part and the next in milliseconds (stagger), whether the headline is typed out (headline), whether the slide's big numbers count up (count), and, only where the tool offers it, a picture from the person's look book that travels left to right along the plan's timeline once and stops at the last milestone (marker). A picture is chosen by its id from the list you are given; choose the one whose caption fits the request, and none if nothing fits.

When the request asks for something the settings cannot do, choose the closest setting and say so in note, in one short plain sentence ("I can't make it bounce; the closest is drop."). When the request can be met, leave note out. Never put anything but the settings and that one sentence in your answer.`;

const cut = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

/** The look book pictures a request can name: an id and a caption each, nothing of the picture itself. */
export function motionPictures(lookbook: unknown): MotionPicture[] {
  const out: MotionPicture[] = []; const seen = new Set<string>();
  for (const i of Array.isArray(lookbook) ? lookbook : []) {
    if (!i || typeof i !== 'object' || typeof (i as { id?: unknown }).id !== 'string') continue;
    const id = (i as { id: string }).id;
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, caption: cut((i as { caption?: unknown }).caption, CAPTION_MAX) });
    if (out.length >= PICTURES_MAX) break;
  }
  return out;
}

/** The tool for one slide: its schema is the vocabulary. A travelling picture is offered only on a plan slide (it
 *  travels along the timeline) when the look book has pictures, and only by the ids of those pictures. */
export function motionTool(layout: SlideLayout, pictures: MotionPicture[]): AiTool {
  const properties: Record<string, unknown> = {
    entrance: { type: 'string', enum: [...ENTRANCES], description: 'How the parts of the slide arrive. slide-left: in from the right; slide-right: in from the left; none: simply there.' },
    order: { type: 'string', enum: [...ORDERS], description: 'together: all at once; one-by-one: first to last; reverse: last to first.' },
    stagger: { type: 'integer', minimum: 0, maximum: STAGGER_MAX, description: 'Milliseconds between one part and the next.' },
    headline: { type: 'string', enum: ['none', 'type'], description: 'type: the headline is typed out letter by letter.' },
    count: { type: 'boolean', description: 'true: the big numbers on the slide count up to their figures.' },
    note: { type: 'string', maxLength: NOTE_MAX, description: 'One short sentence, only when the request cannot be met with these settings.' },
  };
  if (markerPathOf(layout) && pictures.length) {
    properties.marker = {
      type: 'object', additionalProperties: false, required: ['imageId'],
      description: 'A look book picture that travels once, left to right, along the timeline and stops at the last milestone.',
      properties: {
        imageId: { type: 'string', enum: pictures.map(p => p.id) },
        end: { type: 'string', enum: [...MARKER_ENDS], description: 'stop: it halts; settle: it rocks once and comes to rest.' },
        size: { type: 'number', minimum: MARKER_SIZE_MIN, maximum: MARKER_SIZE_MAX, description: 'Its height, as a multiple of the usual.' },
      },
    };
  }
  return { name: 'set_movement', description: 'Set how this slide moves. Only these settings exist.', input_schema: { type: 'object', additionalProperties: false, properties } };
}

/** What the model must answer with when its answer cannot be read: every reader throws this, and the page says it in plain words. */
export const NOT_IN_FORM = 'the model did not answer in the form it was asked for';

/** The sentence a page shows before anything is sent, made from the same lists the request is made from. */
export const sendsText = (sent: string[], notSent: readonly string[]): string =>
  `Sent to Anthropic with your key: ${sent.length > 1 ? `${sent.slice(0, -1).join(', ')}, and ${sent[sent.length - 1]}` : sent[0]}. Not sent: ${notSent.length > 1 ? `${notSent.slice(0, -1).join(', ')}, or ${notSent[notSent.length - 1]}` : notSent[0]}.`;

/** Everything a movement request carries, part by part: how each is written into the prompt, and the words the page
 *  uses for it. The vocabulary travels as the tool's schema. */
export const MOTION_SENT: { key: string; words: string; only?: 'timeline'; write?: (text: string, layout: SlideLayout, offered: MotionPicture[]) => string }[] = [
  { key: 'request', words: 'what you type here', write: text => `REQUEST: ${cut(text, REQUEST_MAX)}` },
  { key: 'layout', words: 'the name of this slide\'s layout', write: (_t, layout) => `SLIDE LAYOUT: ${LAYOUT_WORDS[layout] ?? layout}` },
  { key: 'pictures', words: 'the captions and ids of your look book pictures', only: 'timeline', write: (_t, _l, offered) => (offered.length ? `LOOK BOOK PICTURES (id: caption):\n${offered.map(p => `${p.id}: ${p.caption || '(no caption)'}`).join('\n')}` : 'LOOK BOOK PICTURES: none this slide can use.') },
  { key: 'vocabulary', words: 'the list of movement settings the deck allows' },
];
const MOTION_NOT_SENT = ['the pictures themselves', 'the words on your slides', 'your budget'];
/** The parts a request for this layout carries: the look book's captions and ids go only with a plan slide. */
export const motionSent = (layout: SlideLayout) => MOTION_SENT.filter(p => !p.only || markerPathOf(layout) === p.only);
/** Everything that is sent for one request, and nothing else: the parts of `MOTION_SENT` its layout carries. */
export function motionRequest(text: string, layout: SlideLayout, pictures: MotionPicture[]): AiRequest {
  const offered = markerPathOf(layout) ? pictures : [];
  return { system: MOTION_SYSTEM, prompt: motionSent(layout).filter(p => p.write).map(p => p.write!(text, layout, offered)).join('\n\n'), tool: motionTool(layout, offered) };
}

export interface MotionProposal { motion: SlideMotion | undefined; note: string }

/** What came back, checked: through `cleanMotion` (the same door a project file goes through), so anything outside
 *  the vocabulary is gone; a travelling picture stays only when its id is one of the pictures that were offered.
 *  The note is one line of plain text. An answer that is not an object at all is not an answer: it throws, as every
 *  reader does. An object with nothing usable in it comes back as no movement (the page then says the request could
 *  not be met, and offers nothing to apply). */
export function readMotionReply(input: unknown, layout: SlideLayout, pictures: MotionPicture[]): MotionProposal {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(NOT_IN_FORM);
  let motion = cleanMotion(input, layout);
  if (motion?.marker && !pictures.some(p => p.id === motion!.marker!.imageId)) {
    const { marker: _gone, ...rest } = motion;
    motion = Object.keys(rest).length ? rest : undefined;
  }
  const raw = Object.prototype.hasOwnProperty.call(input, 'note') ? (input as { note?: unknown }).note : '';
  return { motion, note: cut(raw, NOTE_MAX) };
}

const ENTRANCE_WORDS: Record<NonNullable<SlideMotion['entrance']>, string> = { rise: 'rise in', fade: 'fade in', drop: 'drop in', 'slide-left': 'slide in from the right', 'slide-right': 'slide in from the left', none: 'are simply there' };
const ORDER_WORDS: Record<NonNullable<SlideMotion['order']>, string> = { together: 'all together', 'one-by-one': 'one at a time', reverse: 'one at a time, last first' };
/** What moves on a slide, as its first word: "Cards" where the slide is cards, "Milestones" on a plan. */
const movingParts = (layout: SlideLayout): string => (layout === 'cards' || layout === 'ways' ? 'Cards' : layout === 'timeline' ? 'Facts and milestones' : layout === 'stats' ? 'Numbers' : layout === 'team' ? 'People' : layout === 'look' ? 'Pictures' : 'Parts of the slide');

/** A slide's movement in words, one sentence a setting: "Cards: drop in, one at a time, 120 ms apart." Empty when
 *  the slide has no movement of its own. */
export function motionWords(motion: SlideMotion | undefined, layout: SlideLayout, pictures: MotionPicture[] = []): string[] {
  const m = cleanMotion(motion, layout);
  if (!m) return [];
  const out: string[] = [];
  const arrive = [m.entrance ? ENTRANCE_WORDS[m.entrance] : '', m.order && m.entrance !== 'none' ? ORDER_WORDS[m.order] : '', m.stagger != null && m.order !== 'together' && m.entrance !== 'none' ? `${m.stagger} ms apart` : ''].filter(Boolean);
  if (arrive.length) out.push(`${movingParts(layout)}: ${arrive.join(', ')}.`);
  if (m.headline === 'type') out.push('The headline is typed out.');
  if (m.count) out.push('The numbers count up.');
  if (m.marker) {
    const caption = pictures.find(p => p.id === m.marker!.imageId)?.caption;
    const size = m.marker.size != null ? `, at ${m.marker.size} times the usual size` : '';
    out.push(`${caption ? `The picture "${caption}"` : 'A look book picture'} travels along the timeline and ${m.marker.end === 'settle' ? 'settles' : 'stops'} at the last milestone${size}.`);
  }
  return out;
}

/** What is said before anything is sent, word for word: for a plan slide (`MOTION_SENDS`), and for any layout. */
export const motionSends = (layout: SlideLayout): string => sendsText(motionSent(layout).map(p => p.words), MOTION_NOT_SENT);
export const MOTION_SENDS = motionSends('timeline');
export const NO_MOVEMENT = 'The request could not be met with the movements available.';
export const TIMEOUT_MS = 60_000;

/** A failure in words a person can act on. `status` is the HTTP status when there was one. */
export function aiProblem(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  const name = (err as { name?: unknown } | null)?.name;
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (name === 'TimeoutError' || /timed out/i.test(msg)) return 'No answer came back in 60 seconds, so the request was stopped. Nothing was changed. Try again in a moment.';
  if (name === 'AbortError') return 'Stopped. Nothing was changed.';
  if (status === 401 || status === 403 || /invalid x-api-key|authentication/i.test(msg)) return 'Anthropic did not accept the key. Check it under AI assist, at the top of this page.';
  if (status === 429) return 'Anthropic says this key has sent too many requests for now. Wait a minute and try again.';
  if (typeof status === 'number' && status >= 500) return 'Anthropic is having trouble answering right now. Nothing was changed. Try again in a moment.';
  if (/no api key/i.test(msg)) return 'There is no key yet. Paste one under AI assist, at the top of this page.';
  if (msg === NOT_IN_FORM || name === 'SyntaxError' || /not valid json|unexpected token|unexpected end/i.test(msg)) return 'The answer did not come back in a form this page can read. Nothing was changed. Try again.';
  if (/failed to fetch|networkerror|load failed|network/i.test(msg) || err instanceof TypeError) return 'The request could not reach Anthropic. Check your connection and try again. Nothing was changed.';
  const said = msg.trim().slice(0, 160).replace(/[.!?\s]+$/, '');
  return `The request did not come back${said ? `: ${said}` : ''}. Nothing was changed.`;
}
