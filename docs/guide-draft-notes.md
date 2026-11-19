# Guide and glossary: notes on the draft

Cris, this is a draft for you to edit. Nothing here is legal advice, and I am not a lawyer: the glossary says how
ProfitShare uses each word, checked against the code, and the list below is what I would put in front of your
attorney before the wording ships.

**Where the words live.** Every definition is in `src/ui/glossary.ts` and every tour step is in `src/ui/tour.ts`.
Edit the text there and nothing else needs to change. Keep each entry's `id` as it is: it is part of the link to
that word (`#glossary-points`).

**What I built, in one paragraph.** A "Guide and glossary" section under About (your opening paragraphs are
untouched and still first), with a search box and a link for each word. A one-line "New here?" invitation on the
Start screen opens a small six-step panel in the corner that walks the sample film; one click dismisses the
invitation for good in that browser, and the tour can always be started again from About.

## Where ProfitShare differs from the usual trade meaning

Ask your attorney about these first. In each, the glossary says what the app does and flags the difference.

1. **Deferred pay is paid first.** The app pays all deferred pay out of first proceeds, before investors recoup
   anything. In many investor agreements deferments sit after investor recoupment, or investors refuse them
   altogether. An investor reading "deferred, from first proceeds" may object. (`src/engine/split.ts`, `afterDeferrals`)
2. **"Off the gross" is off the net.** The app's off-the-gross model gives the pool its share from the first
   dollar of *net to the film*, after fees and expenses off the top and after deferred pay. In a contract, "gross"
   or "first-dollar gross" usually means before those deductions. The label could mislead someone who knows the
   trade term.
3. **"Premium" means two things in the app.** In agreements a premium is the investor's extra on top of their
   money (the 20% in a 120% recoup). The app calls that "Investor recoup %", and uses "premiums" (About text, the
   Deal tab's "why" notes, the code) for above-scale ATL money: producer fees, the script purchase, star
   allowances. The glossary has both entries and each points at the other. You may want to pick one word.
4. **A point is not one percent.** In the trade a "point" is usually one percent of something defined (net
   profits, the producer's share). In the app, points are units (days × tier × bonus) and a person's share is
   their points out of everyone's. The glossary says "One point is not one percent".
5. **"Converted to points" / "Points value" is a dollar figure, not a number of points.** Setting a line to points
   takes its dollars off the budget to raise, but gives nobody any points; those come only from the points
   schedule. A first-time user could easily assume the two are linked.
6. **Net profits has no line of its own.** The app goes straight from net to the film, to recoupment, to a split
   ("Pool share after recoup"). Investors keep the rest of that split for good. There is no separate producer's
   share or company share, which most agreements have.
7. **Investors are one block.** Pari passu and pro rata among investors, classes of investor, preferred returns
   and interest that grows with time are not modelled. The recoup percentage is flat, however long recoupment takes.
8. **Tax credits and grants come off the raise; they are never revenue.** Agreements often count a credit the
   company actually receives as gross proceeds, unless it was pledged to a lender. The app instead reduces what
   investors put in (and so what they recoup). Both are defensible, but they give different investor numbers.
9. **Off-the-top deductions are one percentage, and only on the Pitch tab.** The Deal tab's revenue scenarios and
   the Points tab are already net. Distributor fees, sales agent commission and expense caps, delivery costs,
   guild residuals and a collection account fee are not itemised anywhere.
10. **Total production cost** in the app is budget to raise plus deferred pay with its fringes, with a switch for
    contingency. Whether SAG-AFTRA counts contingency, and how it treats deferrals at each tier, is a question for
    your signatory rep. Whether the grants and credits that reduce the raise change SAG's figure at all (I believe
    they do not, and the app does not let them) is worth confirming too.
11. **DIC** is a tick box. The app raises the cap and does not test whether the cast qualifies.

## Definitions I was least sure of

- **Scale.** I wrote "the least a SAG-AFTRA agreement lets you pay a performer". The app also uses scale ÷ 8 as an
  hourly for crew under "Everyone at scale", which is the app's own deal, not a union rule for crew.
- **Bridge loan.** I added that "the lender is repaid when the credit arrives". That is the usual arrangement, not
  something the app computes; it only takes a cost percentage off the credit.
- **Fiscal sponsor.** "A non-profit that takes donations for your film and keeps a fee." True in outline; whether
  donors can deduct, and what the sponsor controls, is your sponsor's and attorney's to say.
- **Above the line, below the line.** I put cast above the line, as the top sheet does. The points schedule
  shows cast as its own group between the two.
- **Call sheet.** "The page everyone gets the night before" is custom, not something the app enforces.
- **Pari passu.** I said the pool and investors are paid "side by side" in the off-the-gross model. That is the
  plain sense of the arithmetic; an attorney may not want the Latin term near it at all.
- **Everyone at scale** is shown as "also called: the Sing Sing deal" because the app's own labels say so. I have
  not checked how that film's agreements were actually written, and the glossary makes no claim about them.

## Terms I left out, and why

- **Net profits definitions, producer's share, company share**: the app has no such lines (see 6).
- **Preferred return, interest, hurdle rates**: not modelled (see 7).
- **Residuals**: mentioned inside "Off-the-top deductions" only; the app does not compute them.
- **Minimum payout thresholds, statement timing, amendment and remedy clauses**: paperwork, nothing to compute.
- **Sides, tags, breakdowns, shoot days, chart of accounts, wages, "One point is worth"**: left out to
  keep the list near the length you asked for. It is at 48 entries, over the 30 to 40 asked. Easy cuts if you want
  it shorter: Top sheet, Above the line and below the line, Investor multiple, and the four "not in ProfitShare" entries.
- The four words under **"In agreements, not in ProfitShare"** (collection account, reserves, audit rights,
  cross-collateralisation) are there so a reader who meets them in a term sheet knows the app is silent on them.

## Things I noticed in the app while writing this

- **Changing Pay on a producer fee does nothing.** On the top sheet, set a 1201 "Fee" line (or the script
  purchase, or a star allowance) to points and it flips back to up front, with no message, because the Deal tab's
  "Above-scale ATL money" choice always wins for those lines. This is why tour step 3 uses the composer line.
  Worth either locking the Pay menu on those lines or letting the change set the Deal choice.
- The sample's SAG pension and health fringe is 21% and the tier's is 22%; the SAG tab already says so.
- The About tab says "premiums" where the Deal tab says "Above-scale ATL money". I did not touch your About text.

## Choices I made

- **A section under About, not a thirteenth tab and not a fold.** The tab row is already full at phone width, and
  a fold would hide the words from the browser's own find-in-page and from links.
- **The tour is a corner panel, not an overlay.** Nothing is dimmed or locked. "Take me there" switches tab and
  rings the part of the page the step is about for a few seconds. "Tuck away" folds the panel to one line.
- **Step 4 leaves the sample over its cap.** Composer and producer fees to points bring it from $105,312 over to
  $20,612 over. I thought an honest "closer, still over" taught more than a rigged fix; change it if you disagree.
- The tour's claims about the sample are pinned by tests (`src/ui/tour.test.ts`), so a change to the sample that
  makes a step untrue will fail a test, not mislead a newcomer.
- The reference PDF of waterfall schedules you supplied was read for understanding only. Nothing in the repo
  quotes it, names it or copies its wording.
