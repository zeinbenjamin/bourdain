# Changelog

What changed in each version of Bourdain, newest first. The app shows this list
when you tap the "Bourdain" title.

Format: each version is a `## <version> — <YYYY-MM-DD>` heading followed by
`- ` bullet lines. The app parses exactly that, so keep to it.

## 1.7.4 — 2026-09-27
- Plan: each day has a small + button instead of "+ Add a meal", so the week is less cluttered.
- Plan: the current week's dates are in red with "(this week)" underneath, so you can tell at a glance.
- Plan: the ‹ and › week buttons are bigger and easier to tap.

## 1.7.3 — 2026-09-27
- Pantry: proper spacing between the buttons, your ideas and the list, and "Tonight's options" now matches the other headings.
- Pantry: the × to remove an item is easier to tap, the Add button is no longer squashed, and the example in the box fits.
- The + button next to search is a proper circle.
- On a recipe, the gap between the stars and the description is tidied up.
- The date shows in the header as soon as the app opens.

## 1.7.2 — 2026-09-27
- On recipe cards, the Michelin stars now sit on their own line under the title, above the time, servings and source. Recipes without stars skip that line.

## 1.7.1 — 2026-09-27
- Ratings now use real Michelin stars, and the app's accent colour is Michelin red.
- Recipe cards no longer show how many times you've cooked something. It's still on the recipe page.
- Timers in cook mode: any step that mentions a time, like "simmer for 20 minutes", gets a button that starts a countdown. When it's up, your phone buzzes and beeps and shows which step it was.
- Timers keep going if the phone locks or the app reloads, and several can run at once. "+ Timer" starts one of your own.
- Sort recipes by newest, A to Z, most stars, most cooked, recently cooked or quickest, and filter by stars, never cooked or 30 minutes or less. The app remembers your choice.

## 1.7.0 — 2026-09-27
- New: Cook this. Open a recipe, tap Cook this, and tick off ingredients and steps as you go. The next step is highlighted, and the screen stays on while you cook.
- Your progress is kept if the phone locks or the app closes. A "Still cooking" bar takes you straight back.
- When you finish, the date is logged and you can give the recipe a Michelin-style rating: no stars, ★, ★★ or ★★★.
- Each recipe shows its stars, how many times you've cooked it and when you last did. Tap that line to change the rating or remove a date logged by mistake.
- Recipe cards show the stars and the cook count too.
- Cook it now from a planned meal, at the servings you planned.

## 1.6.1 — 2026-09-24
- You can now edit a recipe's description.
- Tapping Save twice on a slow connection no longer saves the recipe twice. The button says "Saving…" until it's done.
- Security update to the image library that processes your photos, fridge scans and covers.

## 1.6.0 — 2026-09-24
- Photos you add while the server can't be reached are kept on your phone and shown straight away, then uploaded when it's back.
- The "not synced" count in the header includes photos waiting to upload.
- Old cover images that no recipe uses any more are cleared off the NAS after a week. Your own photos are never deleted.

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
