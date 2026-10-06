# Backlog

What's outstanding, newest first within each group. Remove a row once it's done;
the CHANGELOG records what shipped.
Priorities follow `docs/strategy.md`: reliability first, then the core loop.

## From pilot users

Nothing open. Past cooks and the list view shipped in 2.6.0.

## To watch

After 2.7.0: whether the pilot uses the Shop (`shop_changed` in the owner's
activity view), and how the floating tab bar looks on a real iPhone and iPad
(Safari draws the blur differently from desktop Chromium). Since 2.7.8: whether
Instagram keeps giving captions (the activity log says "read the caption (preview)"
or which other way worked, or "no caption"), and which recipe sites still answer 403 to the NAS.
If several do, a reader service could fetch for Bourdain, but that sends each link
to a third party, so it's Zein's call.

## Planned (not started; Zein gives the go-ahead)

Paused while the pilot settles (2026-10-07): only fixes for now, and fewer, bigger
releases, per `docs/strategy.md`.

| Item | Notes |
| --- | --- |
| Slide along the tab bar (2.8.0 candidate) | Press anywhere on the tab bar and slide: the grey pill lifts slightly (white, a soft shadow, scaled about 1.1×) and follows the finger, the tab under it goes bold and the one you started on dims, and letting go opens it. A plain tap works as now. The pill becomes one element that glides between tabs (a springy ease) rather than each button's own background. A `navigator.vibrate` tick on each new tab (Android only; iPhone has no web haptics). Like iOS 26's own tab bar. Proof of concept shown 2026-10-07 (pointer events on `#tabs`, pointer capture, `touch-action: none` on the bar only). |
| …and the same on Everyone / Just me in the Archives | The `.seg` switch gets the same treatment: press and slide between the two halves, the pill follows, letting go chooses; a tap still works. Built as one helper shared by the tab bar and `.seg`, so any later segmented switch gets it too. |

Decided 2026-10-07, not to be built: **swiping the page sideways to change tabs**
(option B of the same proof of concept). It risks changing tab on a sloppy scroll in
the kitchen, fights the sideways drags already on the page (ingredient reorder, the
People row, covers), and clashes with Safari's swipe-from-the-edge to go back.

## From the UI review (2026-10-06)

Found while reviewing how smooth the app is on a phone. 2.6.3 fixed the zooming,
the home bar gap and lazy pictures; these are left, most useful first.

| Item | Notes |
| --- | --- |
| "Paste link" button on the import form | Reads the clipboard into the link box: one tap instead of press-and-hold, Paste. Small. |
| "Share to Bourdain" on Android | A `share_target` in the web app manifest puts Bourdain in the share menu of Instagram, TikTok and Chrome. Android only; iPhone doesn't allow it for web apps. Small to medium. |
| Toasts sit over sheet content | e.g. the Undo toast covers a row of the cook log for 6s. Raise it above the sheet, or into the sheet's own space. Small. |
| Check the keyboard with the tab bar | On some iOS versions the fixed tab bar rides up over the keyboard and can cover the field being typed in. Needs checking on a real iPhone (edit form, pantry box) before deciding on a fix. |
| Wider screens (iPad) | Content is capped at 760px, but rows inside it still run the full width: on the Plan a day's name sits far from its "+", and a few other screens look the same. Only worth doing if the pilot uses iPads. The tab bar's iPad cap is in 2.7.0. |

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
