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
  photos: [assetId],                // first one is the hero image
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
- `localStorage["bourdain"]` is a full mirror, used only when `/api/state` fails
  at startup. Once the server is reachable again the app reloads from it.
- Photo uploads are **not** queued. They need the server at the moment you add them.
- `store.ask(prompt, images)` — proxied Claude call, returns parsed JSON
- `store.fetchUrl(url)` — server-side page fetch
- `store.uploadPhoto(blob)` — returns `{id}`

**The Anthropic API key lives only on the server.** It must never appear in
`index.html` or any client-visible file.

## Deploy loop

GitHub Actions builds the image on push to `main` and publishes it to
`ghcr.io/<user>/bourdain:latest`. TrueNAS pulls it.

1. Push to `main`
2. Wait for the green tick in the Actions tab
3. TrueNAS → Apps → bourdain → ⋮ → **Redeploy**. This only pulls the new image
   because the app YAML sets `pull_policy: always`.
4. Hard-refresh on the phone

To confirm what's running, in TrueNAS → System → Shell:
`sudo docker inspect bourdain --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`
prints the commit SHA the running container was built from.

Data lives on mounted datasets, so redeploys never touch recipes or photos.
Take a ZFS snapshot before anything that changes stored data.

## Gotchas — all of these cost real debugging time

**Bump the service worker cache on any front-end change.** `CACHE = "bourdain-v1"`
in `public/sw.js` → `v2`, `v3`. Forget this and the phone keeps serving the old
app after a redeploy, which looks exactly like a broken build.

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
filtering — whatever is in the database is shown. Removing the last meal from a plan day writes
`{date, entries: []}` rather than deleting the row. Earlier, pre-repo versions
may have written `{deleted: true}` rows; the current code does not filter them,
and an untitled recipe crashes the Plan picker (`pickRecipe` calls
`title.localeCompare`).

**Adding a collection needs server edits too.** In `server.js`: add it to
`COLLECTIONS` (or writes get a 404), add a `CREATE TABLE` (or writes fail with
a 500), and add it to the `/api/state` response. In `index.html`: add it to
`state` and to both branches of `store.init()` and to `store.local()`.

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
grey tiers, NYT slate blue `#326891` as the only accent, red for destructive
actions only.

**Light mode is forced.** The dark palette was removed and `color-scheme: light`
is pinned, because the app looked wrong following the phone's dark setting.
Do not reintroduce `prefers-color-scheme` without being asked.

Everything is driven by CSS custom properties on `:root`. Change colours there,
never inline.

## Conventions

- Mobile first. It is used on a phone, standing in a kitchen. Tap targets ≥ 44px.
- Plain DOM. No React, no jQuery, no state library.
- Patterns already in the file: `render()` dispatches by `state.view`;
  `esc()` on every interpolated string; `toast()` for feedback;
  `openSheet`/`sheetActions` for modals.
- Errors get a specific, human message that says what to do next. Not "an error
  occurred". Look at how the import statuses are worded and match that register.
- `fmtQty()` renders fractions as ½ / ¼ / ¾ rather than decimals.

## Current state

Four tabs: Recipes, Plan, Pantry, Import. The Shop tab was removed but all its
code (`buildList`, `renderShop`, the `shop` collection) is intact and hidden —
restoring it is adding the tab button back and changing `.tabs`
`grid-template-columns:repeat(4,1fr)` to `repeat(5,1fr)`.

Live features: link fetch and AI import with review screen, screen-recording
frame extraction, recipe photos, drag-to-reorder ingredients in the edit form,
0.5×–10× batch multiplier, week planner, pantry with "cook from what I have".

Ideas not yet built: nutrition estimates, pantry quantities decremented by
cooking, a cooking mode with timers, restoring the shopping list.

## Known gaps

Found in a review on 2026-09-24 and not yet fixed. Remove each line once it
is fixed.

- **No loading state or client timeouts.** The app renders the empty "Nothing
  in the book yet" screen until `/api/state` returns, however long that takes.
- **Import "Stop" does nothing.** `parseCtl` is never passed to `fetch`.
- **The build ignores the lockfile.** The Dockerfile copies only
  `package.json` and runs `npm install`, not `npm ci`.
- **`index.html` and `sw.js` are served with `maxAge: 1h`**, so a phone can
  keep the old app for up to an hour after a redeploy, even after a cache bump.
- **The server has no error handler of its own.** Synchronous errors return
  Express's HTML 500. One corrupt row makes `/api/state` fail, and the client
  then reports "Server unreachable".
