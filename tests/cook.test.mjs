// Cook mode: ticking ingredients and steps, progress surviving a reload, the screen
// staying awake, finishing with a Michelin rating, the cook log, and the edge cases
// (stop without saving, switching recipes, starting from the Plan, finishing offline).
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("cook");
let s, b;
try {
  s = await startServer({ port: 18801 });
  b = await openBrowser();
  const { page, ctx, errors } = b;
  // Stand-in for the Screen Wake Lock API, recording requests and releases.
  await ctx.addInitScript(() => {
    window.__wake = { requested: 0, released: 0 };
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => { window.__wake.requested++; const l = new EventTarget(); l.release = async () => { window.__wake.released++; l.dispatchEvent(new Event("release")); }; return l; } } });
  });
  const today = (() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();
  await s.put("recipes", "soup", { title: "Leek soup", servings: 2, ingredients: [{ item: "leek", quantity: 2, unit: "whole" }, { item: "stock", quantity: 500, unit: "ml" }, { item: "butter", quantity: 20, unit: "g", section: "To finish" }], steps: ["Slice the leeks.", "Soften in butter.", "Add stock and simmer."], photos: [], tags: [], created_at: "2026-09-02" });
  await s.put("recipes", "pie", { title: "Apple pie", servings: 6, ingredients: [{ item: "apple", quantity: 6, unit: "whole" }], steps: ["Bake."], photos: [], tags: [], created_at: "2026-09-01" });
  await openApp(page, s.url);
  const server = async (id) => (await s.state()).recipes[id];

  // --- start from the recipe page at a 2× batch
  await page.click('.rcard:has-text("Leek soup")');
  check("recipe page: 'Cook this' and 'Not rated yet · Never cooked'", (await page.textContent("#cookThis")) === "Cook this" && /Not rated yet.*Never cooked/.test(await page.textContent("#cookStats")));
  await page.click("#multUp"); await page.click("#multUp"); // 2×
  await page.click("#cookThis"); await page.waitForSelector("#cookIng");
  check("cooking screen: title, batch and scaled amounts", /Leek soup/.test(await page.textContent("#view-cook h2")) && /2× batch/.test(await page.textContent("#view-cook .kicker")) && /1000 ml/.test(await page.textContent("#cookIng")));
  check("section headings kept ('To finish')", /To finish/i.test(await page.textContent("#cookIng")));
  check("first step highlighted as the next one", await page.locator('[data-step="0"].current').count() === 1);
  check("screen kept awake while cooking", (await page.evaluate(() => window.__wake.requested)) >= 1);

  // --- tick things off
  await page.click('[data-ing="0"]'); await page.click('[data-ing="1"]'); await page.click('[data-step="0"]');
  check("ticked items are struck through", (await page.locator("#cookIng .ck.done").count()) === 2 && (await page.evaluate(() => getComputedStyle(document.querySelector('[data-ing="0"] .txt')).textDecorationLine)) === "line-through");
  check("next step moves on to step 2", await page.locator('[data-step="1"].current').count() === 1 && await page.locator('[data-step="0"].current').count() === 0);
  check("progress line counts both", /2 of 3 ingredients · 1 of 3 steps done/.test(await page.textContent("#cookProgress")), await page.textContent("#cookProgress"));
  await page.click('[data-ing="1"]');
  check("tapping again un-ticks", (await page.locator("#cookIng .ck.done").count()) === 1);
  check("nothing written to the server while ticking", !(await server("soup")).cooks);

  // --- the app reloads mid-cook (phone locked, app switched)
  await page.reload(); await page.waitForFunction(() => !store.loading);
  check("after a reload: 'Still cooking Leek soup' bar", /Still cooking Leek soup/.test(await page.textContent("#cookBanner")));
  await page.click("#cookResume"); await page.waitForSelector("#cookIng");
  check("continue: ticks and batch kept", (await page.locator("#cookIng .ck.done").count()) === 1 && (await page.locator("#cookSteps .ck.done").count()) === 1 && /2× batch/.test(await page.textContent("#view-cook .kicker")));
  await page.click("#cookBack");
  check("recipe page now says 'Continue cooking'", (await page.textContent("#cookThis")) === "Continue cooking");
  check("leaving the cooking screen lets the screen sleep", (await page.evaluate(() => window.__wake.released)) >= 1);
  await page.click("#cookThis"); await page.waitForSelector("#cookIng");

  // --- finish with ★★
  await page.click("#cookFinish"); await page.waitForSelector('#sheet.open [data-act="rate"]');
  check("finish sheet offers the four Michelin options", (await page.locator('#sheet [data-act="rate"]').count()) === 4 && /worth a special journey/.test(await page.textContent("#sheet")));
  await page.click('#sheet [data-act="rate"][data-n="2"]'); await page.click('#sheet [data-act="save"]'); await sleep(500);
  let r = await server("soup");
  check("cook logged with today's date and batch", r.cooks && r.cooks.length === 1 && r.cooks[0].date === today && r.cooks[0].mult === 2, JSON.stringify(r.cooks));
  check("rating saved (2 stars)", r.rating === 2);
  check("confirms 'cook number 1'", /cook number 1/.test(await page.textContent("#toast")));
  check("recipe page: ★★ · Cooked once · last <today>", /★★/.test(await page.textContent("#cookStats")) && /Cooked once · last/.test(await page.textContent("#cookStats")));
  check("session cleared after finishing", (await page.evaluate(() => localStorage.getItem("bourdain.cooking"))) === null && (await page.textContent("#cookThis")) === "Cook this");

  // --- cook again, skip rating: rating kept, count goes up
  await page.click("#cookThis"); await page.waitForSelector("#cookIng"); await page.click("#cookFinish");
  await page.waitForSelector('#sheet.open [data-act="save"]');
  check("finish sheet pre-selects the current rating", await page.locator('#sheet [data-act="rate"][data-n="2"].on').count() === 1);
  await page.click('#sheet [data-act="save"]'); await sleep(500);
  r = await server("soup");
  check("second cook logged, rating unchanged", r.cooks.length === 2 && r.rating === 2);
  await page.click("#back");
  check("card shows ★★ and 'cooked 2×'", /★★/.test(await page.textContent('.rcard[data-id="soup"] .meta')) && /cooked 2×/.test(await page.textContent('.rcard[data-id="soup"] .meta')), await page.textContent('.rcard[data-id="soup"] .meta'));

  // --- history sheet: re-rate and remove a mistaken date
  await page.click('.rcard:has-text("Leek soup")'); await page.click("#cookStats"); await page.waitForSelector("#sheet.open .cooks");
  check("history lists both dates", (await page.locator("#sheet .cooks li").count()) === 2);
  await page.click('#sheet [data-act="rate"][data-n="3"]'); await sleep(400);
  check("re-rating from the history saves ★★★", (await server("soup")).rating === 3);
  await page.locator('#sheet [data-act="rm"]').first().click(); await sleep(400);
  r = await server("soup");
  check("removing a date keeps the other", r.cooks.length === 1 && (await page.locator("#sheet .cooks li").count()) === 1);
  await page.click('#sheet [data-act="done"]');
  check("recipe page updated: ★★★ · Cooked once", /★★★/.test(await page.textContent("#cookStats")) && /Cooked once/.test(await page.textContent("#cookStats")));

  // --- stop without saving
  await page.click("#cookThis"); await page.waitForSelector("#cookIng"); await page.click('[data-step="0"]');
  await page.click("#cookStop"); await page.click('#sheet [data-act="yes"]'); await sleep(300);
  check("stop without saving: nothing logged, session gone", (await server("soup")).cooks.length === 1 && (await page.evaluate(() => localStorage.getItem("bourdain.cooking"))) === null);

  // --- switching recipes mid-cook asks first
  await page.click("#cookThis"); await page.waitForSelector("#cookIng"); await page.click("#cookBack"); await page.click("#back");
  await page.click('.rcard:has-text("Apple pie")'); await page.click("#cookThis"); await page.waitForSelector("#sheet.open");
  check("starting another recipe asks first", /Still cooking Leek soup/.test(await page.textContent("#sheet h3")));
  await page.click('#sheet [data-act="switch"]'); await page.waitForSelector("#cookIng");
  check("switch: now cooking Apple pie, fresh ticks", /Apple pie/.test(await page.textContent("#view-cook h2")) && (await page.locator(".ck.done").count()) === 0);

  // --- start from the Plan at the planned servings
  await page.click("#cookStop"); await page.click('#sheet [data-act="yes"]'); await sleep(200);
  const d = new Date(); const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const key = monday.getFullYear() + "-" + String(monday.getMonth() + 1).padStart(2, "0") + "-" + String(monday.getDate()).padStart(2, "0");
  await s.put("plan", key, { date: key, entries: [{ recipeId: "pie", servings: 12 }] });
  await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.click('#tabs button[data-view="plan"]'); await page.click(`[data-slot="${key}"]`); await page.click('#sheet [data-act="cook"]'); await page.waitForSelector("#cookIng");
  check("'Cook it now' from the Plan scales to the planned 12 serves (2×)", /2× batch/.test(await page.textContent("#view-cook .kicker")) && /12 apple/.test(await page.textContent("#cookIng")), await page.textContent("#cookIng"));

  // --- finish while the server is down: queued, then synced
  await s.stop();
  await page.click("#cookFinish"); await page.waitForSelector('#sheet.open [data-act="save"]'); await page.click('#sheet [data-act="rate"][data-n="1"]'); await page.click('#sheet [data-act="save"]'); await sleep(600);
  check("offline finish: kept on the phone", /Saved on this phone/.test(await page.textContent("#toast")) && /1 change not synced/.test(await page.textContent("#syncSub")));
  await s.restart(); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await sleep(1500);
  r = await server("pie");
  check("offline finish: reaches the server when it's back", r.cooks && r.cooks.length === 1 && r.rating === 1);

  // --- editing a recipe keeps its cook log and rating
  await page.click('#tabs button[data-view="recipes"]'); await page.click('.rcard:has-text("Leek soup")'); await page.click("#edit");
  await page.fill("#fTitle", "Leek & potato soup"); await page.click("#revSave"); await sleep(500);
  r = await server("soup");
  check("editing keeps cooks and rating", r.title === "Leek & potato soup" && r.cooks.length === 1 && r.rating === 3);
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
