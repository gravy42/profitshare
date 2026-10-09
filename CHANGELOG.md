# Changelog

ProfitShare is built in the open by Cris Graves, with Claude doing the typing, while she budgets and schedules her first feature. This log is kept by day so anyone picking the project up can see what changed and why. Newest day first. Commit hashes are on `main`.

The app is local-first: your project lives in your browser and in the `.profitshare.json` files you download. Nothing here changes a saved file without saying so.

## 2026-10-09

- **PRODUCT.md.** The project's product record for the impeccable skill and for anyone new: who it's for (a filmmaker budgeting her own film), who reads the outputs (investors and production companies, cast/crew and reps, SAG-AFTRA and the CFC), the positioning (models the back end, not just the raise), operating context, capabilities, constraints, evidence on hand, principles. Written from `/impeccable init`.
- **Calendar: click a shoot day to open it.** The purple Day chip opens a popout with the cast working that day (numbered), everything tagged on the day's scenes by department, a scenes table (D/N, story day, pages, cast, synopsis), and the sides: each scene as written, in script formatting. ←/→ steps through the days; "Print sides / save as PDF" prints the packet. Clicking the date number still opens the add-an-event box. (b6e76d8)
- **Calendar: three months stack full width**, one above the other, same cell size as the one-month view. The ◀ ▶ arrows now step one month at a time in both the one- and three-month views. (b6e76d8, fc32182)
- **Design skill for contributors.** [impeccable](https://github.com/pbakaus/impeccable) 4.5.2 (Apache 2.0) is installed project-scoped under `.claude/skills/impeccable` with its agents, no hooks; `/impeccable <command> <target>` in Claude Code. (0c0633a)

## 2026-10-08

- **Incentives: California law changes.** SB 186 (signed Sept 19, 2026) changed the Program 4.0 refund election from 90% over five years to 95% over two; the model and the tab's labels follow. From tax year 2027 a credit bought from an independent film is exempt from the buyer's $5M cap, noted on the "sold at" hint. AB 2319's standalone post-production credit is documented in the source and on the tab but not modelled: it is for pictures that did not take the production credit, needs at least 75% or $1M of editorial post in California (whichever is greater), and a film in Program 4.0 already has its post inside the production credit. (7f63f58)
- **Calendar: All / One / Three months.** The full range as a grid (as before), one month at full width, or three side by side, with earlier/later paging. The choice is remembered in the browser. (6819067)

## 2026-10-07

- **Deal: crew rates over budget.** The As-budgeted pay model gains a percent: every crew wage line (payroll, not a SAG performer, not an ATL premium) at its budgeted rate plus N%, so the budget's own ladder survives. The "Every tier, both ways" matrix now shows As budgeted · Budget +10% · Budget +15% · Everyone at scale for each SAG tier; click a cell to apply, or type any percent under the As-budgeted radio. This is the hybrid between a plain budget and the Sing Sing model: everyone paid a little better than the budget says, and everyone on the back end. (0c3f96b)

## 2026-10-06

- **Calendar tab.** `Project.calendar` holds the months to show, work week, US-holiday skipping, and events (shoot day, prep, test shoot, wrap, post, travel, hold, day off, note; optional span). The calendar is empty until you pick the months; you place the shoot days by hand (a collapsed "auto-place from a Day 1" walk is there if you want it). "Stamp dates on the board" writes each placed date onto its day break; `.ics` export for Google / Apple / Outlook. Month and year are selects and the calendar opens on a button, because `<input type="month">` is a plain text box in Safari. (88a0449, 9c17739, 2142b04)
- **Day bars on the stripboard show the calendar date** next to "End of Day N". (f0e61c1)
- **Breakdowns tab.** Story days by shoot day (continuity jumps flagged for hair, makeup and wardrobe); by character (every day they work, the story days they play); by department (any tag category by shoot day); track one thing (one element across the schedule: days, pages, where, with whom) or all of a department, one block per item. A "What" column lists every item of the category on each scene, one row per scene, and every tracking table shares one column grid so stacked blocks line up. (cc944cd, f0e61c1, 42b808b)
- **Rename / merge a tag everywhere it appears.** From Track one thing: type a new name, or pick another item in the department to fold the two into one, with no scene ending up with a duplicate. (14a63f7)
- **PDF export = print.** Shooting schedule (landscape, one block per day, story-day column), top sheet, full budget, any breakdown, and the pitch print through the browser's print dialog, which saves to PDF on every platform with no library. (cc944cd)
- **Pitch tab.** Logline, why this film, audience, ordered argument sections, comparable films in groups with medians, three-case revenue projections run through the deal's waterfall (investors, pool, multiple), "Use as the waterfall scenarios", deck and sources; prints as an investor summary. No AI or network in the app; research is pasted in. (ea0173f, 6f74983)

## 2026-10-02

- **Stripboard: move strips as a block** (checkbox picks, shift for a run) and **lift a whole day** with the ⋮⋮ grip; the Days table rows drag too. (1c141e9)
- **Shoot one scene over two days**; the last day's summary shows below the final strip. (a2de7c0, a7f36fd)
- **The stripboard owns cast shoot days**; rehearsal and fitting days get their own line. DOOD can drop a character from the cast list. (8df8d77, 7eac210)
- **Deal: every tier under both pay models, side by side.** The raw budget run through all four SAG tiers under as-budgeted and everyone-at-scale; click a cell to apply that combination. (040a460)

## 2026-09-30

- **Final Draft's tagger comes in.** `.fdx` import reads Final Draft's TagData: cast members, script day, location, synopsis, and every other category under Final Draft's names; scene numbers are kept. A merge carries the writer's tags and recounts the positions that follow them. (6b8bae2)
- **Incentives tab.** The California Film & TV Tax Credit (Program 4.0 as amended by AB 1138) and the proposed federal credit as toggles: what counts, uplifts, how to turn it into cash (sell, refund, own tax), bridge cost, audit, the fiscal-year application windows against your start date. Credits come off what investors fund and recoup, the way grants do. (a2d39e0)
- **Replace asks first and keeps the old board.** Dropping a script on a project with a board offers Merge / Replace / Cancel; Replace confirms with counts, and the replaced board is kept in the browser with a Restore notice that survives reload. (a2d39e0)

## 2026-09-29

- **The Deal tab.** All terms as a layer over the raw budget: the lines you import or type are never rewritten; `applyDeal()` derives the effective budget from raw + terms (day length, producers, pay model, ATL premiums, non-shoot floor), and every view reads the effective one. Projects saved before the layer existed are unbaked on load. (68f8cfc, f1c399c)
- **Labels:** up front / deferred / points, "Budget to raise", "Wages". Grants and fiscal-sponsorship money investors never recoup. (89f7c2d, d8c5adf)
- **Script breakdown.** Drop a screenplay as PDF, Fountain, `.fdx` or plain text (including text copied out of a PDF with no indents) and get scenes, eighths, time of day, synopsis, speaking and silent cast. Merge a script into the board you already have: scenes match by number, the board keeps its order, day breaks and hand tags. (94fcd84, bce1dc8, 598f483)
- **Tagging.** A tagger on every strip: the scene as written with tagged words highlighted, select words to tag them into Movie Magic's category set; first-pass auto-tag on import; the tagger learns animals by name. A position on the points schedule can follow cast or a tag on the board (an animal wrangler follows the cat). (fcc2649, 94d28d2)
- **Points schedule** grouped ATL / Cast / BTL by department with subtotals; days edited there update the wage lines and the reverse; weekly wage lines come in as days (five to the week, same money). **Add position** hires someone into the right account and the schedule in one go. Memo rows (prop lists, headers, spacers) fold into notes instead of being budget lines. (5db8593, 442abed, 4558f72, 017b0e9, 75b598e)
- **DOOD pops out** to full size; cast numbered by scene count, renumber by scenes, first appearance, or by dragging. (b3964cd)
- **Demo:** cue-driven recording with narration; captions as a toggleable subtitle track. (eb08910, 6638c7f, 406c367)

## 2026-09-28

- **ProfitShare 0.2 goes up on GitHub.** History before this day was squashed when the repo went public: the sample project is the invented SALT FLAT, and no real production's data is in the repository. (5b24609)
- **SAG tab:** pay everyone scale (the Sing Sing model) with producers on wage lines; crew and producers can take a different tier's 8-hour rate than the cast; hourly = scale ÷ 8 with overtime (SAG hours for cast, California hours for crew); above-scale ATL money as three groups (points / deferred / cash / delete); prep / wrap / post days at a cash floor with the balance to the back end. (731b8f8, cfc2414, c40dad5, 9f3d28a, 98e054f)
- **10 / 12-hour shooting day toggle** (paid-hours multiplier for hourly crew). (aa55833)
