# Rates and dated rules: the yearly check

ProfitShare carries figures that other people set and change: union minimums, payroll taxes, minimum wages, a state tax credit. This page lists every place they live in the code, what each says today, and what to check and when.

None of this is legal, tax or financial advice, and the app says so. The point of the check is that the defaults a filmmaker starts from are the current published ones, and that every figure says where it came from.

## When to check

- **Every 1 July.** SAG-AFTRA low-budget rates rise each 1 July (3% a year through 2030, as the code records it). The City of Los Angeles and Los Angeles County minimum wages move on 1 July too.
- **Every 1 January.** The California minimum wage and the payroll tax figures change with the calendar year.
- **When the California Film Commission publishes a new fiscal year's application windows,** and whenever the credit's law changes.
- **Before any release.**

## How to make a change

1. Change the figure in the one place listed below, and update the comment beside it with the source and the date you checked. Name the organisation and the document. A figure with no source does not go in.
2. Update the words that repeat it: the places are listed under each heading.
3. Run `npm run sample` and `npm test`. The sample film's total is pinned by the tests, so a rate change that moves it has to be made on purpose: update the pinned total everywhere it is written (the tests, `README.md`, `CONTRIBUTING.md` and the pull request template) and say why in the changelog.
4. Add a changelog bullet that says what moved, from what to what, and from which date.

Projects people have already saved keep the rates and fringes they were saved with. A change here alters the defaults for new budgets and the SAG tier figures the app reads live, so say in the changelog which it is.

## 1. SAG-AFTRA low-budget tiers, caps and rates

**Where:** `src/engine/sag.ts`, the constant `SAG_TIERS`.

| Tier | Day rate | Weekly rate | Cap | Cap with DIC | P&H | Effective, as the code states it |
| --- | --- | --- | --- | --- | --- | --- |
| Ultra Low Budget (`ULB`) | $257 | none | $300,000 | $300,000 | 22% | 2026-07-01 |
| Moderate Low Budget (`MLB`) | $449 | $1,560 | $700,000 | $1,050,000 | 22% | 2026-07-01 |
| Low Budget (`LBA`) | $834 | $2,896 | $2,000,000 | $3,750,000 | 22% | 2026-07-01 |
| Theatrical Basic (`BASIC`) | $1,321 | $4,585 | none | none | 22% | 2026-07-01 |

The comment above the constant records: low-budget rates effective 7/1/2026, rising 3% a year through 2030; pension and health (P&H) 22% for principals from 9/6/2026 on the low-budget agreements; sources, the SAGindie 2026 contract notice and the SAG-AFTRA Moderate Low Budget agreement text.

**Check each year, after 1 July:** the day and weekly rate for each tier; each budget cap and its Diversity in Casting (DIC) cap; the P&H rate and the date it took effect; the Theatrical Basic rates, which follow the main theatrical contract and its own dates. Update each row's `effective` date.

**Who publishes it:** SAG-AFTRA, in the agreements themselves and its rate sheets. SAGindie publishes plain summaries of the low-budget agreements for independent filmmakers.

**Words that repeat it:** the help text on the SAG tier tab (`src/ui/SagView.tsx`), the *Rates* line on the About tab (`src/App.tsx`), and "What it is and what it is not" and "Rates and disclaimers" in `README.md`.

## 2. Overtime: how many hours a day is paid as

**Where:** `src/engine/budget.ts`, the constant `PAID_HOURS`.

It turns a 10- or 12-hour day into paid hours for a rate that covers 8. Crew follow the California pattern (1.5 times after 8 hours, double after 12). A SAG-AFTRA day performer gets 1.5 times for hours 9 and 10 and double after 10. The code gives no date for these.

**Check each year:** that both patterns still stand.

**Who publishes it:** the California Department of Industrial Relations for California overtime; SAG-AFTRA for performers' overtime, in the agreements.

## 3. California payroll fringes

**Where:** `src/engine/importers/shamelXlsx.ts`, the constant `CA_FRINGES_2026`. Every new budget starts from this set (`src/data/seed.ts` copies it).

| Fringe (`id`) | Rate | Wage cap per line | Who publishes the figure |
| --- | --- | --- | --- |
| Social Security (`FICA1`) | 6.2% | none in the code | Internal Revenue Service; the Social Security Administration sets the yearly wage base |
| Medicare (`FICA2`) | 1.45% | none | Internal Revenue Service |
| Federal unemployment (`FUI`) | 0.6% | $7,000 | Internal Revenue Service |
| California unemployment (`SUI (CA)`) | 6.2% | $7,000 | California Employment Development Department. The rate is set per employer, so this is a default |
| Workers' compensation (`WC (CA)`) | 4.48% | none | Not a published rate: it comes from the payroll company or insurer |
| Payroll service fee (`PAYROLL FEE`) | 1.75% | none | Not a published rate: it is the payroll company's quote |
| SAG-AFTRA P&H, principals (`SAG AFTRA`) | 21% | none | SAG-AFTRA, and the SAG-AFTRA health and pension plans |
| SAG-AFTRA P&H, background (`SAG AFTRA BG`) | 20.75% | none | The same |
| Payroll fee, SAG background (`PAYROLL FEE SAG BG`) | 1.75% | none | The payroll company's quote |

**Effective date, as the code states it:** the year in the constant's name, 2026. The comment says the set was fitted to a Shamel Studio export's own sums. No day is given.

**Check each year, in January:** each rate and each cap. When the year changes, rename the constant to the new year so the name stays true.

**Two things to know before the next check:**

- The principals' P&H default here is 21%, while `SAG_TIERS` says 22% from 9/6/2026. The SAG tier tab tells the person when the two disagree, and `README.md` describes both. Decide at the next check whether the default should move to 22%. Moving it changes the sample film's total.
- Social Security has no wage cap in this set. The real tax stops at a yearly wage base. On a low-budget film few people reach it, but it is a known simplification.

**Words that repeat it:** "Rates and disclaimers" in `README.md`, and the *Rates* line on the About tab (`src/App.tsx`).

## 4. Minimum wages

**Where:** `src/engine/locations.ts`, the constants `CA_MIN_WAGE` and `MIN_WAGE_PRESETS`.

| What | Figure | Effective, as the code states it |
| --- | --- | --- |
| California, state rate (`CA_MIN_WAGE`) | $17.40 an hour | from 1 January 2027 (it was $16.90 in 2026) |
| City of Los Angeles (`la-city`) | $18.42 | since 1 July 2026 |
| Los Angeles County, unincorporated (`la-county`) | $18.47 | since 1 July 2026 |

The comment records these as checked on 16 November 2026.

`CA_MIN_WAGE` is also the default floor rate for prep, wrap and post days in the deal (`defaultDeal()` in `src/engine/deal.ts`), the default for a new shoot location, and the rate for non-union background in a budget started from a script (`src/engine/starter.ts`).

**Check each year:** the state rate in the autumn, for the coming 1 January; the city and county rates in the spring, for the coming 1 July.

**Who publishes it:** the California Department of Industrial Relations (state); the City of Los Angeles Office of Wage Standards (city); the Los Angeles County Department of Consumer and Business Affairs (county).

## 5. California Film & Television Tax Credit

**Where:** `src/engine/incentives.ts`. The long comment at the top of the file is the record of sources, checked on 30 September 2026.

| Constant | What it is | Value |
| --- | --- | --- |
| `CA_BASE` | Base credit for an independent film | 35% |
| `CA_OUT_OF_ZONE` | Uplift for days outside the Los Angeles zone | 5% |
| `CA_LOCAL_HIRE` | Uplift on local-hire labour outside the zone | 10% |
| `CA_VFX` | Visual effects uplift | 5% |
| `CA_TRAINEE`, `CA_TRAINEE_MAX` | Career Pathways trainees: 0.5% each, for up to 4 | up to 2% |
| `CA_QUALIFIED_CAP` | Qualified spend the credit is figured on | first $20,000,000 |
| `CA_MIN_BUDGET` | Smallest budget that can apply | $1,000,000 |
| `CA_REFUND_SHARE`, `CA_REFUND_YEARS` | Taking the credit as a refund | 95% over 2 years |
| `CA_CAREER_PATHWAYS_FEE` | Fee, as a share of the allocation | 0.25% |
| `CA_DAYS_TO_START` | Days from the credit allocation letter to the start of photography | 180 |
| `CA_DEFAULT_EXCLUDED` | Which budget categories do not qualify by default | above the line except stunts, plus publicity, marketing, distribution and financing |

**Effective date, as the code states it:** Program 4.0 as amended by AB 1138 (2025); the refund terms from SB 186, signed 19 September 2026 and effective at once.

**Application windows:** the constant `CA_WINDOWS`, for fiscal year 2026 to 2027:

| Apply | Closes | Credit allocation letter |
| --- | --- | --- |
| 10 to 12 August 2026 | 2026-08-12 | 2026-09-21 |
| 11 to 13 January 2027 | 2027-01-13 | 2027-02-22 |
| 3 to 5 May 2027 | 2027-05-05 | 2027-06-14 |

**Check each year:** the next fiscal year's windows as soon as they are published, replacing this list (the tab picks the window that fits the start date, so a list with only past dates is of no use to anyone); every percentage and limit in the table; whether the programme has been amended again; the default start date in `defaultIncentives()` (`2027-03-01` today), which should sit in the future.

**Who publishes it:** the California Film Commission. The law itself is on California's legislative information site.

**Defaults that are estimates, not rules:** in `defaultIncentives()`, a credit sold at 90 cents on the dollar (`transferCents`), a bridge loan costing 8% (`bridgeCostPct`), and an audit at $15,000 (`auditCost`). Nobody publishes these. Ask a broker or a production accountant whether they are still fair.

**Not modelled:** the separate post-production credit (AB 2319). The comment says why.

**Words that repeat it:** the help text on the Incentives tab (`src/ui/IncentivesView.tsx`), which names the fiscal year and the programme, and "Rates and disclaimers" in `README.md`.

## 6. The proposed federal credit

**Where:** `src/engine/incentives.ts`, the constants `FED_BASE` (20%), `FED_BONUS` (5%), `FED_MAX` (30%), `FED_MIN_BUDGET` ($1,000,000) and `FED_FIRST_START` (`2027-01-01`).

**Status, as the code states it:** a bill introduced on 24 September 2026. It is not law, and the tab and the code both say so.

**Check each year, and before any release:** whether the bill has moved, changed, passed or died. If it has died, take the switch off the tab. If it has passed, every figure needs checking against the law as passed, and the wording changes from "proposed".

**Who publishes it:** the United States Congress, which publishes each bill's text and status.

## 7. California fee waivers and local perks

**Where:** `src/engine/incentives.ts`, the constant `LOCAL_PERKS`.

A checklist with hints. One hint carries figures: the City of Los Angeles production tax, "$145 on the first $5M, then $1.30 per $1,000". The code gives no date for it beyond the file's own check date, 30 September 2026.

**Check each year:** that each perk still exists, and the Los Angeles tax figures.

**Who publishes it:** the California Film Commission lists the state's other incentives; the City of Los Angeles Office of Finance collects the city tax; FilmLA handles Los Angeles permits; the City of Santa Clarita runs its own film office.

## 8. Ballpark crew rates and allowances

**Where:** `src/engine/starter.ts`: `BALLPARK_DEFAULT`, the `day` figures in `CREW`, and `ALLOWANCES`.

These size a first budget drawn from a script: day rates for a non-union Los Angeles crew on a 10-hour day, and what a department spends in a day. They are not anyone's published rates and carry no date, and every line they make says how it was sized.

**Check each year:** read them against current budgets with a line producer and nudge them if they have drifted. There is no authority to cite, so the comment should say they are a ballpark and when they were last looked at.

## Nothing to do each year

- **US holidays** (`usHolidays()` in `src/engine/calendar.ts`) are worked out by rule for any year. Check only if a holiday is added or moved by law.
- **Sunrise and sunset** on call sheets are worked out from the date and the place.
