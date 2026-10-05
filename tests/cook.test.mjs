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
  const bar = await page.evaluate(() => { const c = (q) => getComputedStyle(document.querySelector(q)); const b = document.getElementById("cookResume").getBoundingClientRect();
    return { text: c(".cookbar").color, title: c(".cookbar strong").color, btnBg: c("#cookResume").backgroundColor, btnInk: c("#cookResume").color, h: b.height }; });
  const FLAME = "rgb(211, 7, 43)";
  check("'Still cooking' text and Continue button are Michelin red; button 44px", bar.text === FLAME && bar.title === FLAME && bar.btnBg === FLAME && bar.btnInk === "rgb(255, 255, 255)" && bar.h >= 44, JSON.stringify(bar));
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
  check("recipe page: 2 Michelin stars · Cooked once · last <today>", (await page.locator("#cookStats .mstar").count()) === 2 && /Cooked once · last/.test(await page.textContent("#cookStats")));
  check("session cleared after finishing", (await page.evaluate(() => localStorage.getItem("bourdain.cooking"))) === null && (await page.textContent("#cookThis")) === "Cook this");

  // --- cook again, skip rating: rating kept, count goes up
  await page.click("#cookThis"); await page.waitForSelector("#cookIng"); await page.click("#cookFinish");
  await page.waitForSelector('#sheet.open [data-act="save"]');
  check("finish sheet pre-selects the current rating", await page.locator('#sheet [data-act="rate"][data-n="2"].on').count() === 1);
  await page.click('#sheet [data-act="save"]'); await sleep(500);
  r = await server("soup");
  check("second cook logged, rating unchanged", r.cooks.length === 2 && r.rating === 2);
  await page.click("#back");
  check("card shows 2 Michelin stars and no cook count", (await page.locator('.rcard[data-id="soup"] .cstars .mstar').count()) === 2 && !/cooked/i.test(await page.textContent('.rcard[data-id="soup"]')), await page.textContent('.rcard[data-id="soup"] .meta'));
  check("stars are drawn in the Michelin red", (await page.evaluate(() => getComputedStyle(document.querySelector('.rcard[data-id="soup"] .cstars .mstars')).color)) === "rgb(211, 7, 43)");

  // --- history sheet: re-rate and remove a mistaken date
  await page.click('.rcard:has-text("Leek soup")'); await page.click("#cookStats"); await page.waitForSelector("#sheet.open .cooks");
  check("history lists both dates", (await page.locator("#sheet .cooks li").count()) === 2);
  await page.click('#sheet [data-act="rate"][data-n="3"]'); await sleep(400);
  check("re-rating from the history saves ★★★", (await server("soup")).rating === 3);
  await page.locator('#sheet [data-act="rm"]').first().click(); await sleep(400);
  r = await server("soup");
  check("removing a date keeps the other", r.cooks.length === 1 && (await page.locator("#sheet .cooks li").count()) === 1);
  // 2.6.1: the toast offers Undo, which puts the cook back where it was
  const gone = (await s.state()).recipes.soup.cooks.length;
  const tb = await page.evaluate(() => { const b = document.querySelector("#toast.show .toast-btn"), r = b && b.getBoundingClientRect(); return b && { text: b.textContent, h: Math.round(r.height), w: Math.round(r.width), msg: document.querySelector("#toast").firstChild.textContent }; });
  check("removing says so, with a 44px Undo", tb && tb.text === "Undo" && tb.h >= 44 && tb.w >= 44 && /^Removed /.test(tb.msg), JSON.stringify(tb));
  await page.click("#toast .toast-btn"); await sleep(500);
  r = await server("soup");
  check("…Undo puts it back, in date order, and the sheet lists it again", r.cooks.length === gone + 1 && r.cooks.every((c, i, a) => !i || (a[i - 1].date + a[i - 1].at) <= (c.date + c.at)) && (await page.locator("#sheet .cooks li").count()) === 2 && /Put back/.test(await page.textContent("#toast")));
  await page.locator('#sheet [data-act="rm"]').first().click(); await sleep(400); // take it off again for the checks below
  await page.click('#sheet [data-act="done"]');
  check("recipe page updated: 3 Michelin stars · Cooked once", (await page.locator("#cookStats .mstar").count()) === 3 && /Cooked once/.test(await page.textContent("#cookStats")));

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
  // --- 2.6.0: adding a cook from an earlier day
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const actBefore = (await (await fetch(s.url + "/api/admin/activity?cat=content&limit=200")).json()).filter((a) => a.action === "cook_logged").length;
  await page.evaluate(() => { state.detailId = "soup"; show("detail"); });
  await page.click("#cookStats"); await page.waitForSelector("#sheet.open #addPastCook");
  await page.click("#addPastCook"); await page.waitForSelector("#sheet.open #pcDate");
  check("past cook: the date opens on today and can't go past it", (await page.inputValue("#pcDate")) === today && (await page.getAttribute("#pcDate", "max")) === today);
  const tomorrow = daysAgo(-1);
  await page.fill("#pcDate", tomorrow); await page.click('#sheet [data-act="save"]'); await sleep(300);
  check("…a future date is refused, nothing saved", /in the future/.test(await page.textContent("#pcStatus")) && (await server("soup")).cooks.length === 1);
  const d40 = daysAgo(40);
  await page.fill("#pcDate", d40); await page.selectOption("#pcMult", "2"); await page.click('#sheet [data-act="save"]');
  await page.waitForSelector("#sheet.open #addPastCook"); await sleep(400);
  r = await server("soup");
  const added = r.cooks.find((c) => c.date === d40);
  check("…a cook 40 days ago is saved, marked as added, at the batch picked", r.cooks.length === 2 && added && added.added === true && added.mult === 2 && new Date(added.at).getHours() === 12, JSON.stringify(r.cooks));
  check("…kept in date order, so 'last cooked' is still today", r.cooks[r.cooks.length - 1].date === today && (await page.textContent("#cookStats")).includes(await page.evaluate((t) => fmtDate(t), today)), await page.textContent("#cookStats"));
  check("…the history sheet lists it as added later", /added later/.test(await page.textContent("#sheet .cooks")) && (await page.locator("#sheet .cooks li").count()) === 2);
  const d400 = daysAgo(400);
  await page.click("#addPastCook"); await page.waitForSelector("#sheet.open #pcDate"); await page.fill("#pcDate", d400); await page.click('#sheet [data-act="save"]');
  await page.waitForSelector("#sheet.open #addPastCook"); await sleep(400);
  r = await server("soup");
  check("…any date works, over a year back too, and goes first", r.cooks.length === 3 && r.cooks[0].date === d400 && r.cooks[1].date === d40);
  check("…the Archives count it like any other cook", await page.evaluate(() => timelineEntries().filter((e) => e.recipeId === "soup").length) === 3);
  const acts = await (await fetch(s.url + "/api/admin/activity?cat=content&limit=200")).json();
  check("…logged as a cook added later, with its date, not as a finished cook (the pilot count)",
    acts.some((a) => a.action === "cook_added" && a.target?.includes(d40)) && acts.some((a) => a.action === "cook_added" && a.target?.includes(d400)) && acts.filter((a) => a.action === "cook_logged").length === actBefore,
    JSON.stringify(acts.slice(0, 4)));
  const summary = await (await fetch(s.url + "/api/admin/summary")).json();
  const all = Object.values((await s.state()).recipes).flatMap((x) => x.cooks || []);
  check("…and the owner's view counts it apart", summary.people[0].cooks === all.filter((c) => !c.added).length && summary.people[0].cooks_added === 2, JSON.stringify({ cooks: summary.people[0].cooks, added: summary.people[0].cooks_added }));
  await page.click('#sheet [data-act="done"]');

  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
