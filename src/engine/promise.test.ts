import { describe, expect, it } from 'vitest';
import { PROMISE_TEXT, promiseOfReturns } from './promise';
import { sampleDemo } from '../data/seed';
import { applyDeal } from './deal';
import { ASK_NO_GRANTS, ASK_WITHOUT_GRANTS, ASK_WITH_GRANTS, DECK_LEGAL, deckData } from './deckData';
import { slideText } from './aiDeck';
import { DEFAULT_LEGAL } from '../deck-runtime/runtime';

const MUST_FLAG = [
  'Your money comes back twice over, no question.',
  'You are certain to see a profit.',
  'There is no way to lose on this one.',
  'Investors always get paid back in full.',
  'Expect a 3x return within two years.',
  "You'll see your investment back plus 20% by 2032.",
  'A sure-fire winner for your portfolio.',
  'We promise you a profit.',
  'Your capital is safe with us.',
  'Double your money, no downside.',
  'Returns of 150% are locked in.',
  'It cannot fail to recoup.',
  'You get your money back no matter what.',
  'Guaranty of repayment.',
  'Zero risk to your principal.',
  'Profit is inevitable.',
  'You stand to triple your stake, for certain.',
  'Every investor has made money with us and you will too.',
  // and the ones the first version already caught
  'A guaranteed 3x.',
  'Investors will double their money.',
  'This is risk-free.',
  "You can't lose.",
  "You'll make it back in a year.",
  'Returns are certain.',
  'A sure thing.',
  'You will double your money in two years.',
  'A guaranteed return for you.',
];
const MUST_NOT_FLAG = [
  'No guarantee of returns.',
  'Nothing here is guaranteed.',
  'We will make the film in twelve days.',
  'We will make a festival deadline.',
  'She will return to the desert.',
  'In the mid case the model shows 2.1x.',
  'Investors recoup 120% first, then share half.',
  'The figures are illustrative, not a promise of returns.',
  'We will shoot in March.',
  'Nobody is making this film.',
  'We cannot promise a profit, and we do not.',
  'There is no certainty of any return.',
  'Investors can lose all of the money they put in.',
  'In the low case investors do not get their money back.',
  'You take 60 cents of every dollar the film earns until you have 120% of your investment back, then half of everything after.',
  'It is never repaid, and every dollar of it lowers what investors put in.',
  'Investors are paid from the first dollar the film earns.',
  'The same terms for every investor.',
  'Two short films, both shot in the desert in under a week.',
  DECK_LEGAL,
  DEFAULT_LEGAL,
  ASK_WITH_GRANTS,
  ASK_WITHOUT_GRANTS,
  ASK_NO_GRANTS,
];

describe('promiseOfReturns', () => {
  for (const t of MUST_FLAG)
    it(`flags: ${t}`, () => {
      const v = promiseOfReturns(t);
      expect(v.flagged).toBe(true);
      expect(t).toContain(v.phrase!);
      expect(v.phrase!.length).toBeGreaterThan(3);
    });
  for (const t of MUST_NOT_FLAG)
    it(`leaves alone: ${t.slice(0, 70)}`, () => {
      expect(promiseOfReturns(t)).toEqual({ flagged: false });
    });
  it('reads sentence by sentence: a caution beside a promise does not excuse it, and a decimal point does not end a sentence', () => {
    expect(promiseOfReturns('Nothing here is guaranteed. But you will double your money.').flagged).toBe(true);
    expect(promiseOfReturns('The mid case shows 1.5x. Nothing here is guaranteed.').flagged).toBe(false);
    expect(promiseOfReturns('Expect a 2.5x return.').phrase).toBe('Expect a 2.5x');
  });
  it('anything that is not text is not a promise', () => {
    for (const t of ['', '   ', null, undefined, 7, {}, []]) expect(promiseOfReturns(t)).toEqual({ flagged: false });
  });
  it('says it is a net, in words a person can act on', () => {
    expect(PROMISE_TEXT).toBe(
      'This reads like a promise of returns. A deck must not promise returns: change the wording.',
    );
  });
  it("does not flag one word of the sample deck, or of either person's note", () => {
    const d = deckData(applyDeal(sampleDemo()), { today: '2030-09-01' });
    for (const s of d.slides)
      for (const t of slideText(s))
        expect(promiseOfReturns(t.text), `${s.id} ${t.field}: ${t.text}`).toEqual({ flagged: false });
    for (const r of d.recipients) {
      expect(promiseOfReturns(r.note).flagged).toBe(false);
      expect(promiseOfReturns(r.coverLine).flagged).toBe(false);
    }
    expect(promiseOfReturns(d.legal).flagged).toBe(false);
  });
});
