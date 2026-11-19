// A quiet line under anything that shows SAG-AFTRA rates, once the rates in the app have passed the day they were
// due to rise. Before that day it draws nothing. The dates live in engine/sag.ts.
import { sagRatesNotice } from '../engine/sag';

/** `today` is only handed in by tests; the app leaves it to the clock. */
export function SagRatesNotice({ today }: { today?: Date }) {
  const text = sagRatesNotice(today);
  return text ? <p className="help small ratesdue" role="note">{text}</p> : null;
}
