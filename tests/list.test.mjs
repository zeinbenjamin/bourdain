// The recipe list: sort and filter, combined with search and tags, remembered on
// this phone; cards show Michelin stars but not the cook count.
import { suite, startServer, openBrowser, openApp } from "./lib.mjs";

const { check, finish } = suite("recipe list");
let s, b;
try {
  s = await startServer({ port: 19001 });
  b = await openBrowser();
  const { page, errors } = b;
  const R = (id, title, o) => s.put("recipes", id, { title, ingredients: [], steps: [], photos: [], tags: [], ...o });
  await R("a", "Apple pie", { created_at: "2026-09-01", rating: 3, prep_min: 30, cook_min: 50, cooks: [{ date: "2026-09-10", at: "2026-09-10T18:00:00Z" }], tags: ["dessert"] });
  await R("b", "Beef ragù", { created_at: "2026-09-02", rating: 1, prep_min: 10, cook_min: 120, cooks: [{ date: "2026-09-05", at: "2026-09-05T18:00:00Z" }, { date: "2026-09-20", at: "2026-09-20T18:00:00Z" }, { date: "2026-09-25", at: "2026-09-25T18:00:00Z" }] });
  await R("c", "Caesar salad", { created_at: "2026-09-03", rating: 0, prep_min: 15, cook_min: 0, tags: ["salad"] });
  await R("d", "Dal", { created_at: "2026-09-04", prep_min: 5, cook_min: 20, cooks: [{ date: "2026-09-26", at: "2026-09-26T12:00:00Z" }], tags: ["weeknight"] });
  await R("e", "Eggs benedict", { created_at: "2026-09-05", rating: 2 });
  await openApp(page, s.url);
  const order = () => page.$$eval(".rcard h3", (hs) => hs.map((h) => h.textContent[0]).join(""));
  const sort = async (v) => { await page.selectOption("#sortBy", v); return order(); };
  const filter = async (v) => { await page.selectOption("#filterBy", v); return order(); };

  check("default: newest first", (await order()) === "EDCBA", await order());
  check("A to Z", (await sort("az")) === "ABCDE");
  check("most Michelin stars (no stars before not rated)", (await sort("stars")) === "AEBCD", await order());
  check("most cooked", (await sort("most")) === "BADCE", await order());
  check("recently cooked", (await sort("recent")) === "DBACE", await order());
  check("quickest (no time given last)", (await sort("quick")) === "CDABE", await order());

  await sort("az");
  check("filter: 1 star or more", (await filter("s1")) === "ABE");
  check("filter: 2 stars or more", (await filter("s2")) === "AE");
  check("filter: 3 stars", (await filter("s3")) === "A");
  check("filter: not rated yet", (await filter("unrated")) === "D");
  check("filter: never cooked", (await filter("never")) === "CE");
  check("filter: no '30 minutes or less' option any more (1.9.2)", !(await page.$$eval("#filterBy option", (os) => os.some((o) => o.value === "quick" || /30 minutes/.test(o.textContent)))));
  check("sort: 'Quickest' is still there", await page.$$eval("#sortBy option", (os) => os.some((o) => o.value === "quick")));

  // --- 2.6.0: grid or list, remembered on this phone, for every recipe list
  const view = () => page.evaluate(() => ({ list: document.body.classList.contains("aslist"), cols: getComputedStyle(document.getElementById("rlist")).gridTemplateColumns.split(" ").length, tags: getComputedStyle(document.querySelector("#rlist .rcard .tags")).display, pressed: document.getElementById("viewTog").dataset.view }));
  await page.selectOption("#filterBy", "all");
  let v = await view();
  check("view: grid by default, two across", !v.list && v.cols === 2 && v.pressed === "grid", JSON.stringify(v));
  await page.click('#viewTog[data-as="list"]'); v = await view();
  check("view: list is one per row, without tags", v.list && v.cols === 1 && v.tags === "none" && v.pressed === "list", JSON.stringify(v));
  check("…and doesn't change the sort or filter", (await order()) === "ABCDE", await order());
  await page.reload(); await page.waitForSelector("#rlist .rcard"); v = await view();
  check("view: remembered after a reload", v.list && JSON.parse(await page.evaluate(() => localStorage.getItem("bourdain.listPrefs"))).view === "list");
  await page.evaluate(() => { localStorage.setItem("bourdain.listPrefs", JSON.stringify({ sort: "az", filter: "all", view: "tiles" })); syncListCtl(); }); v = await view();
  check("view: a saved view that isn't an option falls back to grid", !v.list && v.pressed === "grid");
  await page.click('#viewTog[data-as="list"]');
  await page.evaluate(() => { document.getElementById("others").innerHTML = `<div class="rlist" id="otherList">${cardHtml({ title: "Someone's soup", tags: ["x"] }, "")}</div>`; });
  check("view: other people's books and search hits follow it too", await page.evaluate(() => getComputedStyle(document.getElementById("otherList")).gridTemplateColumns.split(" ").length === 1));
  await page.evaluate(() => { document.getElementById("others").innerHTML = ""; });
  await page.click('#viewTog[data-as="grid"]');  await page.evaluate(() => localStorage.setItem("bourdain.listPrefs", JSON.stringify({ sort: "az", filter: "quick" })));
  await page.reload(); await page.waitForFunction(() => !store.loading);
  check("a phone that had '30 minutes or less' saved shows All recipes", (await page.inputValue("#filterBy")) === "all" && (await page.inputValue("#sortBy")) === "az" && (await order()) === "ABCDE", `${await page.inputValue("#filterBy")} ${await order()}`);

  // combines with tags and search
  await filter("all"); await page.click('.chip:has-text("weeknight")');
  check("tag chip still narrows the list", (await order()) === "D");
  await page.click('.chip:has-text("weeknight")');
  await page.fill("#search", "e"); await filter("s2");
  check("search + filter combine", (await order()) === "AE", await order());
  await page.fill("#search", "");

  // nothing matches -> a way back
  await page.fill("#search", "zzz"); await filter("s3");
  check("no matches: 'Show all recipes' button when a filter is on", await page.locator("[data-reset]").isVisible());
  await page.click("[data-reset]"); await page.fill("#search", "");
  check("'Show all recipes' clears the filter", (await page.inputValue("#filterBy")) === "all" && (await order()).length === 5);

  // remembered on this phone
  await sort("most"); await filter("s1"); await page.reload(); await page.waitForFunction(() => !store.loading);
  check("sort and filter remembered after a reload", (await page.inputValue("#sortBy")) === "most" && (await page.inputValue("#filterBy")) === "s1" && (await order()) === "BAE");

  // cards
  await filter("all");
  check("cards: Michelin stars shown (3 for Apple pie)", (await page.locator('.rcard[data-id="a"] .cstars .mstar').count()) === 3);
  check("cards: 'No stars' and unrated show none", (await page.locator('.rcard[data-id="c"] .mstar').count()) === 0 && (await page.locator('.rcard[data-id="d"] .mstar').count()) === 0);
  check("cards: no cook count anywhere", !/cooked/i.test(await page.textContent("#rlist")));
  const rows = (id) => page.$$eval(`.rcard[data-id="${id}"] .body > *`, (els) => els.map((e) => e.className || e.tagName.toLowerCase()));
  check("starred card: title, stars row, details row, tags, in that order", JSON.stringify(await rows("a")) === '["h3","cstars","meta","tags"]', JSON.stringify(await rows("a")));
  check("stars and details on separate lines", await page.evaluate(() => { const c = document.querySelector('.rcard[data-id="a"]'); return c.querySelector(".cstars").getBoundingClientRect().bottom <= c.querySelector(".meta").getBoundingClientRect().top + 1; }));
  check("details row has no stars inside it", (await page.locator('.rcard[data-id="a"] .meta .mstar').count()) === 0 && /80 min/.test(await page.textContent('.rcard[data-id="a"] .meta')));
  check("unstarred card: no stars row at all", JSON.stringify(await rows("d")) === '["h3","meta","tags"]' && JSON.stringify(await rows("c")) === '["h3","meta","tags"]', JSON.stringify(await rows("d")));
  check("sort and filter controls are 44px tall", (await page.evaluate(() => Math.min(...[...document.querySelectorAll(".listctl select")].map((x) => x.getBoundingClientRect().height)))) >= 44);
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
