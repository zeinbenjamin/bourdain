# Backlog

What's outstanding, newest first within each group. Remove a row once it's done;
the CHANGELOG records what shipped.
Priorities follow `docs/strategy.md`: reliability first, then the core loop.

## Planned for 2.6.0

Reviewed 2026-10-05, not built yet. One minor release, in this order. All three
only add fields, so no data migration and no data version bump.

### 1. Add a past cook (pilot request)

- **Where:** the rating and cook-log sheet (`historySheet`, opened from the stats
  line on a recipe) gets "Add a date I cooked this": a date picker (any date up to
  today, opening on today), a batch size (1× default) and an optional rating.
  Later, possibly: "I cooked this" on a past day's meal in the Plan.
- **Any date**, as Zein decided. Most will be within 90 days, so the picker opens
  on today and steps back easily; it doesn't stop at 90 days.
- **Not a pilot metric.** The new cook is stored as `{date, at, mult, added: true}`
  (`at` = midday that day). The server logs it as `cook_added` ("cook added later",
  with the date), not `cook_logged`, so "finished a cook this week" in the activity
  log and the admin overview stays honest. The phone shows it like any other cook:
  in the Archives, Most cooked and savings.
- **Order.** `lastCooked()`, the recipe page's "last cooked" and the "Recently
  cooked" sort all read the last entry in `cooks`. Either insert the new cook in
  date order or make those read the latest date. Test both a back-dated cook and
  one dated today.
- **Others' phones** show it on its own date, not at the top of the feed. That's
  correct.

### 2. Grid or list on the Recipes tab (pilot request)

- A two-button switch next to sort and filter, kept in `listPrefs` (`view: "grid" |
  "list"`), so it's per phone with no server change. A saved value that's no longer
  an option falls back to grid, like the others.
- **A list row:** `miniThumb()` (the Plan's rule: a cover whole on white, else the
  first photo, else the first letter) at about 48px, then the title, stars and the
  meta line. No tags. At least 44px tall.
- `cardHtml()` is also used for other people's books, search hits and profiles. Use
  the same setting everywhere.
- Add measured checks to `tests/layout.test.mjs`: row height, tap target, thumbnail
  size, no horizontal scroll at phone width.

### 3. Choose between the covers you've made (Zein)

- **Keep them:** a recipe gets `covers: [id]`, every cover made for it, newest
  first, capped at 6 (the oldest one not chosen drops off). `cover` stays the one
  shown. An older recipe without `covers` is treated as `[cover]`.
- **After "Make a new cover"**, a picker sheet shows all of them with the new one
  selected. Tap one, then "Use this cover". Tapping the cover itself on the recipe
  page opens the same picker without painting a new one, so going back costs
  nothing. Each cover gets a × to remove it from the list.
- **The sweep must know.** `sweepCovers()` only spares the `cover` of each recipe,
  so after 7 days it would delete every alternative. It has to count every id in
  `covers` as in use. That's the one server change, and it needs a test.
- **Drafts:** a cover made on the review form before saving (`#revCover`) goes into
  the draft's `covers` too.
- **Copies:** `/api/copy` takes only the chosen `cover` and drops `covers`, so
  nobody inherits someone else's rejects.
- **Cost:** each cover is an OpenAI call (about `image_usd`, US$0.05 as a
  placeholder). Keeping the old ones removes the fear of losing a good one, which
  may mean more covers get made; the daily limit (5) still caps it. Covers aren't
  counted in anyone's `storage_mb`: 6 WebPs of a few hundred KB each per recipe is
  small, but at scale that would need counting.

## From pilot users

Add a past cook, and grid or list on Recipes: planned for 2.6.0 above.

## Requested by Zein

Nothing open. Home cost vs eating out shipped in 2.5.0.

## Admin actions not built (from the 2026-10-02 brief)

| Item | Notes |
| --- | --- |
| Change permissions | There is one owner by design; nobody else can be an admin. |
| Reset someone's usage | Would delete cost records; limits can be raised instead. |
| Review, remove or restore other people's recipes | Moderation; not needed for the pilot. |
| Invite from the app | Invites are Cloudflare's allow-list; the app explains how. Doing it here would need a Cloudflare API token on the server. |

## Setup and housekeeping

| Item | Notes |
| --- | --- |
| Confirm host networking on the NAS | `docker-compose.yml` has `network_mode: host`; the live YAML may still use the port mapping with `TRUSTED_NETS: "172.16.2.1/32"`. Make the file match whichever is live. |
| Set the cover price | `image_usd` is a placeholder (US$0.05) in the owner's view; set it from the OpenAI bill. |
| Check `TZ` is set | Without it, daily AI limits reset at midnight UTC. |
| Try the owner's view as a pilot user | Optional: the tests already check it's refused. |

## Ideas not yet built

| Item | Notes |
| --- | --- |
| Pantry amounts that go down when you cook | Needs every pantry item to have a real amount and unit: a data migration (a 3.0.0). |
| Nutrition estimates | |
| Timer alerts while the phone is locked | Needs push notifications. |
| Bring back the shopping list | Code is intact and hidden (`renderShop`, the `shop` collection). |
| Clean up unused photos (`.jpg`) | Covers are already swept. |
| Move Pantry behind the Recipes "+" | As something like "Cook from the pantry". |

## Low-risk items from the 2026-09-30 security review

| Item | Notes |
| --- | --- |
| Anyone on home Wi-Fi counts as Zein | Only when they open the NAS address directly (`192.168.1.109:8080`), not `bourdain.elevengrant.com`, which always asks Cloudflare who it is. While `TRUSTED_NETS` trusts Docker's gateway. Host networking, or a guest network, narrows it. |

Accepted 2026-10-02, not to be built: no cap on recipe count or writes per
person (photos are capped); recipes of someone without a name are readable by
id (ids are random); large uploads are processed on the NAS (fine for the pilot).
