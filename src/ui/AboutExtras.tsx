// Two blocks for the About tab that are not the owner's own paragraphs: the short form of the README's "What it is
// and what it is not", and where to send a problem or read the code. Both are plain words and plain links; nothing
// here asks the network for anything.
export const ISSUES_URL = 'https://github.com/gravy42/profitshare/issues/new/choose';
export const CODE_URL = 'https://github.com/gravy42/profitshare';

/** The README's list, shortened. If the README's section changes, change this to match. */
export function WhatItIs() {
  return (
    <div className="whatitis">
      <p><b>What it is and what it is not.</b></p>
      <ul>
        <li><b>US dollars, California rules.</b> Payroll fringes default to a California set, and the state incentive it models is the California film tax credit.</li>
        <li><b>SAG-AFTRA low-budget theatrical tiers.</b> Ultra Low Budget, Moderate Low Budget, Low Budget and Theatrical Basic.</li>
        <li><b>Built for a laptop.</b> It works on a phone, where the widest tables scroll sideways inside their own box, but budgeting is easier with room.</li>
        <li><b>Not legal, tax or financial advice.</b> It does not replace a payroll company, a SAG-AFTRA signatory rep or an attorney. Check the numbers with them before anyone signs.</li>
        <li><b>About the decks.</b> The money slide of a deck carries a line saying the figures are illustrative and not a promise of returns. Sending a deck to potential investors can fall under securities rules, so talk to an attorney before you send one.</li>
      </ul>
    </div>
  );
}

/** Where to say something is wrong, and where the code is. Both open in a new tab. */
export function Feedback() {
  return (
    <p><b>Problems and ideas.</b> <a href={ISSUES_URL} target="_blank" rel="noreferrer">Report a problem or suggest something</a> · <a href={CODE_URL} target="_blank" rel="noreferrer">Read the code</a>. Reports are public, so show the problem with the sample film, not a real budget.</p>
  );
}
