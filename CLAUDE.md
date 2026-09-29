# Bourdain

A self-hosted cooking app: import recipes from links, screenshots or screen
recordings, plan the week, track the pantry. Single user, runs on a TrueNAS
SCALE box at home. Built for Zein; no one else uses it.

## Architecture

One Node process serves everything. No build step, no framework, no bundler.

```
server.js              Express — static files, data API, Claude proxy, link fetcher
public/index.html      The entire front end: markup, CSS and JS in one file
public/sw.js           Service worker (offline shell + photo cache)
/data/bourdain.db      SQLite, on a mounted NAS dataset
/data/photos/          JPEGs, on a mounted NAS dataset
```

**The front end is deliberately one file.** It is ~1000 lines and that is fine.
Do not split it into modules, add a bundler, or introduce a framework without
being asked — the no-build-step property is what makes deploys trivial.

### Data model

Four collections, each stored as JSON blobs keyed by id: `recipes`, `plan`,
`pantry`, `shop`. The server does not validate their shape; the client owns it.

A recipe:

```js
{
  title, description, servings, prep_min, cook_min, notes,
  source_url, source_type,          // web | instagram | tiktok | youtube | manual
  photos: [assetId],                // first one is the hero image, unless there's a cover
  cover: assetId,                   // optional AI illustration, served from /api/covers/:id (WebP)
  rating: 0|1|2|3,                  // optional Michelin-style stars; 0 = rated "no stars", missing = not rated
  cooks: [{date, at, mult}],        // one per finished cook: local ISO date, timestamp, batch multiplier
  tags: [string],
  ingredients: [{
    raw_text,                       // the line as originally written, kept for re-parsing
    quantity, unit, item,           // item is canonical + lowercase: "chicken breast"
    prep, section, aisle, optional
  }],
  steps: [string],
  created_at, updated_at
}
```

Splitting ingredients into `quantity` / `unit` / `item` at import time is what
makes shopping-list merging and pantry matching possible. Keep `raw_text`
always — it is the fallback if parsing logic improves later.

`plan` is keyed by ISO date (`2026-09-28`) holding `{date, entries: [{recipeId,
servings}]}`. `shop` is keyed by week-start date. `pantry` is keyed by item id.

### Client/server boundary

Everything goes through the `store` object in `index.html`. If you are changing
how data persists, that is the only place to touch.

- `store.put(col, id, doc)` / `store.del(col, id)` — writes. Each one goes into
  a persistent **outbox** (`localStorage["bourdain.outbox"]`) and leaves it only
  once the server accepts it. They resolve `true` when the server has the change
  and `false` when it is waiting on this device; `store` toasts the "waiting"
  case itself, so callers only toast success, and only when the result is `true`.
  Never toast "Saved" unconditionally after a write.
- Sync: `store.flush()` sends the outbox in order, retrying on the `online`
  event, when the app comes back to the foreground, and every 30s while anything
  is pending. On load, unsynced outbox entries are laid over the server's data,
  so local changes win (last write wins, which is fine for one person). A 4xx
  means the server will never accept that change, so it is dropped with a toast.
  The header shows "N changes not synced" or "Offline".
- `localStorage["bourdain"]` is a full mirror, refreshed on every successful
  load. `store.loadLocal()` renders it immediately at startup; `store.init()`
  then replaces it with the server's data, or keeps it if the server can't be
  reached. `store.loading` is true until that finishes. Empty states must check
  it, so a new phone shows "Loading…" rather than "Nothing in the book yet".
  After the first load, boot skips re-rendering an import form in progress.
- Photos added while the server is unreachable go into `photoQueue` (IndexedDB
  `bourdain-photos`, because localStorage is too small for images) under a
  `local-…` id, and are displayed from a blob URL. `photoUrl()` handles both
  kinds of id. `store.flush()` runs `photoQueue.flush()` **first**: it uploads
  each photo, swaps the id in every recipe and any open draft, and queues the
  recipe writes with `store.enqueue()`. It must not use `store.put()`, which
  awaits `flush()` and would wait on itself. A queued photo that no recipe or
  draft uses (a discarded draft) is not counted as unsynced and is dropped after
  10 minutes. A 4xx or `image_failed` from the server removes the photo rather
  than retrying it forever.
- `store.ask(prompt, images, signal)` — proxied Claude call, returns parsed JSON.
  Aborting `signal` cancels it; the server then aborts its upstream call too.
- `store.fetchUrl(url)` — server-side page fetch
- `store.uploadPhoto(blob)` — returns `{id}`
- `makeCover(recipe, onDone)` — POSTs to `/api/cover` and calls `onDone(coverId)`.
  It runs in a sheet with Stop. If the sheet is dismissed it finishes in the
  background, so `onDone` must re-resolve its target. See `applyCover` and
  `state.reviewCollect`.

**Cook sessions live only on the phone.** `cooking` in `index.html` keeps the
single in-progress cook in `localStorage["bourdain.cooking"]` as
`{recipeId, mult, started, ing:[index], steps:[index], timers:[{id, label, secs, ends, done}]}`, so ticking is instant,
works offline and survives reloads. Nothing is written to the server until
**Finished cooking**, which appends to `recipe.cooks` (and sets `rating` if one
was picked) with a normal `store.put`. The cooking screen (`state.view ===
"cook"`, `renderCook`) toggles ticks in place instead of re-rendering, so the
page never jumps while you cook. `wake` holds a Screen Wake Lock while it's open
and releases it in `show()` for any other view.

**Cook timers** (`timers`, `parseDurations`) turn durations in a step's text
into timer buttons. Handled: "8-10 mins" (starts at the lower number),
"1 hour 30 minutes", "1½ hours", "30 seconds". A timer stores its `ends`
timestamp, not a countdown, so it stays correct across reloads and sleep. A 1s
ticker runs only while a timer is live, and `timers.tick()` also runs on boot
and whenever the app becomes visible again. On expiry: a "Time's up" sheet,
`navigator.vibrate` and three Web Audio beeps. Browsers allow sound only after
a tap and forget that on reload, so a capture-phase `pointerdown` listener calls
`timers.unlock()` whenever a cook is in progress. There are no background
notifications; the wake lock keeps the screen on in cook mode instead.

**Plan tab** (`renderPlan`): each day row has a round "+" (`.addslot`, `data-add`)
on the right that opens the recipe picker. When the week shown is the current one,
`.weeknav` gets `current`: the date range turns `--flame` and "(this week)" shows
under it. The note keeps its space on other weeks, so the days don't jump. A planned meal
(`.slot`) shows `miniThumb(r)` (the recipe card's picture rule at 40px: cover whole
on white, else first photo cropped, else the first letter), then the title, which
wraps in full rather than truncating. Servings are not shown on the row; tapping
the meal opens `slotSheet`, where they're changed.

**Adding a recipe** (`addSheet`): the Recipes "+" (and the empty book's button)
opens a sheet: **Import a recipe** (the import form, with "‹ Recipes" to go back)
or **Write one yourself** (a blank review form; `state.draftManual` makes its Back
return to the list rather than the import form). If an import or new recipe is
open and unsaved, the sheet first offers **Carry on with "…"**, and the other two
say they replace it. The review form is headed "New recipe" either way (or "Edit
recipe" for an existing one), with one neutral hint to check it before saving, so
it reads the same after an import as when writing from scratch. Tests reach both through `addRecipe(page, "import"|"manual")`
in `tests/lib.mjs`.

**Buttons that are easy to hit.** Every `.detail-head` button (Back, Edit,
Delete, Cancel, Save) is 44px tall at one text size. The recipe page's four
actions sit in a 2×2 grid (`.actions.quad`) so none wraps onto a line alone.
Photo and screenshot × buttons are 44px tap areas with the small dark circle
drawn by the `<span>` inside.

**Edit form ingredients** (`renderReview`, `.ingrow`): each ingredient is a grey
`--steel` card with a border and 10px between cards, white inputs inside, the
⋮⋮ drag handle on the left and a 44px × on the right.

**Archives tab** (`renderTimeline`, `timelineEntries`): named for Bourdain's
"the archives". It was called Timeline until 1.10.0 and is still `timeline`
inside (`state.view`, `data-view`, `#view-timeline`, the test suite); only the
words on screen changed. Stats (cooks this month,
this year, recipes tried out of all), **Most cooked** (top 3 cooked more than once;
ties go to the most recently cooked), then every finished cook newest first,
under month headings (the year is added for past years) and grouped by day in the
Plan's day-row style. Nothing is stored for it: it is read from each recipe's
`cooks`, so deleting a recipe or removing a date in its cook log takes those
cooks off the Archives. A recipe opened from here sets `state.detailFrom =
"timeline"`, so its Back says "‹ Archives" and the Archives tab stays lit;
`show()` clears it for any other view. Each entry has `who: "me"`, a placeholder
for the shared feed planned with multi-user (see **Pinned for v2**).

**Recipe list sort and filter** (`listPrefs`, `sortRecipes`, `keepRecipe`)
are remembered per phone in `localStorage["bourdain.listPrefs"]`. A saved sort or
filter that is no longer an option falls back to the default in `listPrefs.get()`. A recipe card
reads top to bottom: title, a `.cstars` row with the Michelin stars (omitted
entirely when the recipe has none), the `.meta` row (time · serves · source), and
tags. Cards deliberately don't show the cook count; that is only on the recipe
page.

**The Anthropic and OpenAI API keys live only on the server.** Neither may appear
in `index.html` or any client-visible file.

## Testing

`npm test` runs every suite in `tests/` (about 2 minutes). `node tests/<name>.test.mjs`
runs one, and `npm test -- scan` runs those whose name starts with "scan".
**Run it before every push that touches the app, and add checks for anything you
change.** Each suite starts the real `server.js` on its own port with a
throwaway data dir, and drives the real app in headless Chromium (Playwright,
a pinned dev dependency; `npm ci --omit=dev` keeps it out of the image).

- `tests/lib.mjs`: `startServer` (stop/restart to fake the server going
  down), `slowProxy` (fake slow Wi-Fi), `openBrowser`, and the `suite`
  PASS/FAIL collector.
- `tests/mock-apis.mjs`: fake Claude and OpenAI, loaded with `--import`. It is
  driven per call by `setMode({claude, image, scan, claudeDelay, imageDelay})`
  and logs what was sent (`MOCK_CLAUDE_REQ`, `MOCK_IMG_REQ`, `MOCK_SCAN`).
  Nothing in the tests calls a real API or needs a key.
- Suites: `server` (headers, errors, codes, cover pipeline, sweep), `offline`
  (outbox and photo queue across server outages), `loading` (slow Wi-Fi, Stop,
  version sheet), `covers` (cover UI, import errors, shrinking), `review`
  (edit form: description, double-tap Save), `cook` (cook mode, ratings,
  cook log), `timers` (fake clock via `page.clock`), `list` (sort, filter,
  cards), `layout` (measured gaps and tap targets at phone width), `add` (the
  "+" sheet, import vs write your own, carrying on with an unsaved draft),
  `timeline` (the Archives tab: stats, most cooked, the feed, back navigation), `scan`,
  `video`.
- `slowProxy` delays: `shell` (index.html), `state` (`/api/state`), `write`
  (PUT/DELETE).

Timing checks (for example "shows in about 3s") have some slack but assume an
unloaded machine.

## Deploy loop

GitHub Actions builds the image on push to `main` and publishes it to
`ghcr.io/<user>/bourdain:latest`. TrueNAS pulls it.

1. Push to `main`
2. Wait for the green tick in the Actions tab
3. TrueNAS → Apps → bourdain → ⋮ → **Redeploy**. This only pulls the new image
   because the app YAML sets `pull_policy: always`.
4. Open the app on the phone and tap the **Bourdain** title. The sheet shows the
   version and build the phone is running, and says whether the server has a
   newer one.

If the app itself won't load, the server-side check is TrueNAS → System → Shell:
`sudo docker inspect bourdain --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`
prints the commit SHA the running container was built from.

## Releases

Every change that ships to the app gets a new version. Docs-only changes don't.

1. Bump the version with `npm version <x.y.z> --no-git-tag-version`. This
   updates `package.json` and `package-lock.json` together.
   - **Patch** (1.3.0 → 1.3.1): fixes, no new behaviour.
   - **Minor** (1.3.0 → 1.4.0): new features or changed behaviour.
   - **Major** (1.x → 2.0.0): a change to stored data that needs a migration.
2. Add an entry at the top of `CHANGELOG.md`: `## x.y.z — YYYY-MM-DD` followed by
   `- ` bullets. The server parses exactly that format for the in-app history.
   Write the bullets for Zein, not for a developer: what's different when using
   the app.
3. Bump the service worker cache as usual if the front end changed.

How the version reaches the phone: `server.js` reads the version from
`package.json`, the commit from `APP_COMMIT` (set by the Actions build), and
stamps both into the `app-version` / `app-commit` meta tags as it serves
`index.html`. The app compares its own tags with `/api/version`. On startup it
toasts when the server has a newer build, and the version sheet shows the same.
Serve `index.html` only through `sendIndex` in `server.js`, never as a plain
static file, or the placeholders reach the phone unfilled.

Data lives on mounted datasets, so redeploys never touch recipes or photos.
Take a ZFS snapshot before anything that changes stored data.

## Gotchas — all of these cost real debugging time

**Bump the service worker cache on any front-end change.** `CACHE = "bourdain-v23"`
in `public/sw.js` → `v24`, `v25`. This makes the phone install the new worker and
drop the old cache. `index.html` and `sw.js` are served with
`Cache-Control: no-cache`, so the new shell arrives on the next open. Keep it
that way: a long `maxAge` on either one means the phone keeps the old app after
a redeploy, which looks exactly like a broken build. The service worker is
network-first but falls back to its cached shell after `SLOW_MS` (3s), so on a
slow connection a new deploy can take one extra open to appear.

**Dependencies are pinned by `package-lock.json`.** The Dockerfile runs `npm ci`,
which installs exactly what the lockfile says and fails if it doesn't match
`package.json`. When adding or upgrading a dependency, run `npm install` locally
and commit the updated lockfile, or the Actions build fails.

**The container must run as UID 568.** TrueNAS datasets with "app permissions"
are owned by the `apps` user (568), not node's default 1000. The Dockerfile
runs as `node` (1000), so the app YAML in TrueNAS must set `user: "568:568"`.
Without it the container crash-loops on SQLite open. The repo's
`docker-compose.yml` has it.

**Redeploy needs `pull_policy: always`.** Without it TrueNAS restarts the image
it already has, and the new build never arrives. That looks exactly like a
deploy that didn't work, the same as a forgotten service worker bump.

**`docker-compose.yml` mirrors the live TrueNAS YAML**, with the pool path and
API key replaced by placeholders. If you change the YAML in TrueNAS, change this
file to match. The live setup uses datasets under `/mnt/sonic/builds_/bourdain/`.

**No `confirm()` or `alert()`.** The app runs in a sandboxed frame in some
contexts where those are silently blocked and return false — a delete button
that appears to do nothing. Use the bottom-sheet pattern (`openSheet` +
`sheetActions`) instead.

**Sheets must not keep stale handlers.** `openSheet()` clones a fresh element on
every open precisely because an earlier version attached listeners that survived
into the next sheet and swallowed its clicks. Route every sheet button through
`data-act` + `sheetActions()`. Never attach ad-hoc `onclick` to sheet contents.

**Deletes are queued like any other write, and there are no tombstones.** A
delete is an outbox entry with `doc: null`. It is replayed over server data on
load, so a deleted item stays gone until the DELETE lands. Loading does no other
filtering — whatever is in the database is shown. Removing the last meal from a
plan day writes `{date, entries: []}` rather than deleting the row. The live
database was checked on 2026-09-24 and has no `{deleted: true}` rows from the
pre-repo versions. Code that reads recipes should still treat `title` as
possibly missing.

**Adding a collection needs server edits too.** In `server.js`: add it to
`COLLECTIONS` (or writes get a 404), add a `CREATE TABLE` (or writes fail with
a 500), and add it to the `/api/state` response. In `index.html`: add it to
`state` and to both branches of `store.init()` and to `store.local()`.

**Upstream failures have specific codes, and the client has one message table.**
`callClaude()` and `paintCover()` in `server.js` throw `UpstreamError` with codes
such as `bad_api_key`, `no_credit`, `model_unavailable`, `overloaded`,
`truncated`, `refused`, `image_rejected`, `no_image_key` and `image_refused`.
Some carry a short `detail` from the provider. `aiError(e)` in `index.html` maps
every code to a message saying what to do next. When you add a code, add its
message there. Don't add another "try again" branch at a call site.

**Server errors are JSON with a `code`.** Every `/api` failure goes through the
error handler at the bottom of `server.js`, which maps it to
`{error, code}`: `bad_json`, `too_large`, `db_readonly`, `disk_full`,
`db_busy`, `not_found` or `server_error`. Unknown `/api` paths get a JSON 404
rather than `index.html`. Add a new case to `describe()` rather than returning an
HTML page, and let the client switch on `code`. `readAll` skips a row it can't
parse and logs `skipping corrupt row <table>/<id>`, so one bad row can't blank
the app.

**Adding fields is safe; renaming is not.** Old recipes simply lack new fields —
treat missing as empty. Renaming an existing field orphans every stored recipe
and needs a migration script plus a snapshot first.

## Import pipeline

Four routes in, most to least reliable:

1. **Recipe site link** — server parses embedded schema.org `Recipe` data, then
   hands that clean text to the model only to structure quantities. Accurate.
2. **TikTok link** — server also hits TikTok's public oEmbed endpoint for the
   caption the page itself hides.
3. **Screenshots** — sent to the model as images.
4. **Screen recording** — the browser samples frames, drops near-duplicates by
   comparing downscaled pixel diffs, and tiles survivors into contact sheets
   (6 per sheet, 4 sheets max). Audio is not transcribed; the model reads
   on-screen text and caption overlays.

Instagram blocks both link routes. Screenshots or a recording are the way in.

**Every import lands on a review screen before saving.** The model misreads
quantities occasionally. Do not add a path that saves straight to the library.

## Design

New York Times palette and typography. Source Serif for headlines and body
(stands in for Imperial), Libre Franklin for all UI furniture — section heads,
meta lines, buttons, tabs, form fields. Pure white ground, `#121212` ink, two
grey tiers, and **Michelin red `#D3072B`** (`--flame`) as the only accent, chosen
by Zein on 2026-09-27 to match the Michelin star. It replaced NYT slate blue.
Destructive actions use `--red` (`#D0021B`), which is nearly the same colour, so
a destructive button must always say what it does ("Delete recipe", "Stop
without saving"), never rely on colour alone.

**Ratings use the real Michelin star**: the six-petal `#mstar` SVG symbol at the
top of `<body>`, drawn with `currentColor`. Render stars only through
`stars(n)`, never with "★" characters. Toasts are plain text, so they say
"Rated 2 Michelin stars".

**Light mode is forced.** The dark palette was removed and `color-scheme: light`
is pinned, because the app looked wrong following the phone's dark setting.
Do not reintroduce `prefers-color-scheme` without being asked.

Everything is driven by CSS custom properties on `:root`. Change colours there,
never inline.

## Conventions

- Mobile first. It is used on a phone, standing in a kitchen. Tap targets ≥ 44px.
  A small glyph like "×" gets a 44px box (a negative margin keeps the glyph where
  it was). No inline `style="margin…"` on layout: it silently beats the
  stylesheet. When you fix spacing, add a measured check to
  `tests/layout.test.mjs`.
- Plain DOM. No React, no jQuery, no state library.
- Patterns already in the file: `render()` dispatches by `state.view`;
  `esc()` on every interpolated string; `toast()` for feedback;
  `openSheet`/`sheetActions` for modals.
- Errors get a specific, human message that says what to do next. Not "an error
  occurred". Look at how the import statuses are worded and match that register.
- `fmtQty()` renders fractions as ½ / ¼ / ¾ rather than decimals.

## Current state

Four tabs: Recipes, Plan, Archives, Pantry. Importing lives behind the Recipes "+" (see
**Adding a recipe** above); the import form is still `state.view === "import"`,
with the Recipes tab highlighted. The Shop tab was removed but all its
code (`buildList`, `renderShop`, the `shop` collection) is intact and hidden —
restoring it is adding the tab button back and changing `.tabs`
`grid-template-columns:repeat(4,1fr)` to `repeat(5,1fr)`. Zein may later move
Pantry behind the Recipes "+" too (as something like "Cook from the pantry").

Live features: link fetch and AI import with review screen, screen-recording
frame extraction, recipe photos, AI cover illustrations (on request), drag-to-reorder ingredients in the edit form,
0.5×–10× batch multiplier, week planner, pantry with "cook from what I have"
and photo scanning, cook mode with a checklist and step timers, Michelin
ratings, a per-recipe cook log, the Archives (every cook, with stats), and sorting
and filtering of the recipe list.

Ideas not yet built: nutrition estimates, pantry quantities decremented by
cooking, timer alerts while the phone is locked (would need push
notifications), restoring the shopping list, and
a cleanup for unused photos (`.jpg`); unused covers are already swept.

## Pinned for v2

Decided 2026-09-24: not now. The most likely trigger for 2.0.0 is **pantry
amounts that go down when you cook**. That needs every pantry item to carry a
real amount in a consistent unit, which old free-text items like "greek
yoghurt" don't have, so existing data must be converted. Other v2-sized ideas:
household sharing (now planned as per-person multi-user; the full design,
agreed 2026-09-29 and not yet built, is in `docs/multi-user.md`), an ingredient catalogue
(every recipe ingredient re-linked), and moving blobs to real columns. Features
that only add fields stay 1.x: cooking mode, shopping list, nutrition, meal
slots, a redesign.

A v2 release needs: a ZFS snapshot first, because a redeploy can't undo a data
conversion; a one-time migration on server start, gated by a stored data
version; and handling for **old-format writes still sitting in a phone's
outbox**. Those arrive after the migration, so the server must convert them or
the client must finish syncing before it switches format.

## Covers

`POST /api/cover` takes the recipe and returns `{id}`. Claude (`describeDish`)
writes one sentence describing the served dish. It is appended to `COVER_STYLE`
(Zein's own prompt, adapted for a transparent background), and OpenAI's
`/v1/images/generations` paints it: `IMAGE_MODEL` (default `gpt-image-2`),
`IMAGE_QUALITY` (default `medium`), 1024×1024, `background: "transparent"`,
PNG. The server sweeps unused covers (`sweepCovers`) at startup and daily. It
deletes a `.webp` only if no recipe's `cover` points at it and it is older than
`COVER_GRACE_DAYS` (7). The grace period covers unsaved drafts and saves still
in a phone's outbox. The sweep is skipped entirely if any recipe row is
unreadable or there are no recipes, since either would make every cover look
unused. It never touches photos (`.jpg`). Transparency is a preview feature on `gpt-image-2`. If OpenAI rejects it,
`paintCover` retries once with an opaque white background, which looks the same
because covers are always shown on `--paper` white. The PNG is stored as WebP
(keeps alpha; the photo pipeline's JPEG would not) in the photos dataset as
`<id>.webp`.

Display rule: a cover is shown whole (`object-fit: contain`) on `--paper`, never
on the grey `--steel` tile and never cropped. That rule is what makes the dish
look like it's floating. The API calls were written against the `openai` npm
package's type definitions (v7.23.0), because OpenAI's docs are blocked from the
dev sandbox. Tests use a fake OpenAI; the first real call happens on the NAS.

## Pantry scan

"Scan fridge or pantry" (`scanPantry` in `index.html`) sends up to `SCAN_MAX`
(6) photos, shrunk by `forReading`, to Claude through `store.ask` with
`SCAN_PROMPT`. There is no new server route, so errors come through `aiError`
like imports. The reply `{items:[{item, qty, unit, aisle, sure}]}` is cleaned
by `tidyScan`: lowercase, de-duplicated, aisle validated. It then goes to a
review sheet. Items with `sure:false` start unticked. Items whose `itemKey`
(crude singular form) matches something already in the pantry are listed as
"already on your list" and are never added. A scan only ever adds; it never
removes pantry items. Photos are not stored. As with imports, nothing is added
without the review step.

## Known gaps

Found in a review on 2026-09-24 and not yet fixed. Remove each line once it
is fixed.

- **`/api/fetch` can reach LAN addresses** (#14). Only matters if the app is ever
  exposed beyond the home network.
