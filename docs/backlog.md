# Backlog

What's outstanding, newest first within each group. Remove a row once it's done;
the CHANGELOG records what shipped.

## From pilot users

| Item | Raised | Notes |
| --- | --- | --- |
| **YouTube links don't import** ("Doesn't work bro") | 2026-09-30 | The link fetcher has no YouTube handling: it reads the page like any website, and YouTube's page hides the description (it's inside `ytInitialPlayerResponse` as `shortDescription`), or serves a consent or bot check instead. Fix idea: a YouTube route like TikTok's (oEmbed for the title, plus the page's `shortDescription`). Until then, a screen recording works. Ask which video, to test with. |
| **Photo of a dish → a recipe** ("a recipe Shazam") | 2026-09-30 | Take a photo of a plated dish (e.g. at a restaurant); Claude names the dish and writes a likely recipe, which lands on the review screen as usual. Likely a new AI job (`dish`) sharing the import limit, with the photo as the recipe's first photo. The result is a guess, so the review screen should say so. |

## Requested by Zein

| Item | Notes |
| --- | --- |
| **Home cost vs eating out** | Estimate each recipe's cost per serve to make (Australian supermarket prices) against eating out, so the Archives can say roughly what each cook saved. Decided 2026-10-02: compare against the **average of casual and mid-range** prices, and **leftovers count fully** (all servings made). Plan, open questions and example figures: `docs/cost-comparison.md`. |

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
| Anyone on home Wi-Fi counts as Zein | While `TRUSTED_NETS` trusts Docker's gateway. Host networking, or a guest network, narrows it. |
| No cap on recipe count or writes per person | Photos are capped (500 MB). |
| Recipes of someone without a name yet are readable by id | Ids are random. |
| Large uploads are processed on the NAS | Several 25 MB uploads at once could slow it. |
