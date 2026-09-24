# Changelog

What changed in each version of Bourdain, newest first. The app shows this list
when you tap the "Bourdain" title.

Format: each version is a `## <version> — <YYYY-MM-DD>` heading followed by
`- ` bullet lines. The app parses exactly that, so keep to it.

## 1.5.0 — 2026-09-24
- New: Scan fridge or pantry. Take a few photos and the app lists the food it can see, so you don't have to type it.
- Nothing is added until you've checked the list. Everything starts ticked except items marked "not sure".
- Things already on your pantry list are shown, but never added twice.
- Counts are only filled in when they're obvious, like eggs or cans. Salt, pepper, oil and water are skipped, as they're always assumed.

## 1.4.0 — 2026-09-24
- New: tap Make cover on a recipe to get an illustrated cover in your usual style, floating on the page with no background.
- Covers show whole on the recipe card and at the top of the recipe, and your own photos stay underneath.
- You can make a cover while reviewing an import, make a new one any time, or remove it.
- When an import fails, the message now says what went wrong and what to do: a missing or rejected key, no credit, Claude overloaded, a reply that was cut off, or an image it couldn't accept.
- Long recipes no longer get cut off partway through reading.
- Screenshots are shrunk on your phone before sending, so imports upload faster.
- A screen recording that won't play properly now stops with a message instead of spinning forever.
- Messages stay on screen long enough to read.

## 1.3.1 — 2026-09-24
- The app opens straight onto your recipes, using the copy saved on this phone, while it checks the server in the background.
- A new phone with nothing saved yet shows "Loading your recipes…" instead of "Nothing in the book yet".
- On slow Wi-Fi the app appears after 3 seconds at most, instead of a white screen.
- The page no longer waits for its fonts before showing anything.
- The Stop button during an import now really stops it, and the server cancels its request to Claude too.
- Fixed a crash in the Plan picker when a recipe had no title.

## 1.3.0 — 2026-09-24
- Tap the Bourdain title to see which version you're running and this history.
- If your phone has an older version than the server, the app tells you to close and reopen it.

## 1.2.0 — 2026-09-24
- Updates reach your phone the next time you open the app, instead of up to an hour later.
- If the server is up but can't load your recipes, the app says so, rather than claiming it can't reach the server.
- One damaged recipe in the database no longer stops the rest from loading.
- Clearer message when an import is too big to send.
- Builds install exactly the same library versions every time.
- The repo's setup file now matches the live TrueNAS setup.

## 1.1.0 — 2026-09-24
- Changes made while the server is unreachable are kept on your phone and sync when it's back.
- "Saved" only appears once the server really has your change.
- Deleted recipes and pantry items stay deleted, even if the connection dropped.
- The header shows "Offline" or how many changes are waiting to sync.

## 1.0.0 — 2026-09-24
- The app as it was when the repo was created: recipes, week plan, pantry, and importing from links, screenshots and screen recordings.
