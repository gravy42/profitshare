// The pitch deck as data. `deckData()` in the engine builds one of these from a project; the runtime in this
// folder draws it. This file is the whole contract between the two: plain JSON, no functions, nothing computed
// that the reader can change. The numbers slide carries the inputs (`PathInputs`) and the runtime runs the same
// `pathFor` the engine runs, so a deck can never disagree with the budget it came from.
//
// Types only. Nothing here may import the engine, React or the DOM.
import type { PathInputs } from '../engine/pathMath';

export const DECK_DATA_VERSION = 1;

export interface DeckTheme {
  name: string;
  colors: { bg: string; ink: string; accent: string; accent2: string; muted: string; card: string; cardInk: string; line: string };
  fonts: { title: string; body: string };   // CSS font-family stacks
  signoff: string;                          // the footer of the last slide; empty for the film's own name
  /** Font files the deck carries, at most four. `src` is a base64 data URL of the file; `role` says which of the two
   *  stacks above the face goes in front of. Optional: a deck without it uses the stacks alone. */
  fontFaces?: DeckFontFace[];
}
export interface DeckFontFace { family: string; src: string; role: 'title' | 'body' }

/** A picture a slide can use. `src` is a data URL in an exported deck; in the app's preview it may be a blob: URL. */
export interface DeckImage { id: string; src: string; alt: string }

export interface DeckCard { id: string; kicker?: string; title: string; body: string; footnote?: string }
export interface DeckStat { id: string; value: string; label: string; source: string }
export interface DeckMilestone { id: string; when: string; what: string }
export interface DeckQuote { text: string; by: string }

/** Movement for the whole deck. Words from a fixed list only: see motion.ts. Left out, the deck is calm and its parts rise. */
export interface DeckMotion { pace: 'calm' | 'brisk'; entrance: 'rise' | 'fade' | 'none' }
/** A picture (a DeckImage, by id) that travels once along the cards' line or the timeline and stops at the last card or milestone. */
export interface SlideMarker { imageId: string; path: 'line' | 'timeline'; end: 'stop' | 'settle'; size?: number }   // size: 0.5 to 2 times the usual height
/** One slide's movement; every part optional. `stagger` is milliseconds between one part and the next (0 to 400). */
export interface SlideMotion {
  entrance?: 'rise' | 'fade' | 'drop' | 'slide-left' | 'slide-right' | 'none';
  order?: 'together' | 'one-by-one' | 'reverse';
  stagger?: number;
  headline?: 'none' | 'type';     // type: the headline is typed out
  count?: boolean;                // the slide's big numbers count up to what they say
  marker?: SlideMarker;
}

/** What every slide has. `headline` is line one; `punch` is line two, drawn in the accent colour. */
interface SlideBase {
  id: string;
  eyebrow?: string;
  headline?: string;
  punch?: string;
  imageId?: string;      // a DeckImage behind (or beside) the slide
  scrim?: number;        // 0 to 1: how dark the picture is behind the text (default 0.7)
  footnote?: string;     // small print at the foot of the slide
  motion?: SlideMotion;  // how the slide moves when it comes into view; left out, the deck's own
}

export type DeckSlide = SlideBase & (
  | { layout: 'cover'; title: string; tagline: string; byline: string }            // the cover line itself comes from the recipient
  | { layout: 'photo'; body: string }                                              // a picture, a headline, a short paragraph
  | { layout: 'text'; body: string; aside?: { label: string; lines: string[] }[]; closing?: string }   // paragraphs; `aside` is small labelled columns under them
  | { layout: 'cards'; cards: DeckCard[] }                                         // three or four cards pinned on a line
  | { layout: 'stats'; lead?: { value: string; text: string; source: string }; body?: string; stats: DeckStat[]; quote?: DeckQuote; note?: string }
  | { layout: 'timeline'; facts: { value: string; label: string }[]; milestones: DeckMilestone[]; note?: string }
  | { layout: 'comps'; bars: { label: string; value: number; note?: string }[]; barsLabel: string; groups: { group: string; rows: { title: string; year: string; multiple: number | null }[] }[]; callout?: string }
  | { layout: 'team'; members: { name: string; role: string; bio: string }[]; aside?: { title: string; lines: string[]; footnote?: string } }
  | { layout: 'model'; body: string; steps: { label: string; title: string; body: string }[]; closing?: string }
  | { layout: 'ways'; cards: DeckCard[] }                                          // ways to take part; a recipient can highlight one
  | { layout: 'numbers'; body: string; caseNote: string }                          // the live slide: drawn from DeckData.paths
  | { layout: 'ask'; withGrants: string; withoutGrants: string; nextStep: string; contact: string }   // bodies may hold {investors} and {grants}; the runtime fills them
  | { layout: 'closing'; title: string }
);

/** Someone the deck is tailored for; `slug` is the link ending (deck.html#slug). */
export interface DeckRecipient { slug: string; name: string; coverLine: string; note?: string; lead: 'with-grants' | 'without-grants'; highlightCardId?: string }

export interface DeckData {
  version: typeof DECK_DATA_VERSION;
  film: string;                 // the title, for footers
  coverLine: string;            // the cover line when no recipient is named: "Investor deck. November 2026."
  theme: DeckTheme;
  images: DeckImage[];
  slides: DeckSlide[];
  recipients: DeckRecipient[];
  paths: PathInputs;            // everything the numbers and ask slides compute from
  currency: string;             // ISO code, for formatting
  motion?: DeckMotion;          // optional; nothing in it is ever read as code or as a style
  legal: string;                // the "illustrative, not an offer" line; shown on the numbers slide and never empty
}
