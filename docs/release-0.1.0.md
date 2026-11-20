# ProfitShare 0.1.0

*Draft release notes for the first tagged release. Nothing has been tagged yet.*

ProfitShare is free, open-source budgeting, scheduling and profit-share modelling for independent films. Every budget line is paid up front, deferred or in points, and the deal sits as a layer over the budget, so moving one term reprices the whole film: the top sheet, the SAG-AFTRA tier check, the schedule and the points schedule. It runs in your browser with no account and no server, and your projects stay on your own computer.

Use it at https://profitshare.alonegirlmovie.com/. Press *Load the sample* to look around an invented film, *Salt Flat*.

## What is in 0.1.0

### Starting a budget

- From a script: a Final Draft `.fdx`, Fountain, plain text, or a PDF with real text in it. The app breaks it into scenes, schedules it at your pages per day and draws a first budget, with every line saying how it was sized.
- From scratch, with a standard feature chart of accounts and California fringes.
- From a budget you already have: a Shamel Studio `.xlsx` export, a Movie Magic Budgeting Excel or CSV export, or any spreadsheet with the usual columns. A Movie Magic Scheduling `.sex` board can be dropped in too.
- The sample film: an invented 12-day, 26-scene SAG feature with a 154-line budget that totals $805,312.06.

### The deal

- Shoot days, a 10- or 12-hour day, the SAG-AFTRA tier and the Diversity in Casting incentive.
- Pay as budgeted, or everyone at scale.
- Producer fees, the script purchase and star allowances kept up front, moved to points, deferred, or removed.
- Prep, wrap and post days at a floor rate with the balance on the back end.
- A table that prices the film at every SAG tier under each pay model.
- The budget you brought in is never rewritten. Any term can change at any time.

### Budget

- A top sheet over a chart of accounts you can edit, with up front, deferred and points totals side by side.
- Each line is amount × rate with fringes on top, and a pay type you can change in place.
- The top sheet and the full budget print, and export to Excel, CSV and PDF.

### Schedule

- A stripboard: drag strips, place day breaks by hand, break at a pages-per-day target or fit to a number of days, and split a scene across two days. A day-out-of-days comes with it.
- Cast work days flow from the board into the budget and the points schedule.
- Tagging for props, vehicles, animals, stunts, effects and the rest, with an automatic first pass on imported scripts.
- A calendar on real dates that skips US holidays, exports `.ics` and prints sides for a day.
- Call sheets, one per shoot day, front and back, with sunrise and sunset worked out without the network.
- Breakdowns by shoot day, character, department or one element.

### Points and the waterfall

- Two models: recoup first, or off the gross.
- Points from days worked × a tier multiplier, with an optional bonus or a fixed block.
- Payouts at three revenue figures, the investor multiple, what one point is worth, and each person's wages beside their points.
- Positions that follow the cast or a tag on the board.

### SAG tier check and incentives

- Total production cost the way SAG-AFTRA measures it, checked against each tier's cap, with and without DIC. Rates are those effective 7/1/2026.
- The California Film & Television Tax Credit (Program 4.0), figured from the budget, with the cost of turning it into cash and the application window that fits your start date.
- A proposed federal credit, marked as a bill and not a law.
- California fee waivers as a checklist.

### Pitch and the pitch deck

- Logline, the case, the audience, comparable films, and three revenue cases run through your waterfall, with a printable investor summary.
- A look book, a design made from your own colours, type and logo, research with sources, and the team.
- A deck builder with fourteen kinds of slide and a live preview. The plan and money slides read the budget, the schedule and the deal.
- Sending: a web deck in one `.html` file that opens offline and loads nothing from outside, and PDFs, one set per person, each naming nobody else.

### Privacy and safety

- No accounts, no server, nothing uploaded. Projects live in your browser and in the `.json` file you save.
- Two things use the network, and only when you ask: AI assist, with your own Anthropic key, and the Google Fonts picker, after you agree.
- A content security policy lets the app page talk only to itself, `api.anthropic.com` and the two Google Fonts hosts.
- A project file that cannot be read gets a plain answer, and the parts that can be read still open.
- If the app crashes, a screen offers to download every saved project.

### Browsers and access

- Tested on every pull request in Safari's engine (WebKit), Firefox and Chromium.
- Light and dark. It fits a phone, where wide tables scroll inside their own box.
- Every field and button has a name a screen reader can say.

## What it does not do yet

- **US dollars and California rules only.** Fringes default to a California set, and the state incentive is California's.
- **SAG-AFTRA low-budget theatrical tiers only.** No other union agreements are modelled.
- **No participation-agreement exhibit** from the points schedule.
- **No Movie Magic Budgeting native files (`.mbd`, `.mmbx`).** A version 7 `.mbd` is enciphered. Open it in Movie Magic Budgeting 10 and use File, Export, Tab Delimited; the app says so when one comes in. Old-format `.xls` files are not read either: save them as `.xlsx`.
- **No scanned PDFs.** A script PDF needs real text in it.
- **No reading notes for a sent deck.** The app cannot tell you who opened one.
- **No installable, offline version.**
- **Built for a laptop.** It works on a phone, but budgeting is easier with room.

It is not legal, tax or financial advice. It does not replace a payroll company, a SAG-AFTRA signatory rep or an attorney. Check the numbers with them before anyone signs, and have a lawyer look before you send a deck to potential investors.

## How to run it

Nothing to install: open https://profitshare.alonegirlmovie.com/.

To run your own copy you need Node 22.12 or newer:

```bash
git clone https://github.com/gravy42/profitshare.git
cd profitshare
npm ci
npm run dev        # http://localhost:5173
npm test           # the unit tests
npm run build      # the static site, in dist/
```

`dist/` is a plain static site and can be served from anywhere. `npm run build:single` makes one self-contained `index.html` in `dist-single/`.

## Thanks and support

ProfitShare is MIT licensed. See [CONTRIBUTING.md](../CONTRIBUTING.md) to help, and [SECURITY.md](../SECURITY.md) to report a security problem privately. The README's Support section has the tip jar.
