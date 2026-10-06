# Backlog

What's outstanding, newest first within each group. Remove a row once it's done;
the CHANGELOG records what shipped.
Priorities follow `docs/strategy.md`: reliability first, then the core loop.

## From pilot users

Nothing open. Past cooks and the list view shipped in 2.6.0.

## Planned for 2.7.0

Agreed with Zein on 2026-10-06; not built yet. Waiting on Nicole's answers about
the shopping list before starting. Mock-ups were made in a test browser, not in
the app.

### 1. Shopping list as its own tab (pilot request, Nicole)

- **Option B:** a Shop tab, with the hidden code restored (`buildList`, `renderShop`,
  the `shop` collection). A week switcher like the Plan's, kept in step with it.
- **From today:** for the current week, only today onwards; other weeks in full.
- **Amounts in the recipe's own unit** when every recipe uses the same one (3 tbsp,
  4 cup). The old `fromBase` turned them into ml and L ("45 ml curry paste").
- **Pantry items stay in their aisle**, ticked from the start, with a small grey
  "from pantry" tag that isn't crossed out (matched with `itemKey`, exact names
  only). Unticking one puts it back on the list. Clear ticked clears only what
  you ticked yourself.
- Grouped by aisle; each item says which recipes it's for; manual "Add something
  else"; **Share list** (Web Share, copy as a fallback) and **Clear ticked** at the
  bottom, under the add box.
- Check Nicole's answers first: from today vs the whole week, whether the recipe
  names help, and whether she'd share it.

### 2. Tabs in a new order (Zein)

**Plan, Pantry, Recipes, Shop, Archives**: Recipes in the middle as the main
screen, with the others either side. The app still opens on Recipes. Five tabs:
`.tabs` becomes `repeat(5,1fr)`. Update the `add` suite's tab check and the
layout checks at phone width.

### 3. A floating tab bar, Instagram style (Zein, option B)

The tab bar becomes a frosted white pill floating above the page instead of a
full-width strip: 14px in from each side, 10px above the home bar
(`env(safe-area-inset-bottom)` included), rounded ends, a thin border, a soft
shadow, and the content blurred behind it (`backdrop-filter`, with the `-webkit-`
prefix for Safari). **Icons with small labels** (24px icons, 10px labels, 54px-tall
buttons): the labels stay because pilot users are still learning what Pantry and
Archives are. The current tab sits on a soft grey pill, its icon drawn bolder and
its label in ink; the others are grey. Chosen 2026-10-06 from three mock-ups (icons
only in grey, icons with labels, icons only in red).

- **On an iPad** the pill is capped at about 500px wide and centred
  (`max-width` with `margin: 0 auto`), so it sits under the content column like a
  dock rather than stretching edge to edge. On a phone the cap never applies.
  (Today's full-width bar spreads four tabs about 250px apart on an iPad.)
- `<main>`'s bottom padding grows so the last thing on a page clears the pill.
- The layout suite measures the pill: inside the screen at phone width, centred
  and no wider than the cap at iPad width (both orientations), 44px+ tap
  targets, labels not cut off with five tabs, the last card clear of it, nothing
  hidden behind it on any tab.
- Check on an iPhone before release: Safari draws the blur differently from
  desktop Chromium, and the tab bar is what drifted in 2.6.x.

The UI review's two bigger items below (keeping a draft through a restart, and
back navigation) move to 2.7.1.

## From the UI review (2026-10-06)

Found while reviewing how smooth the app is on a phone. 2.6.3 fixed the zooming,
the home bar gap and lazy pictures; these are left, most useful first.

| Item | Notes |
| --- | --- |
| Keep an unsaved import or edit through an app restart | `state.draft` lives only in memory, and iPhone often closes a home-screen app in the background, as happens when switching to Instagram mid-import. Keep the draft on the phone (per user) until it's saved or discarded; show it under "Carry on with …". Small to medium; planned as 2.7.1. |
| Back gesture and back button | Screens don't use the browser's history, so Android's back closes the app from anywhere and iPhone Safari's swipe back leaves it. Push a history entry per screen and handle `popstate`; keep the in-app Back buttons. Medium; planned as 2.7.1. |
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
