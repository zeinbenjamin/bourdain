# Multi-user (2.0) — design

Status: **agreed, not built.** Written 2026-09-29 from Zein's decisions. Nothing
here exists in the code yet. Update this file as stages ship, and move the parts
that become true into CLAUDE.md.

## Why

Up to five pilot users, reached from outside the home network, each with their
own book. Zein's existing data becomes Zein's profile. The Archives becomes a
feed of who cooked what.

## Decisions (Zein, 2026-09-29)

| # | Question | Decision |
|---|---|---|
| 1 | Who sees whose recipes? | Everyone in the group can browse everyone's recipes. Your own list only ever shows yours. |
| 2 | Archives | Everyone's cooks by default, with a "Just me" filter. The stats at the top stay personal. |
| 3 | Ratings | Each copy has its own rating, set by its owner. Nobody's rating shows on anyone else's copy. |
| 4 | Profiles | Display name and photo. No photo shows the initial. |
| 5 | Admin | A screen only Zein can open, not signposted in the UI. It tracks activity and AI usage. No need to remove people from it; Cloudflare's list does that. |
| 6 | Existing history | All of it becomes Zein's and shows as "You cooked…". |
| 7 | Household or person? | **Per person.** Zein's profile is Zein alone. |
| — | Getting in | Cloudflare Tunnel + Cloudflare Access on Zein's own domain. Pilot users install nothing: they open a link and enter an emailed one-time code. |

## How it works for the user

- **My recipes** (Recipes tab) show only recipes I own. Nothing another person
  adds ever appears there.
- **People.** The Archives tab gets a row of avatars (photo or initial) at the
  top. Tapping one opens that person's profile: their recipes as read-only
  cards, and their cooks.
- **Search across everyone's books** (added 2026-09-29). Typing in the Recipes
  search box still filters my own recipes as now. Underneath, a second section,
  **In other people's books**, lists matches from everyone else's recipes.
  - It matches the same fields as my own search: title, description, tags and
    ingredients.
  - Each result is a normal recipe card plus the owner's photo or initial and
    name ("Sam's"), with the owner's stars.
  - Tapping one opens the read-only recipe with **Add to my recipes**. A recipe
    I've already copied is marked **In your recipes**.
  - The section appears once 2 or more letters are typed, waits for a short
    pause in typing (about 300 ms) before asking the server, and shows the 20
    best matches.
  - The tag chips, sort and filter apply only to my own recipes, since they
    describe my book.
  - Offline, or when the server can't be reached, the section is hidden rather
    than showing an error. My own results still work from the phone's copy.
- **Someone else's recipe** opens read-only. It has no Edit, Delete, Cook this
  or Add to the week. Its one action is **Add to my recipes**.
- **Add to my recipes** makes my own copy:
  - The title, ingredients, steps, notes, tags, photos and cover are copied.
    Photos and covers are shared by id, not duplicated.
  - Rating and cook log start empty, because they're mine now.
  - The copy keeps `copied_from` and shows "From Sam's recipes" on its page.
  - Their later edits don't change my copy, and mine don't change theirs.
  - If I already have a copy, the button reads **In your recipes** and opens it.
  - After copying I land on my copy, so I can cook it, plan it or edit it.
- **Archives feed.** "You cooked Leek soup", "Sam cooked Katsu curry", grouped
  by day as now, each with that person's avatar and that owner's stars.
  - A filter at the top switches between **Everyone** and **Just me**.
  - Stats (this month, this year, recipes tried, most cooked) are always mine.
- **Plan, Pantry and Shop** are private. Nobody else sees them.
- **First sign-in.** A pilot user sees "Welcome to Bourdain. What should we
  call you?" with an optional photo, then an empty book with the usual "+" to
  import or write a recipe.
- **My profile.** Tapping the Bourdain title opens the version sheet, which
  gets an **Edit profile** row for changing name and photo.

## Data model

### Who is who

`users` table: `id` (short random), `email` (unique, lowercase), `name`,
`photo` (asset id, optional), `is_admin`, `created_at`, `last_seen`.

- A user row is created the first time a new email signs in.
- Zein's row is created by the migration from `OWNER_EMAIL` and is the only one
  with `is_admin = 1`.

### Every row gets an owner

The four collection tables change from `(id, doc, updated_at)` to
`(owner, id, doc, updated_at)` with `PRIMARY KEY (owner, id)`.

- This is what fixes the plan: plan rows are keyed by date, so Zein's
  2026-10-06 and Sam's 2026-10-06 must be different rows.
- **The server always sets `owner` from the signed-in user.** The phone never
  sends it and can't choose it. A write can only ever touch the writer's own
  rows.
- Old recipes still lack new fields, as today. New recipe fields:
  `copied_from: {owner, id, title, name}` (who it came from, for the "From Sam's
  recipes" line).

### Cooks don't need a "who"

A cook is logged on a recipe, and the recipe has an owner, so the owner is the
cook. Sam cooking a copy of Zein's soup logs the cook on Sam's copy. The earlier
CLAUDE.md note that each `cooks` entry needs a `by` field is dropped.

### Usage and activity

- `ai_usage`:
  - Columns: `user, at, kind, model, input_tokens, output_tokens, images,
    est_cost_usd, outcome`.
  - `kind` is one of `import`, `scan`, `ideas`, `write`, `cover`.
  - `outcome` is `ok`, `limit`, or an error code.
- `activity`:
  - Columns: `user, at, action, target`.
  - `action` is one of `signed_in`, `recipe_added`, `recipe_edited`,
    `recipe_deleted`, `recipe_copied`, `cook_logged`, `plan_changed`,
    `pantry_changed`.
  - `target` is the recipe title or date.
  - One row per server-accepted write. It records what happened and when, not
    full contents.
- `settings`: key/value store for the AI limits (below), editable in the admin
  screen.
- `meta`: `data_version` (1 today, 2 after the migration).

## Signing in

**Cloudflare Access** sits in front of the app. Only the listed emails get past
Cloudflare's login; everyone else never reaches the NAS.

- For each request, Cloudflare adds a signed token (`Cf-Access-Jwt-Assertion`)
  naming the email. The server:
  - verifies the token's signature against the team's public keys;
  - checks it is meant for this app (the audience tag);
  - reads the email.

  Settings: `CF_ACCESS_TEAM` and `CF_ACCESS_AUD`. The server never trusts a
  plain email header.
- **Until 2.3 (built in 2.0.0): single-user.** Every request is Zein. Anything
  that arrives through Cloudflare (a `Cf-Ray`, `Cf-Connecting-Ip` or
  `Cf-Access-Jwt-Assertion` header) is refused with 403 `cf_not_set_up`, so a
  public hostname added to the tunnel too early shows "can't be opened from this
  address yet", never the recipes. `/api/health` and `/api/version` stay open,
  since they hold no data.
- **From 2.3: Zein at home.** Cloudflare's token always wins when present.
  Requests with no token are allowed only from trusted networks (`TRUSTED_NETS`,
  e.g. `192.168.1.0/24` and Tailscale's `100.64.0.0/10`), and those requests are
  Zein. Anything else without a valid token gets 401.
  - Zein's `cloudflared` already runs for the media server, and it reaches the
    app through the NAS's own address. **The NAS's own address and the Docker
    network must never be in `TRUSTED_NETS`**, or tunnel traffic would count
    as Zein.
  - **Verify on the NAS before relying on it:** which address the app sees for
    a request from the phone, and which it sees for a request through
    `cloudflared`.
    - If Docker hides the real address (every request appears to come from the
      Docker gateway), this fallback is unsafe. Zein then uses only the
      Cloudflare address.
    - `cloudflared` runs in its own container on the Docker network, which must
      not be in `TRUSTED_NETS`.
- **Signed-out mid-session.** When the Cloudflare login expires, API calls get
  redirected to Cloudflare's login page instead of returning JSON.
  - The app spots the redirect (or an HTML reply) and shows **"Signed out. Tap
    to sign in again"**, which reloads the page so Cloudflare can prompt.
  - Waiting changes stay in the outbox and sync after signing in.
  - This must never read as "Offline" or drop anything.
- `GET /api/me` returns `{id, name, photo, is_admin}`. The app calls it at
  startup.

## API changes

| Route | Change |
|---|---|
| `GET /api/state` | Only the caller's rows. |
| `PUT` / `DELETE /api/:col/:id` | Scoped to the caller's own rows. |
| `GET /api/me`, `PUT /api/me` | Read, or set name and photo. |
| `GET /api/people` | Everyone's `{id, name, photo}`. |
| `GET /api/people/:id/recipes` | That person's recipes, read-only. |
| `GET /api/search?q=…` | Recipes from everyone **except** the caller matching `q` in title, description, tags or ingredients. Returns up to 20 `{owner, name, photo, id, title, cover, firstPhoto, rating, copied}`, with title matches first. `copied` is true when the caller already has a copy (`copied_from` points at it). Needs 2 or more characters. |
| `POST /api/copy` | `{owner, id}` → new recipe owned by the caller, returns its id. |
| `GET /api/feed?before=…` | Cooks from everyone, newest first, paged: `{who, recipeId, owner, title, date, mult, rating}`. |
| `GET /api/export` | The caller's data as JSON plus their photos, as one zip. |
| `/api/admin/*` | 403 unless `is_admin`. |
| `POST /api/ai` | Replaces `/api/claude`. See below. |

## AI limits per person

Today `/api/claude` sends Claude **whatever prompt the phone gives it**. With
outside users, anyone signed in could use it as free, general-purpose Claude on
Zein's key. The console spend limits stop a disaster, but they're one pot for
everyone. One person could use it all up, and they don't say who spent what.

### 1. Only the app's own jobs are allowed

`/api/claude` becomes `POST /api/ai` with `{kind, material, images}`, where
`kind` is `import | scan | ideas | write`.

- The **prompts move into `server.js`**: `PARSE_PROMPT`, `SCAN_PROMPT`, the
  ideas prompt and the write prompt.
- The phone only sends the material: the caption or page text, the images, the
  pantry list, the chosen idea.
- The server also fixes the most images per call (4 for imports, 6 for scans)
  and the size of Claude's reply.
- Arbitrary prompts are no longer possible.
- `/api/cover` counts as kind `cover`.

### 2. Every call is recorded

- Before calling Claude or OpenAI, the server checks the caller's limits.
- After the call, it writes an `ai_usage` row with the token counts from the
  reply.
- A cost estimate comes from a small price table in `server.js`:
  - per million input and output tokens for Claude;
  - per image at the chosen quality for OpenAI.

  It is labelled an estimate. The real bill is in the consoles.

### 3. Limits, per person, reset at local midnight

Defaults, editable in the admin screen:

| Kind | Per day |
|---|---|
| Imports (`import`) | 20 |
| Fridge scans (`scan`) | 10 |
| Ideas and written recipes (`ideas` + `write`) | 15 |
| Covers (`cover`) | 5 (the most expensive) |

- Each person also has a monthly estimated budget (default US$5).
- The admin is exempt, or gets higher limits; that's a setting too.
- Only one AI call per person at a time. A second one gets "Still working on
  your last one", so a double tap can't spend twice.
- Failed calls that never reached the provider don't count. Calls that reached
  it but failed (for example `truncated`) do, because they cost money.

### 4. What the user sees

Over a limit, the server returns 429 with code `ai_limit` and which limit it
hit. `aiError` gets new messages in the same register as the others, e.g.:

- "You've made today's 5 covers. More tomorrow."
- "That's this month's AI allowance used up. Ask Zein if you need more."

Imports can still be written by hand, and nothing already saved is affected.

## Admin screen

Reached by a **long press on the version number** in the version sheet. Nothing
shows for anyone else, and the server refuses `/api/admin/*` to anyone but the
admin, so hiding the entrance isn't the security; the server check is.

- **People:** name, email, last seen, recipes, cooks, copies made.
- **AI usage:** per person, today and this month. Calls by kind and estimated
  cost, plus a total against the console limits.
- **Recent activity:** the latest 100 `activity` rows, filterable by person.
- **Limits:** edit the defaults, and override per person.

Pilot users are told, in the note about where their data lives, that activity
and AI usage are logged.

## Migration (1 → 2)

Runs once when the 2.0.0 server starts and `meta.data_version` is missing or 1.
The whole thing is **one SQLite transaction**: it either finishes or leaves the
old data exactly as it was.

1. Log counts: recipes, plan, pantry, shop.
2. Create `users`, and insert Zein from `OWNER_EMAIL`. Refuse to start with a
   clear log line if `OWNER_EMAIL` is missing.
3. For each collection:
   - create the new table with `owner`;
   - copy every row across with `owner = Zein`;
   - drop the old table;
   - rename the new table into its place.
4. Set `data_version = 2`.
5. Log counts again, and refuse to commit if any differ.

(`ai_usage`, `activity` and `settings` aren't created here. They're new, empty
tables that 2.2 creates with `CREATE TABLE IF NOT EXISTS` when it first needs
them. That isn't a data conversion, so it doesn't belong in the migration.)

**As built in 2.0.0** (`openData()` in `server.js`):
- It also refuses to start when the stored data version is newer than the build
  understands.
- A brand-new, empty install is created straight at version 2.
- The owner is the `is_admin` user, found by id. If `OWNER_EMAIL` changes, that
  user's email is updated ("owner email changed" in the log), so it's the same
  account and the same recipes.
- Any failure is logged as "Couldn't set up the database, so nothing was
  changed", and the server exits.
- Tested in `tests/migration.test.mjs`, including a migration forced to fail
  after two of the four tables have moved. Also tried against a database
  written by the real 1.10.4 server.

What doesn't move:

- **Photos and covers** stay where they are; recipes point to them by id.
- **Cook logs and ratings** are inside each recipe, so they come along.

### Phones after the update

- **Unsynced changes waiting on a phone** reach the server as normal writes. The
  server sets the owner from who's signed in, so they become Zein's with no
  special handling.
- **The offline copy and the outbox on the phone** move to per-user keys
  (`bourdain:<userId>`, `bourdain.outbox:<userId>`), so a different person
  signing in on the same phone never sees them.
  - `bourdain.me` remembers who was signed in last, so the right copy shows
    before the server answers.
  - On the first open after updating, the plain 1.x keys are adopted into the
    owner's, but only when the person signed in is the admin.
  - Every outbox entry is stamped with `uid` as well as `dv`.
- **A cook in progress** survives.

### Rollback

A snapshot restores the data, but the phone may already be running 2.0. So:

1. Stop the app.
2. Roll back the `data` dataset to `pre-2.0.0`.
3. Redeploy the 1.x image, pinned by its tag or digest rather than `:latest`.

Before that, 1.x gets one small release (**1.10.1**) that **ignores 2.0-shaped
data** in a phone's outbox or offline copy rather than tripping over it.

### What 1.10.1 set up, and what 2.0 does with it

1.10.1 added a **data version** (`DATA_VERSION = 1`) to both `server.js` and
`index.html`:

- The phone stamps it on its offline copy (`dv`), on each outbox entry (`dv`)
  and on each write (`X-Bourdain-Data` header).
- A 1.x server refuses writes stamped 2 with **409 `data_newer`**.
- A 1.x phone ignores an offline copy stamped 2. It moves outbox entries
  stamped 2 to `localStorage["bourdain.outbox.parked"]`, where they're kept but
  never sent.

2.0.0 does all five (see `store.whoami`, `unpark`, `setAsideAll` in
`index.html`, tested in `tests/dataversion.test.mjs`):

1. Set `DATA_VERSION = 2` on both sides, in the same release as the migration.
2. Accept writes stamped 1 or with no header (older phones still syncing), and
   convert them the way the migration converts rows. The owner comes from the
   signed-in user, as for every write.
3. **Handle 409 `data_newer` from the server as "the server was rolled back".**
   Stop syncing, move the outbox to the parked key, and say so. Don't drop it
   the way other 4xx errors are dropped.
4. At startup it asks `/api/me`, which only exists on 2.x. If that fails (a 1.x
   server, or offline), nothing is picked up from the parked key, and the first
   write the server refuses sets everything aside (as in 3). If the server is
   newer, it's the usual "close and reopen" stale-build case.
5. On startup against a data-2 server, pick up any parked entries stamped 2,
   put them back in the outbox, and clear the parked key. That's what makes
   "roll back, then upgrade again" lose nothing.

### Rehearsal (optional)

Agreed 2026-09-29 as more than a setup this size needs: the migration tests plus
the `pre-2.0.0` snapshot cover the same risk. If wanted:

1. Clone last night's snapshot to a scratch dataset.
2. Run the 2.0.0 image against it on a spare port, with `OWNER_EMAIL` set.
3. Check the logged counts, and click around.
4. Delete the clone.

### 2.0.0 day (Zein)

1. Tap the Bourdain title and note the build (commit). The image for it is
   `ghcr.io/zeinbenjamin/bourdain:sha-<commit>`, your way back.
2. Take a manual `pre-2.0.0` snapshot of the bourdain datasets in TrueNAS.
3. Redeploy. In the app's logs, look for the two "data migration 1 → 2" lines
   with matching counts.
4. Open the app and check your recipes, plan and pantry. Optionally tap the
   Bourdain title and use **Export my data** as an extra copy.

If something's wrong: stop the app, roll the `data` dataset back to
`pre-2.0.0`, change `:latest` to `:sha-<commit>` in the YAML, and redeploy.

## Security work before anyone outside gets in

- **#14:** `/api/fetch` refuses private, loopback and link-local addresses,
  including after redirects and DNS lookups.
- **Uploads:** each person gets a storage cap (default 500 MB of photos); a
  per-upload size limit already exists.
- **Covers and photos:** served to signed-in users only (every request needs a
  valid identity, so this comes with sign-in).
- **Export:** "Export my data" in the version sheet, for Zein's own backups and
  for any pilot user who asks for their data.

## What 2.1.0 built

As planned, with these decisions made while building it:

- **Still single-user.** Every request is Zein until 2.3, so other people can't
  sign in yet. The tests put "Sam" and "Ava" straight into the database, the
  way the server suite already inserts rows. There is no test-only way to be
  someone else.
- **The welcome is for Zein too.** Zein has no name after 2.0, so the first open
  of 2.1 asks for one. The name is suggested from the email ("zein.b@…" →
  "Zein"), a photo is optional, and **Later** puts it off until the next open.
  **Edit profile** is in the version sheet and on your own profile.
- **Alone, the Archives look as before.** The People row and **Everyone / Just
  me** only appear once someone else has a name, so Zein sees no change until a
  pilot user joins. Only named people are listed. Emails are never sent to
  anyone else.
- **The feed:** your own cooks always come from the phone's copy (current, and
  there offline). Everyone else's come from `/api/feed`, refreshed when older
  than a minute. If that fails, a line says it's showing just your cooks. The
  stats and Most cooked are always yours.
- **Profiles** show name, photo, counts, the 5 most recent cooks and all their
  recipes as cards. Your own profile has **Edit profile**.
- **Someone else's recipe** (`view "theirs"`) is read-only: the batch scaler
  works, but there's no Edit, Delete, Cook this, Add to the week, photo or cover.
  It has one red button, **Add to my recipes**, or **In your recipes ›** once
  you have a copy. Back returns to wherever it was opened from: the profile,
  the Archives, search, or your copy's "From Sam's recipes ›" line.
- **A copy** is made on the server (`POST /api/copy`), since it needs the other
  person's recipe. So it needs the server; offline, it says so.
- **Extra route:** `GET /api/people/:id/recipes/:rid` opens a single recipe,
  from the feed or a search result.
- **Tests:** `tests/people.test.mjs`, including a check that the Archives don't
  keep asking the server when you're alone. A render loop there was caught
  while building.

## What 2.2.0 built

As planned, with these decisions made while building it:

- **The jobs:** `import` (url + text, up to 4 images), `scan` (up to 6
  images), `ideas` (the pantry list) and `write` (the chosen idea, the pantry
  list and what's missing). The server clips each piece of text. A `prompt`
  field from the phone is ignored, and `/api/claude` is gone (JSON 404).
- **What counts:** a call is logged once it has left the server for Claude or
  OpenAI, including when it's stopped, times out or the provider fails.
  A missing key or an unreachable provider isn't counted. Refused calls (over a
  limit, busy) never reach the provider and aren't counted.
- **Cost:** Claude from a price table in `server.js`, per million tokens for
  the configured model (a model not in the table is priced as Sonnet and
  labelled a guess). The cover picture price is **a placeholder, US$0.05**,
  which Zein sets from the OpenAI bill in the owner's view.
- **Settings** live in a `settings` table: `limits` (everyone's),
  `limits:<userId>` (one person's, only the ones that differ) and `image_usd`.
  A bad value is refused whole (400 `bad_limits`) and nothing is saved.
- **Midnight** is the server's. The container needs `TZ` (in
  `docker-compose.yml`), or limits reset at midnight UTC.
- **The admin is exempt from all of it** while "No limits for you" is ticked,
  including one-at-a-time, so a cover finishing in the background never blocks
  an import. Untick it to try the limits yourself.
- **Activity** is logged for recipe adds, edits, cooks, deletes and copies,
  plan and pantry changes, profile changes and every AI job (with the reason
  when one didn't work). Titles, dates and item names only. Repeats within a
  minute are folded. Pruned after 6 months (activity) and 400 days (AI usage).
- **The owner's view** opens with a long press on the version sheet's heading
  ("Bourdain 2.2.0"). It has no button and no hint.
- **Tests:** one `ai` suite instead of the planned `ai-limits` and `admin`.
  Until 2.3 every request is the owner, so the server's 403 for anyone else
  can't be reached from a test without a bypass (there isn't one). The phone's
  handling of that 403, and that a non-admin's long press does nothing, are
  tested; the 403 itself gets a real test in 2.3 with signed-in test users.
- **Still to do at the invite stage:** the note for pilot users saying their
  activity and AI usage are logged.

## What 2.3.0 built

As planned, with these decisions made while building it:

- **Off until set up.** Without `CF_ACCESS_TEAM` and `CF_ACCESS_AUD`, 2.3
  behaves exactly like 2.2: every request is Zein, and Cloudflare traffic is
  refused with `cf_not_set_up`. So deploying 2.3 changes nothing on its own.
- **The token check** (`verifyCfToken`): RS256 only, signed by a key from
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cached for an
  hour, fetched again for a key it hasn't seen, at most once a minute), the
  issuer, the AUD tag, not expired (a minute's slack), and an email (a service
  token has none, and is refused). Only the header is read, not the cookie.
- **Anyone Cloudflare lets in is a member.** A new email gets an account on its
  first request, and the welcome asks their name. Cloudflare's allow-list is
  the membership list, as decided. The email matching `OWNER_EMAIL` is Zein.
- **The home network.** A request with **no Cloudflare headers at all** is Zein
  if its address is in `TRUSTED_NETS`. The rule that makes the NAS-address
  worry below safe: anything that arrived through the tunnel carries
  Cloudflare's headers, and those requests always need a token, whatever
  address they come from. `TRUSTED_NETS` empty (the default) means no network
  is trusted and everyone signs in. `X-Forwarded-For` is never read.
- **Checking it on the NAS:** the owner's view has a **Signing in** section
  showing the setup, the address the server saw for this phone, whether it came
  through Cloudflare, and how it was recognised.
- **Signed out:** 401 `signed_out` for a bad or missing token through
  Cloudflare, 401 `not_trusted` for an unknown network, 503
  `signin_unavailable` when Cloudflare's keys can't be fetched. On the phone,
  a redirect to Cloudflare's login or an HTML page in place of JSON counts as
  signed out too.
- **#14:** `publicGet` replaces `fetch` in the link fetcher. It uses Node's
  `http`/`https` with a lookup that refuses private, loopback, link-local,
  CGNAT, multicast and documentation ranges (IPv4 and IPv6, including
  IPv4-mapped, NAT64, 6to4 and Teredo forms) at connect time, so a name can't
  change address between the check and the connection. Redirects are followed
  one hop at a time (up to 5), each checked. Pages over 5 MB are cut off.
- **Photo storage:** a `photos` table records who uploaded what from 2.3 on;
  `storage_mb` (default 500) caps each person's total, and the owner is exempt
  while "No limits for you" is ticked. Photos from before 2.3 count for no one.
- **Tests:** `signin` signs in the real way, with a key the fake Cloudflare
  serves. The 403 for the owner's view is now tested with a real second person.
  A redirect from a public site to a private address can't be tested without
  a public test server; it goes through the same per-hop check as the first
  address, which is tested.

## Stages

Each stage ships and gets used before the next.

| Version | What |
|---|---|
| **1.10.1** ✅ | Groundwork: the old app ignores 2.0-shaped data (needed for rollback). Shipped; see "What 1.10.1 set up". |
| **2.0.0** ✅ | The migration. Owners on every row, users table, `/api/me`, per-user offline copy, Export. Still only Zein: every request is Zein, and Cloudflare traffic is refused until 2.3. The app looks the same. Shipped 2026-09-29. |
| **2.1.0** ✅ | Shipped 2026-09-29; see "What 2.1.0 built". Everything about seeing other people (merged from the planned 2.1 and 2.2 on 2026-09-29, since both change the Archives): profiles (name, photo, welcome screen), People row, read-only recipes, Add to my recipes, search across everyone's books, and the Archives feed with names and avatars, Everyone / Just me. |
| **2.2.0** ✅ | Shipped 2026-09-29; see "What 2.2.0 built". `/api/ai` with server-side prompts, usage log, limits, admin screen, activity log. |
| **2.3.0** 🔨 | Built 2026-09-29, waiting to be merged; see "What 2.3.0 built". #14, upload cap, "Signed out" handling, Cloudflare token verification. |
| — | Set up Cloudflare Tunnel + Access (no code). Zein signs in through it first, then with a second test email, then invites the pilot users. |

## Setup Zein does (no code)

- **Before 2.0.0:** add `OWNER_EMAIL` to the TrueNAS YAML (done 2026-09-29).
  It's mirrored in `docker-compose.yml` with a placeholder.
- **Any time (safe, nothing becomes public):** create the Access application
  (Self-hosted, public hostname `bourdain.<domain>`) with an email allow-list of
  Zein only, and a one-time-PIN login.
- **At 2.3.0, in this order:**
  1. Deploy 2.3.0. Nothing changes yet: sign-in is off until step 2.
  2. Add to the YAML, and redeploy:
     - `CF_ACCESS_TEAM` (the `<team>` in `<team>.cloudflareaccess.com`) and
       `CF_ACCESS_AUD` (the Access application's AUD tag);
     - `TRUSTED_NETS`: the home Wi-Fi's range (e.g. `192.168.1.0/24`) and
       Tailscale's `100.64.0.0/10` if used. Not the Docker network.
  3. At home, open the owner's view → **Signing in**. It should say
     "Recognised by: home network", with the phone's own address (e.g.
     192.168.1.23). If the address is a `172.x` one, Docker is hiding the real
     address; trust that only if every device that can reach port 8080 is yours.
  4. **Only then** add `bourdain.<domain>` as a public hostname on the existing
     tunnel (the one the media server uses; no second `cloudflared`), pointing
     at `http://<NAS IP>:8080`.
  5. On mobile data, open `https://bourdain.<domain>`, sign in, and check the
     owner's view says "Came through Cloudflare: Yes" and "Recognised by:
     Cloudflare". Then with a second email. Then add the pilot users' emails,
     with a note that activity and AI usage are logged.
  - Set the session length (e.g. 30 days) so pilot users rarely see the login.
- **Keep:** daily snapshots and the off-NAS backup.
- **Take:** a manual snapshot before 2.0.0.

## Testing

- Tests sign in the way production does, through the real token check:
  - The fake APIs in `tests/mock-apis.mjs` also serve a test signing key.
  - Tests make valid tokens for made-up users.
  - There is **no test-only header or bypass** in `server.js`.
- New suites:
  - `migration`: build a 1.x database, start 2.0, compare counts; also a
    migration that fails halfway, leaving the old data untouched.
  - `people`: two users, can't read or write each other's rows, copy, feed,
    and search across books:
    - finds the other person's recipes and never the caller's own;
    - marks ones already copied;
    - hidden offline;
    - tags, sort and filter leave it alone.
  - `ai-limits`: counts, 429s, one call at a time, the admin exemption.
  - `admin`: 403 for others, the long-press entrance.
- Existing suites run as the owner, and should pass unchanged apart from
  `/api/claude` becoming `/api/ai`.

## Open questions

- Should pilot users be able to hide one recipe from the group ("just for
  me")? Not in 2.x unless asked.
- Comments or likes on someone's cook in the feed? Not planned.
- If the pilot grows past Cloudflare's free 50 or wants to leave the NAS, the
  move is to a cloud host. That's a separate plan.
