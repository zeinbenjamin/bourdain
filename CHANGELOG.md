# Changelog

What changed in each version of Bourdain, newest first. The app shows this list
when you tap the "Bourdain" title.

Format: each version is a `## <version> — <YYYY-MM-DD>` heading followed by
`- ` bullet lines. The app parses exactly that, so keep to it.

## 2.3.2 — 2026-09-29
- The People row at the top of the Archives shows first names only. Tap someone to see their full name on their profile.

## 2.3.1 — 2026-09-29
- When Bourdain doesn't recognise your network, the red bar now says which address it sees your device as, so you can check it against TRUSTED_NETS. The owner's view says the same instead of "check the server logs".
- The server log also records each refused address, once a minute, with the networks it trusts.

## 2.3.0 — 2026-09-29
- Ready for the pilot: once you've set up Cloudflare's sign-in, Bourdain opens from outside home too. Each person signs in with their email and a one-time code, and gets their own book.
- At home the app works as before, without signing in, from the networks you list.
- If a sign-in runs out, a red bar says "Signed out. Tap to sign in again." It never says Offline, and anything you changed waits on the phone and syncs once you're back in.
- Recipe links that point inside a home network (like 192.168.1.1) are refused.
- Each person can keep up to 500 MB of photos. You're not held to it; change it in the owner's view.
- The owner's view shows how the server recognised your phone, so you can check the setup.

## 2.2.0 — 2026-09-29
- Ready for sharing: each person now has a daily AI allowance (20 imports, 10 fridge scans, 15 recipe ideas and 5 covers a day) and an estimated US$5 a month. You're not held to them. Over a limit, the app says which one and when there's more.
- One AI job at a time per person, so a double tap can't spend twice.
- For you only: a long press on the heading of the version sheet (tap the Bourdain title) opens the owner's view. It shows who's using the app and when, what they've done lately, the AI each person used today and this month with an estimated cost, and lets you change the limits for everyone or for one person.
- Nothing changes in how importing, scanning, ideas or covers work.

## 2.1.0 — 2026-09-29
- New: your profile. The first time you open this version, pick the name (and, if you like, a photo) other people will see. Change it any time with Edit profile, by tapping the Bourdain title.
- Ready for sharing: once other people join, the Archives show everyone's cooks with their name and photo, with Everyone or Just me at the top. Tap someone to see their recipes and what they've cooked lately.
- Their recipes open read-only, with Add to my recipes. That makes your own copy to cook, rate and change, marked "From Sam's recipes". Their recipe stays as it is.
- Searching your recipes also shows matches from other people's books underneath.
- Until someone else joins, everything else looks the same.

## 2.0.0 — 2026-09-29
- Behind the scenes, everything in Bourdain now belongs to your own profile, ready for sharing it with a few other people later. Nothing looks or works differently.
- New: Export my data. Tap the Bourdain title for one file with all your recipes, plan, pantry and their photos, to keep as a backup.

## 1.10.4 — 2026-09-29
- Plan: meals no longer sit in boxes, so there are fewer lines across the page. Today's meals no longer have a red outline.
- Plan: fixed days with nothing planned sitting out of line with the rest of the week, a mistake from 1.10.2.

## 1.10.3 — 2026-09-29
- Plan: tap the dates between the ‹ and › buttons to jump straight back to this week.

## 1.10.2 — 2026-09-29
- Plan: on the current week, the ‹ and › buttons are red to match the dates.
- Plan: today's meals are outlined in red. If nothing's planned for today, its + is filled red as a nudge.

## 1.10.1 — 2026-09-29
- Groundwork for sharing Bourdain with other people later. Nothing changes when you use the app.
- If the app ever has to be rolled back from a future version, changes made in that newer version are kept safely on your phone instead of being sent to a server that can't read them.

## 1.10.0 — 2026-09-29
- The Timeline tab is now called Archives, after Bourdain's "the archives", with an archive-box icon. Everything in it is the same.
- On a recipe, Cook this, Add to the week, Add photo and Make cover sit in two neat rows instead of one button wrapping onto its own line.
- Back, Edit, Delete, Cancel and Save buttons at the top of each page are all the same size and easier to tap.
- The × to remove a photo or screenshot is easier to tap.

## 1.9.3 — 2026-09-29
- The "Still cooking" bar is now Michelin red, with a bigger red Continue button that's easier to tap.

## 1.9.2 — 2026-09-29
- Recipes: the "30 minutes or less" filter is gone. You can still sort by Quickest.

## 1.9.1 — 2026-09-29
- A new recipe is headed "New recipe", whether you imported it or are writing it yourself, instead of "Check the import".
- The import page is less wordy: the notes under the link and screenshot boxes are gone, and the text box is now labelled "Video caption, recipe text or notes".

## 1.9.0 — 2026-09-29
- New Timeline tab: everything you've cooked, newest first, grouped by month and day, with its stars and batch size.
- At the top: how many times you've cooked this month and this year, how many of your recipes you've tried, and your three most cooked.
- Tap any cook to open the recipe. Back takes you to the Timeline.
- It fills in from the cook log you already have, so every cook you've logged is already there.

## 1.8.0 — 2026-09-29
- The Import tab is gone. Tap + on Recipes and choose Import a recipe (a link, pasted text, screenshots or a screen recording) or Write one yourself.
- If you leave an import before saving it, + offers to carry on with it, so it isn't lost.
- When editing a recipe, each ingredient sits in its own grey box with space between, so the rows are easy to tell apart. The × to remove one is easier to tap, and the unit and amount boxes no longer cut off "whole" or "1000".

## 1.7.7 — 2026-09-27
- Plan: meals no longer show how many they serve, so the week is less crowded. Tap a meal to see or change it.

## 1.7.6 — 2026-09-27
- Plan: each planned meal shows a small picture on the left: its cover, or its first photo, the same as on the recipe card.
- Plan: long recipe names wrap onto more lines instead of being cut off with "…". The servings sit underneath.

## 1.7.5 — 2026-09-27
- Plan: the top right shows today's date, like the other tabs, instead of the week you're looking at.

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
