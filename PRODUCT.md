# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a filmmaker budgeting her own film: a writer-director or producer-director doing the line producer's job herself, usually alone, often at night, with a script, a spreadsheet export and a deal she is still working out. She knows the film better than any tool does and the tool's numbers better than any investor will; she is not a full-time budgeting professional and should never have to be one to use this. Every screen is designed for her first.

Secondary readers never open the app; they read what it prints. Three of them are confirmed and the outputs must be built for them:

- Investors and a production company: the top sheet, the projections and the investor summary go out as PDFs to people deciding whether to fund the film.
- Cast, crew and their representatives: the points schedule, the shooting schedule, breakdowns and sides go to people on the show; agents read the cast lines.
- SAG-AFTRA and the California Film Commission: the tier check and the incentive figures are compared against the rules by someone whose job is to say no.

A working line producer or UPM who already knows Movie Magic is welcome but is not the design target; density and speed never win over the primary user understanding what a number means.

## Product Purpose

ProfitShare is open-source budgeting, scheduling and profit-share modelling for independent films. It exists because commercial budgeting software stops at what you pay up front, and the films the primary user is making pay part of everyone's wage as a share of the back end, the way *Sing Sing* was made: everyone takes scale up front and the upside is split by points.

Success is a filmmaker arriving at a budget, a schedule and a deal she can defend in a room: she can say what the film costs to raise, who gets what if it makes money, that the cast is paid legally for the tier the film lands in, and show the schedule the numbers came from, all from one file she keeps on her own machine.

## Positioning

ProfitShare models the back end, not just the raise. Every budget line carries a pay type, up front, deferred or points, and the deal (day length, SAG tier, pay model, what happens to the above-scale money, floor rates, grants, the waterfall) is a layer over the raw budget that the budget never loses. Move one term and the whole film reprices: the top sheet, the SAG tier check, the day-out-of-days, the points schedule and the investor projections all read from the same lines. A Movie Magic, Showbiz or Saturation.io budget cannot truthfully say that; it stops where the cash stops.

## Operating Context

- One project is one `.json` file, terms included; it autosaves to the browser and is handed to a collaborator by sending the file. No accounts, no server, no telemetry, no network calls from the app.
- Inputs are the documents a production already has: a Shamel Studio or Movie Magic Budgeting export (`.xlsx`, `.csv`), a Movie Magic Scheduling board (`.sex`), a screenplay (`.fdx` with Final Draft's tags, Fountain, plain text, or a PDF with real text). Movie Magic's native `.mbd` is closed and is not read.
- Outputs leave the app on paper: the browser's print dialog saves every report as a PDF (shooting schedule, top sheet, full budget, breakdowns, sides, investor summary) and the calendar exports `.ics`.
- The work happens across tabs that share one project: Start, Deal, Top sheet & budget, Stripboard, Calendar, Breakdowns, Points & waterfall, SAG tier, Incentives, Pitch, About.
- Rules the product encodes change on a schedule the product does not control: SAG-AFTRA tier day rates and caps, the California Film & TV Tax Credit program and its application windows, federal bills. Figures carry their source and check date in the code and on the tab.
- It is being built alongside a real feature in prep. That production's data is never in the repository; the sample project, SALT FLAT, is invented, and the engine tests pin its totals.

## Capabilities and Constraints

- Deal layer (`src/engine/deal.ts`): raw lines are never rewritten; `applyDeal()` derives the effective budget and every view reads it. Lines the deal sets are marked on the top sheet with rate, hours and pay type locked and days and descriptions editable.
- Pay models: as budgeted (optionally cast re-rated to the tier, optionally every crew wage line raised by a percent over its budgeted rate) and everyone at scale (one hourly for everyone, scale ÷ 8 with overtime; crew and producers may share a different tier's rate or a custom one). A tier matrix shows every SAG tier under each model side by side.
- Budget: Movie Magic style chart of accounts with per-line fringes fitted against a real Shamel export to the cent; memo rows fold into notes; weekly crew lines come in as days.
- Stripboard: drag, block moves, day lifts, day breaks, fit to N days, scene split across days, DOOD with renumbering, tagger on every strip with Movie Magic's category set, positions on the points schedule that follow cast or a tag.
- Calendar: user-placed shoot days and events on a month grid, holidays, stamping dates onto the board, a day popout with cast, tags, scenes and sides.
- Breakdowns: story days by shoot day, by character, by department, one element or a whole department across the schedule, rename/merge of tags.
- Points & waterfall: tiers as multipliers on days worked, bonus multipliers, two waterfalls (recoup-first and off-the-gross), three revenue scenarios, investor multiples, wages beside points.
- SAG tier: total production cost the way SAG measures it (deferred counts, points do not) against Ultra Low, Moderate Low, Low Budget and Basic caps, with and without Diversity in Casting.
- Incentives: California Program 4.0 and the proposed federal credit as toggles; proceeds reduce what investors fund and recoup. Not legal or tax advice, and the tab says so.
- Pitch: logline, audience, argument sections, comparable films, three-case projections through the waterfall, printable investor summary. Research is pasted in; the app does no lookups.
- Constraints: no AI calls and no API keys inside the app (an opt-in, bring-your-own-key tagging assist is on the roadmap and off by default); Safari is a first-class browser (native month inputs and similar controls are avoided where Safari renders them as text); everything prints.
- Terminology the product uses on purpose: "up front" (what you raise; `cash` in the file), "deferred" (a fixed IOU from first proceeds), "points" (contingent participation), "budget to raise", "wages", "day break", "DOOD", "sides", "tier", "scale".
- Undecided: call sheet and one-liner exports, participation-agreement exhibit, CSV/XLSX export, SAG weekly deal modelling, whether voice-over and off-screen voices count as on-set cast (today they do when the writer tagged them).

## Brand Commitments

- The name is ProfitShare (working name was Splitboard; retired). MIT, © 2026 Cris Graves.
- Written by a director budgeting her first feature, because none of the tools would let her model the deal she was actually making. That sentence is the voice: first person where it fits, plain words, film terms used the way a set uses them, no marketing register.
- Copy explains what a number means before it asks for one; hints say what a field does, not how to feel about it.

## Evidence on Hand

- The sample project SALT FLAT (`tools/make-sample.mjs`): a 12-day, 26-scene SAG feature with a 154-line budget and a board in shooting order. Every name and number invented.
- Fixtures: `tools/fixtures/SaltFlat_Script.fountain` and its PDF, `tools/fixtures/sample.fdx` with an invented TagData block.
- A narrated 2:41 demo, `demo/profitshare-demo.mp4`, with captions as a subtitle track.
- Engine tests (`src/engine/engine.test.ts`) pin the sample's totals and the importers' round-trips.
- Rate and rule sources are cited in the source files that use them (`src/engine/sag.ts`, `src/engine/incentives.ts`) with check dates.
- There are no testimonials, user counts, customer names or press; none may be invented. The one real production using it is not named in the repository.

## Product Principles

1. The budget you brought in is never rewritten; the deal sits on top and can be changed at any time. Anything that would change a raw line says so first.
2. One file, one truth: the top sheet, the board, the schedule, the points and the pitch read the same lines, so a change anywhere shows everywhere.
3. Explain the number: a figure on screen should be traceable to a line, a rate and a rule, and the rule should carry its source and date.
4. Built for the filmmaker, printed for the room: the person at the keyboard is doing this alone; the people reading the output have no app and no patience.
5. Nothing leaves the machine: no accounts, no network, no keys; local files are the product's memory.

## Accessibility & Inclusion

No formal standard has been set. Working requirements: readable in light and dark (the app ships both), usable in Safari and Chrome on a laptop, printed reports legible in black and white on Letter paper, and tables that read at 11px because that is where production paperwork lives. Mobile use is expected for reading, not editing, and has not been designed yet.
