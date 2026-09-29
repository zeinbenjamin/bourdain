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

## Stages

Each stage ships and gets used before the next.

| Version | What |
|---|---|
| **1.10.1** ✅ | Groundwork: the old app ignores 2.0-shaped data (needed for rollback). Shipped; see "What 1.10.1 set up". |
| **2.0.0** ✅ | The migration. Owners on every row, users table, `/api/me`, per-user offline copy, Export. Still only Zein: every request is Zein, and Cloudflare traffic is refused until 2.3. The app looks the same. Shipped 2026-09-29. |
| **2.1.0** | Everything about seeing other people (merged from the planned 2.1 and 2.2 on 2026-09-29, since both change the Archives): profiles (name, photo, welcome screen), People row, read-only recipes, Add to my recipes, search across everyone's books, and the Archives feed with names and avatars, Everyone / Just me. |
| **2.2.0** | `/api/ai` with server-side prompts, usage log, limits, admin screen, activity log. |
| **2.3.0** | #14, upload cap, "Signed out" handling, Cloudflare token verification. |
| — | Set up Cloudflare Tunnel + Access (no code). Zein signs in through it first, then with a second test email, then invites the pilot users. |

## Setup Zein does (no code)

- **Before 2.0.0:** add `OWNER_EMAIL` to the TrueNAS YAML (done 2026-09-29).
  It's mirrored in `docker-compose.yml` with a placeholder.
- **Any time (safe, nothing becomes public):** create the Access application
  (Self-hosted, public hostname `bourdain.<domain>`) with an email allow-list of
  Zein only, and a one-time-PIN login.
- **At 2.3.0, in this order:**
  1. Deploy 2.3.0.
  2. Add `CF_ACCESS_TEAM` / `CF_ACCESS_AUD` to the YAML, and redeploy.
  3. **Only then** add `bourdain.<domain>` as a public hostname on Zein's
     existing tunnel (the one the media server uses; no second `cloudflared`),
     pointing at `http://<NAS IP>:8080`.
  4. Test on mobile data, with Zein's email and a second one. Then add the
     pilot users' emails.
  - The team name and the Access application's audience (AUD) tag are the
    values for `CF_ACCESS_TEAM` / `CF_ACCESS_AUD`.
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
