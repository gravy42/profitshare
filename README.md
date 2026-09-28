# ProfitShare

Open-source budgeting, scheduling and profit-share modelling for independent films.

Commercial budgeting software stops at the cash column. ProfitShare is for films where part of everyone's pay is a share of the back end, the way *Sing Sing* was made: everyone takes scale in cash, and the upside is split by points. Every budget line carries a pay type, `cash` (what you raise), `deferred` (a fixed IOU paid from first proceeds) or `points` (contingent profit participation). The top sheet, the SAG-AFTRA tier check, the stripboard's day-out-of-days and the points schedule all read from the same lines, so moving a producer fee to points, or dragging a scene to a different day, reprices the whole film at once.

Written by a director budgeting her first feature, because none of the tools would let her model the deal she was actually making.

## Demo

[▶ 74-second walkthrough](demo/profitshare-demo.mp4): the sample budget, flipping a line to points, the SAG tier dropping, the waterfall, day breaks, and a drag-and-drop import. `npm run demo` re-records it from `tools/demo.mjs`.

## Try it

The live demo is at **https://gravy42.github.io/profitshare/**. It opens on a start screen with three ways in:

- **From scratch.** An empty budget with a standard feature chart of accounts (1100 Story & Screenplay through 5200 General Expenses) and California payroll fringes. Open a category, open an account, press *+ line*. *Edit accounts* renames, adds and removes categories and accounts; the *Fringes* panel sets rates and caps.
- **Drop files on the page.** ProfitShare works out what each one is. A Shamel Studio `.xlsx` export comes in whole, fringes included. A Movie Magic Budgeting Excel or CSV export (File → Export) is matched by its column headers, as is any spreadsheet with Account, Description, Amount, Units, X, Rate and Total columns. A Movie Magic Scheduling `.sex` board keeps its strip order and breakdown tags; a Final Draft `.fdx` gives scenes, page counts and speaking cast; a saved `.json` reopens a project. Drop them together or one at a time. Movie Magic's native `.mbd` is a closed format, so export first.
- **Open or explore.** Open a saved `.json`, or load the sample: *Salt Flat*, an invented 12-day, 26-scene SAG feature with a 154-line budget and a board in shooting order. Every name and number in it is made up (`tools/make-sample.mjs` builds it).

Then:

1. **Set the deal.** On the SAG tab, pick a tier and press *Re-rate cast* to put every performer on that scale. In *Above-scale ATL money*, tick which of producer fees, the script purchase and star allowances your deal moves to points (or deletes) and watch the cash budget drop. On the Points tab, pick a waterfall and set tier multipliers.
2. **Place day breaks** on the stripboard, then *Push cast days → budget* so cast lines and the points schedule match the schedule.
3. **Save.** Your project is one `.json` file. Nothing leaves your browser unless you send it somewhere.

## What it does

- **Top sheet and budget.** Movie-Magic-style chart of accounts with per-line fringes (a rate plus a wage-base cap per line; the model was fitted against a real Shamel Studio export and reproduces its math to the cent). Add, edit and remove lines, accounts, categories and fringes in place. Shows cash budget, deferred total and points value side by side.
- **Stripboard.** Drag to reorder, insert day breaks, or auto-break at a pages-per-day target without changing your scene order. Day summaries, day-out-of-days with work and hold days, and a one-click sync of cast work days into the cast budget lines and the points schedule.
- **Points and waterfall.** Two waterfalls: recoup-first, and off-the-gross where the pool takes a share from dollar one. Tiers are multipliers on days worked, with a per-person bonus multiplier. Payouts at three revenue scenarios, investor multiples, and each person's cash pay next to their points.
- **SAG tier.** Total production cost the way SAG measures it (deferred pay counts, points do not). Ultra Low, Moderate Low, Low Budget and Basic caps, with and without the Diversity in Casting incentive. Re-rate every performer line at a tier's scale in one click.
- **Local-first.** No accounts, no server, no telemetry. Autosaves to your browser; Save and Open a `.json` project file to keep it or hand it to a collaborator.

## Run it locally

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # engine tests, including round-trips of the sample through every importer
npm run build          # static site in dist/ (the GitHub Pages workflow deploys this)
npm run build:single   # one self-contained index.html in dist-single/
npm run sample         # rebuild the sample project and the importer fixtures from tools/make-sample.mjs
npm run smoke          # Playwright walk-through with screenshots, light and dark
npm run demo           # re-record demo/profitshare-demo.mp4 (needs ffmpeg)
```

Needs Node 20 or newer. The Pages workflow in `.github/workflows/pages.yml` builds and deploys on every push to `main`; turn on Pages in the repo settings with *Source: GitHub Actions*.

## How it's built

```
src/engine/            pure TypeScript, no React: budget math, SAG tiers, waterfall, board, importers
src/engine/*.test.ts   vitest
src/data/              the sample project, the standard chart of accounts, and the seed builder
src/ui/                React views
tools/                 make-sample.mjs (builds the sample and its fixtures), smoke tests, test fixtures
```

`src/engine/types.ts` is the whole data model. A project file is that object as JSON, so anything that can read JSON can read a ProfitShare project.

The `.sex` reader was reverse-engineered from a Shamel Studio export (there is no public spec); `tools/make-sample.mjs` writes the test fixture in the same layout. The spreadsheet importer (`src/engine/importers/genericBudget.ts`) matches columns by header name and treats rows with a number and a name but no money as account or category headers, which is the shape Movie Magic Budgeting exports. If a file from another app fails to import, open an issue and attach it.

## Rates and disclaimers

SAG-AFTRA low-budget minimums are the 7/1/2026 figures, which rise 3 % every July through 2030; P&H is 22 % from 9/6/2026. Fringes default to a California 2026 set: FICA 7.65 %, FUI 0.6 % and CA SUI 6.2 % on the first $7,000 per line, workers' comp 4.48 %, payroll fee 1.75 %, SAG P&H 21 %. Change them in the Fringes panel under the top sheet.

None of this is legal, tax or financial advice. Check the numbers with your payroll company, your SAG-AFTRA signatory rep and your attorney before anyone signs.

## Roadmap

- Call sheet and one-liner exports from the board
- Participation-agreement exhibit generated from the points schedule
- CSV and XLSX export of the top sheet and points schedule
- Movie Magic Budgeting native `.mbd` files (needs a sample; the Excel/CSV export already imports)
- Optional AI-assisted breakdown tagging for scripts imported from Final Draft (opt-in, bring your own key)

## Contributing

Issues and pull requests are welcome. Engine changes need a test; the sample budget must still total $811,758.05 and round-trip through the importers.

## License

MIT © 2026 Cris Graves
