# Security

ProfitShare runs entirely in your browser. There is no server and there are no accounts, so the things worth protecting are on your own computer: the projects saved in your browser, and your Anthropic API key if you have pasted one in.

## What counts

Please report anything that lets:

- a project file, a spreadsheet, a script, a PDF, a font or a picture that someone opens in the app run code;
- a pitch deck sent from the app run code it should not, or load anything from outside itself;
- a saved project, or the person's Anthropic API key, leave the browser without them asking;
- the app fetch from anywhere other than itself, `api.anthropic.com` (when the person presses an AI button with their own key) and the two Google Fonts hosts (after they agree);
- a file crafted to do so freeze or crash the app in a way that loses saved work.

A flaw in one of the packages the app is built with counts too, if it can be reached through the app.

## How to report

Report privately through GitHub: open the repository's **Security** tab and press **Report a vulnerability**. That opens a private report only the maintainer can see.

Please do not open a public issue or pull request for a security problem, and please do not include a real budget or project file. Steps that show the problem on the sample film, or a small invented file, are what help most.

## What to expect

This is a one-person project. Reports are read and answered as soon as the maintainer can. There is no promised response time, and no bug bounty: reports are not paid for. If the report holds up, the fix is made on `main`, which is what the live app is built from, and you can be named in the changelog if you would like to be.

Only the current version on `main` is supported. There are no older versions to patch.

## What is in place

- **A content security policy on the app page.** It allows the app's own files, `api.anthropic.com` and the two Google Fonts hosts, and nothing else: no outside scripts, pictures or frames, and no inline script except the one in the page, which is allowed by its hash. It is written into the page at build time by `tools/csp.mjs`, and the browser walk fails on any violation.
- **A checked reader for project files.** Every project, whether opened from a file or saved in the browser, goes through one checker (`src/engine/openProject.ts`) that refuses what it cannot read with a plain sentence and never runs anything a file carries. Addresses in a file are checked, so a project someone sends you cannot make the app fetch anything.
- **The app's own spreadsheet reader, with limits.** Spreadsheets are read by a small reader written for the app. It stops at 50 MB and 500,000 filled cells, and refuses files built to unpack into something enormous.
- **Sealed decks.** A web deck sent from the app is one file with its own, stricter policy: it loads nothing from outside itself, and it holds only what the deck shows.
- **Your key stays put.** The Anthropic API key is kept in your browser and is never written into a project file or a deck. It is sent only to Anthropic, and only when you press an AI button.
