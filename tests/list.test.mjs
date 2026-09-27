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
  check("filter: 30 minutes or less", (await filter("quick")) === "CD");

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
  check("cards: Michelin stars shown (3 for Apple pie)", (await page.locator('.rcard[data-id="a"] .mstar').count()) === 3);
  check("cards: 'No stars' and unrated show none", (await page.locator('.rcard[data-id="c"] .mstar').count()) === 0 && (await page.locator('.rcard[data-id="d"] .mstar').count()) === 0);
  check("cards: no cook count anywhere", !/cooked/i.test(await page.textContent("#rlist")));
  check("sort and filter controls are 44px tall", (await page.evaluate(() => Math.min(...[...document.querySelectorAll(".listctl select")].map((x) => x.getBoundingClientRect().height)))) >= 44);
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
