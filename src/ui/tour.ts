// The two-minute tour of the sample film: its steps and the little logic around them. No React here, so the words
// can be edited in one place and the logic tested on its own.
//
// DRAFT for the owner's review: see docs/guide-draft-notes.md. src/ui/tour.test.ts checks every claim a step makes
// about the sample against the engine, so a change to the sample that makes a step untrue fails a test.

/** The tabs a step can send someone to (the app's own names for them). */
export type TourTab = 'deal' | 'topsheet' | 'points' | 'pitch';

export interface TourStep {
  id: string;
  title: string;
  /** Short imperatives, one paragraph each. */
  body: string[];
  /** Where "Take me there" goes. The first step loads the sample instead, which opens on the Deal tab. */
  tab: TourTab;
  /** What the button says, and the fuller name a screen reader hears. */
  go: string;
  goName: string;
  /** The part of the page to point at once the tab is drawn, when there is one worth pointing at: a CSS selector,
   *  optionally followed by ` >> ` and words the element must contain (`td >> 4100` is the cell that says 4100). */
  spot?: string;
  /** Glossary entries for the words this step leans on. */
  terms: string[];
}

/** The name the sample film carries, so the tour can tell whether it is the project that is open. */
export const SAMPLE_NAME = 'SALT FLAT';

export const TOUR_STEPS: TourStep[] = [
  { id: 'sample', title: 'Load the sample', tab: 'deal', go: 'Open Salt Flat', goName: 'Open Salt Flat, the invented film',
    body: [
      'Open Salt Flat, an invented 12-day feature. Every name and number in it is made up, so break whatever you like.',
      'It opens on the Deal tab. Leave that for now; we come back to it.',
    ], terms: ['deal'] },
  { id: 'topsheet', title: 'Read the top sheet', tab: 'topsheet', go: 'Take me there', goName: 'Take me there: the top sheet', spot: 'main .grid3',
    body: [
      'Look at the three boxes across the top. Budget to raise is what you need in the bank. Deferred and Converted to points both start at $0, because everyone in the sample is paid up front.',
      'Scroll to the foot of the table. Budget to raise is there again, under the contingency row that feeds it.',
    ], terms: ['budget-to-raise', 'top-sheet', 'contingency'] },
  { id: 'paytype', title: 'Move one line to points', tab: 'topsheet', go: 'Take me there', goName: 'Take me there: the budget lines', spot: 'main .panel tr >> 4100 ',
    body: [
      'Click 4100 Score & Music, then 4101, to open its lines. On Composer (package), change Pay from up front to points.',
      'Scroll back to the top and read the three boxes again. Budget to raise has fallen by the composer\'s $12,000 and the contingency that sat on it, and Converted to points has picked the $12,000 up.',
    ], terms: ['pay-type', 'points', 'converted-to-points'] },
  { id: 'deal', title: 'Check the SAG-AFTRA tier', tab: 'deal', go: 'Take me there', goName: 'Take me there: the Deal tab', spot: 'main .lede',
    body: [
      'Read the sentence at the top. It says what the film costs to raise and whether it fits its SAG-AFTRA tier. The sample is over the Moderate Low Budget cap.',
      'Scroll to Above-scale ATL money and set Producer fees to points. Read the sentence again: closer, still over. The table under that sentence prices the film at every tier.',
    ], terms: ['sag-tier', 'cap', 'total-production-cost', 'above-scale'] },
  { id: 'points', title: 'See who gets what', tab: 'points', go: 'Take me there', goName: 'Take me there: Points and waterfall', spot: 'main .panel table',
    body: [
      'Read the first table across: at each of three revenue figures, what the cast and crew pool gets and what investors get.',
      'Scroll down to the points schedule. Each person\'s row shows what they would receive at those same three figures, beside the wages the budget pays them.',
    ], terms: ['waterfall', 'pool', 'net-proceeds', 'recoupment'] },
  { id: 'pitch', title: 'Open the pitch deck', tab: 'pitch', go: 'Take me there', goName: 'Take me there: the pitch deck', spot: '#pitch-deck .pd-preview',
    body: [
      'Page through the deck with the arrows beside the slide count. The plan and money slides read the same budget, schedule and deal as the tabs you just visited.',
      'That is the tour. Press Start in the tabs to begin your own film: from a script, from scratch, or from a budget you already have.',
    ], terms: ['back-end', 'investor-multiple'] },
];

/** Keep a step number on the list, whatever it was handed. */
export const clampStep = (i: number): number => Math.max(0, Math.min(TOUR_STEPS.length - 1, Math.trunc(Number.isFinite(i) ? i : 0)));
export const nextStep = (i: number): number => clampStep(i + 1);
export const prevStep = (i: number): number => clampStep(i - 1);
export const isLastStep = (i: number): boolean => clampStep(i) === TOUR_STEPS.length - 1;

/** Whether the project that is open is the sample, going by its title (a renamed sample reads as someone's own film). */
export const isSampleOpen = (projectName: string, anythingOpen: boolean): boolean => anythingOpen && projectName.trim().toUpperCase() === SAMPLE_NAME;

// ---- the invitation on the Start screen: dismissed once, gone for good in this browser ----

export const TOUR_KEY = 'profitshare.tourCard';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const browserStore = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** True once the invitation has been dismissed, or the tour finished, in this browser. A browser that will not let
 *  the page read its storage (a private window) gets the invitation every visit, which is the safe way round. */
export function tourCardDismissed(store: Store | null = browserStore()): boolean {
  try { return store?.getItem(TOUR_KEY) === '1'; } catch { return false; }
}

/** Remember the dismissal. If the browser refuses, the card still goes away for this visit (the caller holds that). */
export function dismissTourCard(store: Store | null = browserStore()): void {
  try { store?.setItem(TOUR_KEY, '1'); } catch { /* it stays dismissed for this visit */ }
}
