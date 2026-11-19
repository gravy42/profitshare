# The project file

This page says what a ProfitShare project file is, what the app does when it opens one, and the rule for changing the format. It is for anyone changing the code, and for anyone who wants to read a project with something other than ProfitShare.

## What a `.profitshare.json` is

When you press *Save*, the app downloads one file named after the project and its version label, for example `Salt_Flat_v1.profitshare.json`. That file is the whole project: the budget, the deal, the stripboard, the calendar, the call sheets, the points schedule and the pitch, with its pictures and any font files inside it. Nothing else is needed to open it again, here or on someone else's computer.

It is plain JSON. `src/engine/types.ts` is the whole data model, and the file is the `Project` object from that file written out as it is. Anything that can read JSON can read a project.

Two things are never in the file: the person's Anthropic API key, and anything about other projects in the same browser.

## `schemaVersion`

Every project carries a number called `schemaVersion` at the top level. Today it is `1`, and it has been `1` since the first version. It says which shape the file is in, so a later version of the app can tell an old file from a new one.

It is not the same thing as the project's own `version` field, which is the label the filmmaker types ("v1", "Draft 3").

## What the app does when it opens a file

Every project comes in through one door, `checkProject()` in `src/engine/openProject.ts`. A file you open and a project saved in the browser both go through it. It never throws, and it never changes what it was given.

**A file that is not a project is refused.** An empty file, a file that is not JSON, and a file with no `schemaVersion` of `1` each get a plain sentence, such as "This file is not a ProfitShare project."

**A file from a newer version is refused.** If `schemaVersion` is a number above the one this version knows, the app says "This file was made by a newer version of ProfitShare" and asks the person to reload the page to get the latest version. It does not try to open it, because guessing at a shape it does not know could change the money.

**The core must be right, or the file is refused.** The parts a budget cannot exist without must be there and of the right kind, down to each line's numbers: the budget lines, accounts, categories, fringes, the points schedule and its tiers, the waterfall terms, the SAG-AFTRA settings, the stripboard, the number of shoot days and the contingency. If one is missing or cannot be read, the app says which, in words a filmmaker would use ("This project file is missing its budget lines").

**An optional part that cannot be read is dropped or set back to its default, and the app says so.** These parts were added over time and each has a default: the length of the shooting day, the notes, the deal terms, the incentives, the shoot locations, the calendar, the pitch and the call sheets. If one is absent, the app uses its default and says nothing, because nothing was lost. If one is there but in a form that cannot be read, it is left out or reset, the rest of the file opens, and the person is told which parts were affected: "Some of it could not be read and was left out or set back to its default: the calendar. Everything else is as it was saved."

**Fields the app does not know are kept.** A newer ProfitShare may have written them, so they are carried through as they are.

Inside the checker, each field of a record is read in one of three ways:

| Mode | Meaning |
| --- | --- |
| `must` | It has to be there and of the right type, or the record is no good. |
| `fill` | It has to be of the right type, but if it is left out it takes a default that loses nothing (an empty text, an empty list). |
| `may` | It is optional. If it is of the wrong type it is taken off and the record is kept. |

A few defaults are filled in outside the checker. `withDeal()` in `src/engine/deal.ts` fills any deal term that is left out, each time a project is opened. `withIncentives()` in `src/engine/incentives.ts` does the same for incentives, each time they are read.

## The app never rewrites a file on disk

ProfitShare runs in a browser and cannot write to your files. Opening a file reads it into memory and leaves the file exactly as it was. Anything the app repairs, defaults or upgrades is changed in memory only. The file on disk changes only when the person presses *Save* and chooses to replace it with the new download.

The same care applies to projects saved in the browser: a saved project that cannot be read is skipped and left as it is, never overwritten.

## The rule for changing the format

### Adding something optional: no version bump

Most changes are additions: a new optional field on a line, a new optional part of the project. These do not change `schemaVersion`.

1. Add the field to `src/engine/types.ts` as optional (`name?: type`).
2. Add it to the checker in `src/engine/openProject.ts`, with a default. Use `fill` with a default when the app needs a value, or `may` when leaving it out is fine. A new top-level part goes in the `LOOSE` list with the plain name the person is told if it has to be reset.
3. Make sure every place that reads the field copes with it being absent, since every file saved before your change will not have it.
4. Add tests to `src/engine/openProject.test.ts`: a file without the field opens, and a file with the field in the wrong form opens with the field dropped or defaulted and named in what the person is told.

A file with the new field still opens in an older copy of the app, which keeps the field without understanding it.

Retiring a field works the same way. Leave it in the types with a comment and stop using it, as was done with the report deck's layout options, so that files saved with it still open.

### A breaking change: bump `schemaVersion`, and ship the upgrade with it

A change is breaking when an older copy of the app would read a new file wrongly, or when an old file can no longer be read as it is: renaming or removing a field the core needs, changing what a number means or its unit, or changing the shape of a list.

A breaking change must do all of these in the same pull request:

1. **Bump the number.** Raise `schemaVersion` in `src/engine/types.ts` and wherever a new project is made (the two places in `src/data/seed.ts`).
2. **Ship an upgrade step.** Write a function that takes a project in the old shape and returns it in the new shape, and run it inside the open path before the checks for the new shape. It works on the project in memory. It must not change what it was given, and it never touches the file on disk.
3. **Chain the steps.** When there is more than one, a version 1 file is upgraded to 2, then 2 to 3, and so on, so each step only has to know the shape just before it.
4. **Keep the refusal for newer files.** `checkProject()` must still refuse any `schemaVersion` above the one it knows.
5. **Test with a saved fixture of the old shape.** Before changing anything, save a real file in the old shape into `tools/fixtures/` (the sample film, never a real project). Tests must open that fixture and show that it comes out in the new shape with the same money: the same budget total, the same points, the same schedule.
6. **Say so.** The changelog entry says in plain words that older files are brought up to date when they are opened, and that the file on disk is not changed until the person saves.

### There is no upgrade step yet

The format has not had a breaking change, so there is no upgrade step in the code and `checkProject()` accepts exactly one version, `1`. The first breaking change adds the first step, following the rule above.

One thing in the code is close to an upgrade step and is worth reading as a model: `unbakeDerived()` in `src/engine/deal.ts`. Projects saved before the deal layer existed carry some of the deal's own lines inside the raw budget. When such a project is opened, that function takes those lines back out in memory so the deal can rebuild them. It did not need a new `schemaVersion`, because the old lines can be recognised by their identifiers.
