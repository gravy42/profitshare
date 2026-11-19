# Contributing to ProfitShare

Thank you for looking. ProfitShare is a one-person project built in the open, and issues and pull requests are welcome. This page says how to run it and what a change has to keep true.

Before you start, read the top of [CHANGELOG.md](CHANGELOG.md). It is kept by day, newest first, and says what changed and why.

## Run it

You need Node 22.12 or newer, which is what the workflows run.

```bash
npm ci                 # install exactly what the lockfile says
npm run dev            # the app at http://localhost:5173
npm test               # the unit tests
npx tsc --noEmit -p .  # the type check
npm run format         # Prettier, 120 columns (stylesheets are left alone)
npm run build          # the static site, in dist/
```

The browser walk opens the built app and a sent deck in a real browser and clicks through every tab:

```bash
npx playwright install chromium   # once
npm run build
npm run browsers                  # or BROWSER=webkit, BROWSER=firefox
```

It prints one line per step and writes screenshots to `browsers-out/`.

## The rules that matter

- **An engine change needs a test.** Everything under `src/engine/` is plain TypeScript with tests beside it. If you change how a number is worked out, add or change a test that shows it.
- **The sample must still add up.** The sample film, *Salt Flat*, totals **$805,312.06**, and the tests fail if it does not. It must also still go out and come back through the importers unchanged. If your change is meant to move that total, say so in the pull request and explain why.
- **Only invented names and content.** No real people, real budgets, real scripts or real photos, in code, tests, fixtures or screenshots. The sample film and people such as "Ada Example" are there to be used.
- **No dependency of unclear licence.** Prefer what is already installed. If you do need a new package, name its licence in the pull request.
- **The app fetches nothing new from the network.** Today it contacts `api.anthropic.com` when a person presses an AI button with their own key, and Google Fonts after they agree, and nothing else. The content security policy in `tools/csp.mjs` enforces this, and the walk fails on any violation. Tests never call a live AI model.
- **Plain English.** Words on screen are for a filmmaker, so no programmer terms, no hype and no em-dashes. Use commas, colons and full stops. The app uses British spelling ("colour") and sentence case. Say what a thing does.
- **Accessibility is checked.** Every field and button needs a name a screen reader can say, nothing pressable is smaller than 24px, and no tab may scroll the page sideways on a phone. The walk fails on a field or button with no name, on a tab that scrolls sideways, and on money that wraps in a table at phone width. The 24px rule is checked by eye.
- **Rates and legal wording need a source.** A rate, a cap, a date or a sentence about what a rule says must come with where it was published and the date you checked it, in a comment beside the figure. [docs/rates.md](docs/rates.md) lists where they all live.
- **The project file stays readable.** If you add to what a project holds, follow [docs/file-format.md](docs/file-format.md).
- **CHANGELOG is kept by day.** Add a bullet under today's date, with a bold lead-in and plain sentences that say what changed for the person using the app.

Code comments explain why, in plain words, like the ones already there. Please do not reformat code you are not changing.

## How a pull request is checked

Two workflows run on every pull request:

- **Tests** runs the type check and the unit tests.
- **Browsers** builds the app and walks it in Safari's engine (WebKit), Firefox and Chromium.

Four checks must pass before anything is merged into `main`:

1. Unit tests and type check
2. chromium on ubuntu-latest
3. firefox on ubuntu-latest
4. webkit on macos-latest

The Browsers workflow also walks WebKit on Linux and tries the Google Fonts picker against the real Google Fonts. Those two are there to be read when they fail and do not block a merge.

## Bugs, ideas and security

- A bug or an idea: open an issue. The forms ask for what is useful. Please do not attach a real budget or project file. Show the problem on the sample film.
- A security problem: do not open a public issue. See [SECURITY.md](SECURITY.md).
- Everyone taking part is asked to follow the [code of conduct](CODE_OF_CONDUCT.md).

By contributing you agree that your work is released under the project's [MIT licence](LICENSE).
