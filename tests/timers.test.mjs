// Cook-mode timers: durations found in steps, start/cancel/extend, surviving a reload,
// the alarm (sheet, vibration, beeps), the custom timer, and the countdown on the
// "Still cooking" bar. Uses Playwright's clock so 20 minutes pass instantly.
import { suite, startServer, openBrowser, sleep } from "./lib.mjs";

const { check, finish } = suite("timers");
let s, b;
try {
  s = await startServer({ port: 18901 });
  b = await openBrowser();
  const { page, ctx, errors } = b;
  await ctx.addInitScript(() => {
    window.__buzz = 0; navigator.vibrate = () => { window.__buzz++; return true; };
    window.__beeps = 0; const Real = window.AudioContext;
    window.AudioContext = class extends Real { createOscillator() { window.__beeps++; return super.createOscillator(); } };
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => ({ release: async () => {}, addEventListener() {} }) } });
  });
  await page.clock.install();
  await s.put("recipes", "ragu", { title: "Weeknight ragù", servings: 4, ingredients: [{ item: "beef mince", quantity: 500, unit: "g" }],
    steps: ["Brown the mince for 8-10 mins.", "Add the tomatoes and simmer for 1 hour 30 minutes, then rest 5 minutes.", "Stir through the basil.", "Toast the pine nuts for 30 seconds."],
    photos: [], tags: [], created_at: "2026-09-02" });
  await page.goto(s.url, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => !store.loading);

  // --- durations become timer buttons
  const parsed = await page.evaluate(() => [
    parseDurations("Brown the mince for 8-10 mins."), parseDurations("simmer for 1 hour 30 minutes, then rest 5 minutes"),
    parseDurations("Toast for 30 seconds"), parseDurations("Bake at 180C for 1½ hours"), parseDurations("Serves 4. Uses 2 cups."),
  ]);
  check("'8-10 mins' -> 8 minute timer, labelled 8–10 mins", parsed[0].length === 1 && parsed[0][0].secs === 480 && parsed[0][0].label === "8–10 mins", JSON.stringify(parsed[0]));
  check("'1 hour 30 minutes' and '5 minutes' -> two timers", parsed[1].length === 2 && parsed[1][0].secs === 5400 && parsed[1][1].secs === 300, JSON.stringify(parsed[1]));
  check("seconds and ½ hours understood", parsed[2][0].secs === 30 && parsed[3][0].secs === 5400);
  check("no timers from '4 serves' or '2 cups'", parsed[4].length === 0);

  await page.click(".rcard"); await page.click("#cookThis"); await page.waitForSelector("#cookSteps");
  const chips = await page.$$eval("#cookSteps .tmr", (bs) => bs.map((x) => x.textContent.trim()));
  check("timer buttons appear under the right steps", JSON.stringify(chips) === JSON.stringify(["⏱ 8–10 mins", "⏱ 1 hour 30 minutes", "⏱ 5 minutes", "⏱ 30 seconds"]), JSON.stringify(chips));
  check("step 3 (no duration) has no timer", (await page.locator("#cookSteps li:nth-child(3) .tmr").count()) === 0);

  // --- start one; it counts down and doesn't tick the step
  await page.click('#cookSteps .tmr:has-text("8–10 mins")');
  check("running timer shows 8:00 and sits in the top bar", /8:00/.test(await page.textContent("#timerBar")) && (await page.locator("#cookSteps .tmr.run").count()) === 1);
  check("starting a timer doesn't tick the step", (await page.locator('[data-step="0"].done').count()) === 0);
  await page.clock.fastForward("03:00");
  check("after 3 minutes it shows 5:00", /5:00/.test(await page.textContent("#timerBar")), await page.textContent("#timerBar"));

  // --- survives a reload
  await page.reload(); await page.waitForFunction(() => !store.loading);
  check("after a reload the 'Still cooking' bar shows the countdown", /Still cooking Weeknight ragù · ⏱ 5:00|· ⏱ 4:5\d/.test(await page.textContent("#cookBanner")), await page.textContent("#cookBanner"));
  await page.click("#cookResume"); await page.waitForSelector("#timerBar .tmr.run");
  check("back in cook mode the timer is still running", /[45]:\d\d/.test(await page.textContent("#timerBar")));

  // --- time's up
  await page.clock.fastForward("05:01");
  await page.waitForSelector("#sheet.open h3");
  check("time's up: a sheet names the step", (await page.textContent("#sheet h3")) === "Time's up" && /Step 1 · 8–10 mins/.test(await page.textContent("#sheet")));
  check("time's up: phone vibrates and beeps", (await page.evaluate(() => window.__buzz)) >= 1 && (await page.evaluate(() => window.__beeps)) === 3);
  await page.click('#sheet [data-act="more"]');
  check("'1 more minute' restarts it at 1:00", /1:00|0:59/.test(await page.textContent("#timerBar")), await page.textContent("#timerBar"));
  await page.clock.fastForward("01:01"); await page.waitForSelector("#sheet.open h3");
  await page.click('#sheet [data-act="ok"]');
  check("OK clears the timer", (await page.locator("#timerBar .tmr").count()) === 0 && /⏱ 8–10 mins/.test(await page.textContent("#cookSteps")));

  // --- cancel a running one
  await page.click('#cookSteps .tmr:has-text("1 hour 30 minutes")');
  check("hour-long timer shows 1:30:00", /1:30:00/.test(await page.textContent("#timerBar")));
  await page.click('#timerBar .tmr.run'); await page.waitForSelector("#sheet.open");
  await page.click('#sheet [data-act="stop"]');
  check("cancel timer removes it", (await page.locator("#timerBar .tmr").count()) === 0);

  // --- two at once, plus a custom timer
  await page.click('#cookSteps .tmr:has-text("5 minutes")'); await page.click('#cookSteps .tmr:has-text("30 seconds")');
  await page.click("#cookTimer"); await page.click('#sheet [data-act="go"][data-n="3"]');
  check("three timers run side by side", (await page.locator("#timerBar .tmr.run").count()) === 3 && /3 min timer/.test(await page.textContent("#timerBar")));
  await page.clock.fastForward("00:31"); await page.waitForSelector("#sheet.open h3");
  check("the 30-second one rings first", /Step 4 · 30 seconds/.test(await page.textContent("#sheet")));
  await page.click('#sheet [data-act="ok"]');
  check("the others keep running", (await page.locator("#timerBar .tmr.run").count()) === 2);

  // --- finishing the cook clears timers
  await page.click("#cookFinish"); await page.click('#sheet [data-act="save"]'); await sleep(300);
  check("finishing the cook clears all timers", (await page.evaluate(() => timers.list().length)) === 0 && (await page.evaluate(() => timers.handle)) === null);
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
