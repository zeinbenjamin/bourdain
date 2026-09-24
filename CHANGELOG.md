# Changelog

What changed in each version of Bourdain, newest first. The app shows this list
when you tap the "Bourdain" title.

Format: each version is a `## <version> — <YYYY-MM-DD>` heading followed by
`- ` bullet lines. The app parses exactly that, so keep to it.

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
