// Does a piece of text read like a promise of returns? A pitch deck may say what the model shows in each case; it must
// never promise, predict or assure a return. This is a net, not a proof: it catches the common ways such a promise
// is worded and will miss an inventive one, and now and then it will stop a sentence that is innocent. It is there
// to make the author look twice, never to stand in for a lawyer reading the deck. Pure: text in, a verdict out.

interface PromiseVerdict {
  flagged: boolean;
  phrase?: string;
} // phrase: the words that tripped it, for the page to show

// what the promise is about
const MONEY = String.raw`(?:money|capital|principal|investment|investments|invested|stake|profit|profits|profitable|return|returns|recoup\w*|repay\w*|repaid|payback|paid back|pay back|pays back|winner|downside|upside)`;
// words that make it certain
const CERTAIN = String.raw`(?:guarantee\w*|guaranty|certain|certainly|certainty|for certain|for sure|sure|assured|assure[sd]?|promise[sd]?|inevitable|inevitably|locked in|safe|secure|no question|without question|no doubt|no matter what|no downside|bound to)`;
// said on their own, these are a promise whatever follows
const ALONE: RegExp[] = [
  /\bguarantee\w*|\bguaranty\b/i,
  /\bsure[- ]?fire\b/i,
  /\bsure thing\b/i,
  /\brisk[- ]?free\b/i,
  /\b(?:no|zero|without) risk\b/i,
  /\bno way to lose\b/i,
  /\b(?:can(?:no|')?t|can ?not|won'?t|will not|will never) (?:lose|fail|miss)\b/i,
  /\bno downside\b/i,
  /\b(?:double|triple|quadruple|multiply)s? (?:your|their|the|an investor's|investors') (?:money|stake|investment|capital)\b/i,
  /\balways (?:get|gets|got|are|is|been)? ?(?:paid back|repaid|made whole)\b/i,
  /\b(?:every(?:one| investor| backer)|all (?:of )?(?:our|the) (?:investors|backers))\b[^.!?]*\b(?:made|makes|make|earned|got) (?:money|a profit|their money back)\b/i,
  /\b(?:money|investment|capital|stake)(?: comes| come| is| are)? back (?:twice|three times|\w+ times) over\b/i,
];
// "expect 3x", "you'll see your investment back plus 20%", "you get your money back"
const FORECAST = new RegExp(
  String.raw`\b(?:expect|expects|expected|you'll|you will|you would|you stand to|you get|you'll get|investors will|investors get|investors stand to|will get|will see|will receive|will earn|will make you|is going to|are going to)\b[^.!?]*?(?:\d+(?:\.\d+)?\s?x\b|\d+(?:\.\d+)?\s?%|\b(?:money|investment|capital|stake|it)(?: all)? back\b|\bpaid back\b|\ba profit\b|\bdouble\b|\btriple\b)`,
  'i',
);
const CERTAIN_MONEY = new RegExp(String.raw`\b${CERTAIN}\b[^.!?]*\b${MONEY}\b|\b${MONEY}\b[^.!?]*\b${CERTAIN}\b`, 'i');
// a sentence that says there is NO promise is not one: "no guarantee of returns", "nothing here is guaranteed", "not a promise"
const DENIED =
  /\b(?:no|not a|not any|never a|without(?: a| any)?|isn't a|is not a|aren't|are not|cannot|can't|can ?not|do not|don't|does not|doesn't|never|nor)\s+(?:\w+\s+){0,2}?(?:guarantee\w*|guaranty|promise[sd]?|assur\w+|certain\w*)\b|\bnothing\b[^.!?]*\b(?:guaranteed|promised|certain|assured)\b|\b(?:can|could|may|might) lose\b/i;

/** Whether `text` reads like a promise of returns, and the words that say so. Read sentence by sentence, so a deck's
 *  own caution ("not a promise of returns") never trips it, and plain plans ("we will make the film in twelve days")
 *  never do: it takes a certainty word beside a money word, a forecast with a figure or "money back", or one of a few
 *  phrases that are a promise on their own. */
export function promiseOfReturns(text: unknown): PromiseVerdict {
  if (typeof text !== 'string' || !text.trim()) return { flagged: false };
  for (const sentence of text.replace(/(\d)\.(\d)/g, '$1·$2').split(/(?<=[.!?;])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s || DENIED.test(s)) continue;
    for (const r of [...ALONE, FORECAST, CERTAIN_MONEY]) {
      const m = r.exec(s);
      if (m) return { flagged: true, phrase: m[0].replace(/·/g, '.').trim().slice(0, 80) };
    }
  }
  return { flagged: false };
}

/** What the page says beside text that trips it. */
export const PROMISE_TEXT =
  'This reads like a promise of returns. A deck must not promise returns: change the wording.';
