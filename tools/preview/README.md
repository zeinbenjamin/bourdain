# Bourdain preview (in Claude)

The real front end (`public/index.html`) running inside a Claude artifact, on demo
data, so Zein can try a change in the Claude app before it's built for the NAS.

Live at **https://claude.ai/artifact/GXP3kbY5VKKrM2dKU3WEAo** (private to Zein).

## What's in it

- `build.mjs` copies `index.html`, takes out what an artifact can't have (the service
  worker, the manifest, its own `<html>`/`<head>`/`<body>`), points pictures at files
  published beside the page, and puts `mock.js` in front of the app's own script.
  It stops with an error if `index.html` no longer has something it replaces.
- `mock.js` answers every `/api/...` request in the page: the four collections, `/api/me`,
  people, the feed, search, copies and photo uploads are kept in `localStorage` on the
  device; link fetches, AI jobs and covers give canned answers after a short wait.
  It seeds a demo book (Zein's own recipes and covers) and two made-up friends, Sam and Alex.
  `#reset` on the link starts the demo over.
- The demo user is the owner, so the owner's view opens (long press on the version
  sheet's heading). Its answers come from `admin.json`, captured from a real test server by
  `node tools/preview/capture-admin.mjs` (re-run it when the owner's view changes), with
  the demo people and made-up visitor numbers swapped in by `mock.js`.
- `covers/` are the demo covers, given fixed 32-hex ids so `photoUrl()`/`coverUrl()`
  accept them.

Not in the preview: real data, real AI, Export, changes in the owner's view (limits and
pausing answer OK but nothing is kept),
offline (no service worker), and Web Share (Share list copies instead).

## Building and publishing

```sh
node tools/preview/build.mjs <out dir> [<repo or worktree to build from>] [--as 2.8.0] [--note "Slide along the tab bar"]…
```

`--as` is the version the preview is heading for (shown as "2.8.0 preview"; without it,
the version in `package.json`). Each `--note` becomes a line of a "2.8.0 preview" entry at
the top of the version sheet's history, so it says what's in the preview to try.

Then publish `<out dir>/index.html` with the Artifact tool to the URL above, with
`root: <out dir>` and `files` from `<out dir>/files.json`, and a `label` saying what's in
it. From a new session, read the artifact first (`action: "read"`), as the tool requires.

`npm test -- preview` checks that it still builds from today's `index.html` and that the
app runs in it without anything reaching a server.

The pilot never sees it: the Docker image copies only `server.js`, `public/` and the
package files.
