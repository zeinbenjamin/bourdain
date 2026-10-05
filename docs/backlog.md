# Backlog

What's outstanding, newest first within each group. Remove a row once it's done;
the CHANGELOG records what shipped.
Priorities follow `docs/strategy.md`: reliability first, then the core loop.

## From pilot users

Nothing open. Past cooks and the list view shipped in 2.6.0.

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

Decided 2026-10-06, not to be built: **icons for each ingredient**. A proof of
concept (painted icons on the recipe page and in cook mode) was shown to a pilot
user, who liked the vegetable avatars but found ingredient icons too cluttered
alongside everything else the app does, and "too AI". Zein dropped it.

Accepted 2026-10-02, not to be built: no cap on recipe count or writes per
person (photos are capped); recipes of someone without a name are readable by
id (ids are random); large uploads are processed on the NAS (fine for the pilot).
