# ProfitShare

Open-source budgeting, scheduling and profit-share modelling for independent films.

Commercial budgeting software stops at what you pay up front. ProfitShare is for films where part of everyone's pay is a share of the back end, the way *Sing Sing* was made: everyone takes scale up front, and the upside is split by points. Every budget line carries a pay type: up front (what you raise; `cash` in the file), deferred (a fixed IOU paid from first proceeds) or points (contingent profit participation). The top sheet, the SAG-AFTRA tier check, the stripboard's day-out-of-days and the points schedule all read from the same lines, so moving a producer fee to points, or dragging a scene to a different day, reprices the whole film at once.

Written by a director budgeting her first feature, because none of the tools would let her model the deal she was actually making.

## Demo

[▶ Narrated walkthrough, 2:41](demo/profitshare-demo.mp4): the Deal tab repricing the sample live, the top sheet showing what the deal set, the SAG check, the waterfall, day breaks, and a drag-and-drop import of a budget and a script. Captions are a subtitle track you can switch on (CC in QuickTime or VLC); `demo/profitshare-demo.srt` and `.vtt` sit beside it for YouTube or a web player. `npm run demo` re-records a captioned silent cut from `tools/demo.mjs`; `npm run demo:vo` records a clean cut timed to `demo/vo.mp3` and lays the narration and subtitles on (the script is `demo/voiceover.txt`).

## Try it

The live demo is at **https://gravy42.github.io/profitshare/**. It opens on a start screen with three ways in:

- **From scratch.** An empty budget with a standard feature chart of accounts (1100 Story & Screenplay through 5200 General Expenses) and California payroll fringes. Open a category, open an account, press *+ line*. *Edit accounts* renames, adds and removes categories and accounts; the *Fringes* panel sets rates and caps.
- **Drop files on the page.** ProfitShare works out what each one is. A Shamel Studio `.xlsx` export comes in whole, fringes included. A Movie Magic Budgeting Excel or CSV export (File → Export) is matched by its column headers, as is any spreadsheet with Account, Description, Amount, Units, X, Rate and Total columns. Weekly crew and staff wage lines come in as days (five to the week, rate ÷ 5, same money), because everything here is priced by the day; SAG weekly deals and weekly rentals stay as they are, and *Weeks → days* on the top sheet does the same for a project you already have open. Spreadsheet rows that carry no money (blank spacers, `CAST #3: COLIN` headers, a prop list with a quantity on each row) are folded into a note on the line they belong to, so a 900-row export reads as the 300 lines that cost something; *Fold memo lines* on the top sheet does it for an open project, every line can take a note (✎), and *hide empty* tucks away the zero-day placeholders. A Movie Magic Scheduling `.sex` board keeps its strip order and breakdown tags; a script gives scenes, eighths and speaking cast, from Final Draft `.fdx`, Fountain or plain text (Highland, Celtx, WriterDuet, Final Draft's save-as-text) or a screenplay PDF with real text in it; a saved `.json` reopens a project. Drop them together or one at a time. Movie Magic's native `.mbd` is a closed format, so export first.
- **Script breakdown.** A dropped script becomes a first-pass board: one strip per scene heading with INT/EXT, set, time of day, scene number if the script has them (numbered in script order if it doesn't), a length in eighths measured from where the headings fall on the page, the first action line as a synopsis, and the cast. Cast is everyone who speaks in the scene plus any speaking character the action names in caps or Title Case (so Lena floating alone in the pool still counts). The cast list is numbered the way a breakdown numbers it, most scenes first; the day-out-of-days pops out to full size (⤢ on the board) and there you can renumber by scenes, by first appearance, or by dragging rows, and the strips and points schedule follow. Text copied and pasted out of a PDF works too, page numbers and all. A scanned PDF has no text to read, so export the PDF from the writing app instead.
- **Tagging.** Every strip keeps the scene as written. Open a strip's ⌄ to read it, select any words and file them under a category (Extras, Stunts, Vehicles, Props, Animals, Wardrobe, Makeup/Hair, Set Dressing, Greenery, Special Effects, Visual Effects, Sound, Music, Special Equipment, Security, Additional Labor, Notes: the Movie Magic set, so a `.sex` board and a tagged script agree), the way Final Draft's tagger works; tagged words light up in the text, chips come off with ×, and a name tagged as Cast joins the cast list. On import every scene gets an automatic first pass from the action lines (never the dialogue): CAPS phrases and a keyword vocabulary for vehicles, animals, sounds, music, wardrobe, makeup, set dressing, effects, screen inserts, stunts (the whole beat, as a sentence) and props; a DRIVING heading adds a car mount. It over-tags a little and misses what the writer didn't name, which is what a first pass is for. *Auto-tag all scenes* and the per-scene *Auto-tag* keep the tags you've added. `tools/fixtures/SaltFlat_Script.fountain` and the PDF made from it by `tools/make-script-pdf.mjs` are the test scripts.
- **Hiring.** *+ Add position* on the Points tab makes the wage line in the right account (suggested from the title, and created if the budget doesn't carry it: 1501 Stunt Coordinator, 1503 Intimacy Coordinator, 2112 Studio Teacher, 2806 Set Medic, 3502 Health & Safety) and the person on the schedule, linked, in one go. A position can follow cast instead of carrying a day count: a studio teacher on set whenever the minors work takes its days from the stripboard and keeps them when *Push cast days → budget* runs.
- **Open or explore.** Open a saved `.json`, or load the sample: *Salt Flat*, an invented 12-day, 26-scene SAG feature with a 154-line budget and a board in shooting order. Every name and number in it is made up (`tools/make-sample.mjs` builds it).

Then:

1. **Set the terms on the Deal tab.** Shoot days and a 10- or 12-hour day; the SAG tier and DIC; how people are paid (as budgeted, or everyone at scale, the *Sing Sing* deal, with the crew rate you choose); what happens to producer fees, the script purchase and star allowances (up front, points, deferred, or gone); prep, wrap and post days at a floor rate with the balance to the back end; grants that investors never recoup; and the waterfall. The budget you imported is never rewritten. The terms sit on top of it, every tab recomputes live, and you can change any term at any time.
2. **Place day breaks** on the stripboard (*Fit to N days* keeps your order and balances the pages), then *Push cast days → budget* so cast lines and the points schedule match the schedule.
3. **Save.** Your project is one `.json` file, terms included. Nothing leaves your browser unless you send it somewhere.

## What it does

- **Deal tab.** Every term in one place, applied as a layer over the raw budget: day length, SAG tier, pay model (as budgeted or everyone at scale with overtime priced off the 8-hour rate), premiums, non-shoot-day floor rate, producers' headcount and days, grants, waterfall. Lines the deal sets are marked on the top sheet; days and descriptions stay editable.
- **Top sheet and budget.** Movie-Magic-style chart of accounts with per-line fringes (a rate plus a wage-base cap per line; the model was fitted against a real Shamel Studio export and reproduces its math to the cent). Add, edit and remove lines, accounts, categories and fringes in place. Shows the budget to raise, deferred total and points value side by side.
- **Stripboard.** Drag to reorder, insert day breaks, or auto-break at a pages-per-day target without changing your scene order. Day summaries, day-out-of-days with work and hold days, and a one-click sync of cast work days into the cast budget lines and the points schedule.
- **Points and waterfall.** Two waterfalls: recoup-first, and off-the-gross where the pool takes a share from dollar one. Tiers are multipliers on days worked, with a per-person bonus multiplier. Payouts at three revenue scenarios, investor multiples, and each person's wages next to their points.
- **SAG tier.** Total production cost the way SAG measures it (deferred pay counts, points do not). Ultra Low, Moderate Low, Low Budget and Basic caps, with and without the Diversity in Casting incentive, checked against the effective budget.
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
npm run demo           # re-record a silent, captioned demo/profitshare-demo.mp4 (needs ffmpeg)
npm run demo:vo        # narrated cut: analyze demo/vo.mp3, re-record clean, mux voice + subtitle track (VO_SILENCE=0.7 for tighter pauses)
```

Needs Node 20 or newer. The Pages workflow in `.github/workflows/pages.yml` builds and deploys on every push to `main`; turn on Pages in the repo settings with *Source: GitHub Actions*.

## How it's built

```
src/engine/            pure TypeScript, no React: budget math, the deal layer (deal.ts), SAG tiers, waterfall, board, importers
src/engine/*.test.ts   vitest
src/data/              the sample project, the standard chart of accounts, and the seed builder
src/ui/                React views
tools/                 make-sample.mjs (builds the sample and its fixtures), smoke tests, test fixtures
```

`src/engine/types.ts` is the whole data model. A project file is that object as JSON, so anything that can read JSON can read a ProfitShare project.

The `.sex` reader was reverse-engineered from a Shamel Studio export (there is no public spec); `tools/make-sample.mjs` writes the test fixture in the same layout. The spreadsheet importer (`src/engine/importers/genericBudget.ts`) matches columns by header name and treats rows with a number and a name but no money as account or category headers, which is the shape Movie Magic Budgeting exports. The script reader (`src/engine/importers/screenplay.ts`) is one parser for Fountain, plain text and the positioned lines pdf.js pulls out of a PDF (`pdfScript.ts`, loaded on first use): a character cue is an all-caps line that sits further in than the action and has dialogue under it. If a file from another app fails to import, open an issue and attach it.

## Rates and disclaimers

SAG-AFTRA low-budget minimums are the 7/1/2026 figures, which rise 3 % every July through 2030; P&H is 22 % from 9/6/2026. Fringes default to a California 2026 set: FICA 7.65 %, FUI 0.6 % and CA SUI 6.2 % on the first $7,000 per line, workers' comp 4.48 %, payroll fee 1.75 %, SAG P&H 21 %. Change them in the Fringes panel under the top sheet.

None of this is legal, tax or financial advice. Check the numbers with your payroll company, your SAG-AFTRA signatory rep and your attorney before anyone signs.

## Roadmap

- Call sheet and one-liner exports from the board
- Participation-agreement exhibit generated from the points schedule
- CSV and XLSX export of the top sheet and points schedule
- Movie Magic Budgeting native `.mbd` files (needs a sample; the Excel/CSV export already imports)
- Optional AI-assisted breakdown tagging for imported scripts (opt-in, bring your own key)

## Contributing

Issues and pull requests are welcome. Engine changes need a test; the sample budget must still total $811,758.05 and round-trip through the importers.

## License

MIT © 2026 Cris Graves
