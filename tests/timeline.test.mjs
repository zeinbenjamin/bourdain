// Archives tab (1.9.0 as "Timeline", renamed in 1.10.0; the view is still "timeline" inside): stats and a feed of every finished cook, read from recipe.cooks.
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("timeline");
let s, b;
try {
  s = await startServer({ port: 19401 });
  b = await openBrowser();
  const { page, errors } = b;
  const today = new Date();
  const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const ago = (n, extra = {}) => { const x = new Date(today); x.setDate(x.getDate() - n); x.setHours(19, 0, 0, 0); return { date: ymd(x), at: x.toISOString(), mult: 1, ...extra }; };

  // --- empty
  await openApp(page, s.url);
  check("the tab is called Archives", (await page.textContent('#tabs button[data-view="timeline"]')).trim() === "Archives");
  await page.click('#tabs button[data-view="timeline"]');
  check("empty: says how cooks get here", /Nothing cooked yet/.test(await page.textContent("#view-timeline")) && /Cook this/.test(await page.textContent("#view-timeline")));
  await page.evaluate(() => { store.loading = true; renderTimeline(); });
  check("while loading: 'Loading your cooks…', not 'Nothing cooked yet'", /Loading your cooks/.test(await page.textContent("#view-timeline")));

  // --- with cooks
  const cooks = {
    soup: [ago(400), ago(12), ago(1, { mult: 2 })],
    katsu: [ago(1), ago(3)],
    rice: [ago(0)],
    stew: [ago(20), ago(21), ago(22), ago(23)],
    toast: [ago(2), ago(4)],
  };
  await s.put("recipes", "soup", { title: "Leek soup", rating: 2, ingredients: [], steps: ["Simmer."], photos: [], cooks: cooks.soup });
  await s.put("recipes", "katsu", { title: "Chicken katsu curry", rating: 3, ingredients: [], steps: [], photos: [], cooks: cooks.katsu });
  await s.put("recipes", "rice", { ingredients: [], steps: [], photos: [], cooks: [...cooks.rice, null, { mult: 1 }] }); // no title; junk entries
  await s.put("recipes", "stew", { title: "Beef stew", ingredients: [], steps: [], photos: [], cooks: cooks.stew });
  await s.put("recipes", "toast", { title: "Cheese toast", ingredients: [], steps: [], photos: [], cooks: cooks.toast });
  await s.put("recipes", "never", { title: "Never made", ingredients: [], steps: [], photos: [] });
  await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.click('#tabs button[data-view="timeline"]');

  const all = Object.values(cooks).flat();
  const ym = ymd(today).slice(0, 7), yr = ym.slice(0, 4);
  const stats = await page.$$eval(".stat", (xs) => xs.map((x) => x.querySelector("b").textContent.replace(/\s+/g, "")));
  check("stats: this month", stats[0] === String(all.filter((c) => c.date.startsWith(ym)).length), stats.join(" | "));
  check("stats: this year", stats[1] === String(all.filter((c) => c.date.startsWith(yr)).length), stats.join(" | "));
  check("stats: recipes tried 5 of 6", stats[2] === "5/6", stats[2]);

  const top = await page.$$eval(".tl-top .slot", (xs) => xs.map((x) => [x.dataset.open, x.querySelector(".n").textContent]));
  check("most cooked: top 3, most first, counts shown", JSON.stringify(top.map((t) => t[0])) === JSON.stringify(["stew", "soup", top[2]?.[0]]) && top.length === 3 && top[0][1] === "4×" && top[1][1] === "3×" && top[2][1] === "2×" && ["katsu", "toast"].includes(top[2][0]), JSON.stringify(top));
  check("most cooked: tie broken by most recent (katsu yesterday beats toast 2 days ago)", top[2][0] === "katsu", JSON.stringify(top));

  const feed = await page.evaluate(() => [...document.querySelectorAll(".feed .day")].map((d) => ({ d: d.querySelector(".d").textContent, ids: [...d.querySelectorAll("[data-open]")].map((x) => x.dataset.open) })));
  const days = [...new Set(all.map((c) => c.date))].sort().reverse();
  check("feed: one row per day, newest first", feed.length === days.length && feed.map((f) => f.d).join() === days.map((d) => String(+d.slice(8))).join(), JSON.stringify(feed.map((f) => f.d)));
  check("feed: two cooks on the same day share a row", feed[1].ids.length === 2 && feed[1].ids.includes("soup") && feed[1].ids.includes("katsu"), JSON.stringify(feed[1]));
  check("feed: every cook listed once", feed.reduce((n, f) => n + f.ids.length, 0) === all.length);
  const heads = await page.$$eval(".tl-head", (hs) => hs.map((h) => h.textContent));
  const lastYear = new Date(today); lastYear.setDate(lastYear.getDate() - 400);
  const longMonth = (x) => x.toLocaleString("en-GB", { month: "long" });
  check("month headings: this year's without the year, older ones with it", heads[0] === "Most cooked" && heads[1].toLowerCase() === longMonth(today).toLowerCase() && heads[heads.length - 1].toLowerCase() === `${longMonth(lastYear)} ${lastYear.getFullYear()}`.toLowerCase(), heads.join(" | "));
  const soupRow = await page.textContent('.feed .day:nth-of-type(2) [data-open="soup"]');
  check("feed: batch size shown when it wasn't 1×", /2× batch/.test(soupRow), soupRow);
  check("feed: stars drawn as Michelin stars, never ★", (await page.locator('.feed [data-open="katsu"]').first().locator('svg.mstar').count()) === 3 && !(await page.textContent("#view-timeline")).includes("★"));
  check("feed: a recipe without a title shows 'Untitled'", /Untitled/.test(await page.textContent('.feed [data-open="rice"]')));
  check("feed: recipes never cooked aren't listed", (await page.locator('#view-timeline [data-open="never"]').count()) === 0);

  // --- layout
  const lay = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, head: document.querySelector("header.top").getBoundingClientRect().height, slots: [...document.querySelectorAll("#view-timeline .slot")].map((x) => x.getBoundingClientRect().height) }));
  await page.click('#tabs button[data-view="recipes"]');
  const headRecipes = await page.evaluate(() => document.querySelector("header.top").getBoundingClientRect().height);
  check("layout: no sideways scroll, header the same height as on Recipes", lay.over <= 0 && Math.abs(lay.head - headRecipes) < 1, JSON.stringify({ over: lay.over, head: lay.head, headRecipes }));
  check("layout: every entry is at least 44px tall", lay.slots.every((h) => h >= 44));

  // --- open a recipe from the timeline
  await page.click('#tabs button[data-view="timeline"]');
  await page.click('.feed [data-open="katsu"]');
  check("tap opens the recipe", /Chicken katsu curry/.test(await page.textContent("#view-detail h2")));
  check("recipe opened from the Archives: '‹ Archives' and Archives tab lit", (await page.textContent("#back")).trim() === "‹ Archives" && (await page.evaluate(() => document.querySelector("#tabs button.on").dataset.view)) === "timeline");
  await page.click("#back");
  check("Back returns to the timeline", await page.isVisible("#view-timeline") && await page.isVisible(".stats"));
  await page.click('#tabs button[data-view="recipes"]'); await page.click('.rcard[data-id="katsu"]');
  check("from Recipes it still says '‹ Recipes'", (await page.textContent("#back")).trim() === "‹ Recipes");

  // --- a finished cook shows up, a removed one goes
  await page.click('#tabs button[data-view="timeline"]'); await page.click('.tl-top [data-open="soup"]');
  await page.click("#cookThis"); await page.click("#cookFinish");
  await page.waitForSelector('#sheet.open [data-act="save"]'); await page.click('#sheet [data-act="save"]'); await sleep(500);
  await page.click('#tabs button[data-view="timeline"]');
  const firstDay = await page.evaluate(() => [...document.querySelector(".feed .day").querySelectorAll("[data-open]")].map((x) => x.dataset.open));
  check("finishing a cook puts it at the top, today", firstDay.includes("soup") && firstDay.includes("rice"), JSON.stringify(firstDay));
  check("most cooked updates (soup now 4×)", /4×/.test(await page.textContent('.tl-top [data-open="soup"]')));
  await page.click('.tl-top [data-open="soup"]'); await page.click("#cookStats");
  await page.waitForSelector('#sheet.open [data-act="rm"]');
  await page.locator('#sheet [data-act="rm"]').first().click(); await sleep(500);
  await page.evaluate(() => closeSheet()); await page.click("#back");
  const firstDay2 = await page.evaluate(() => [...document.querySelector(".feed .day").querySelectorAll("[data-open]")].map((x) => x.dataset.open));
  check("removing a date from the cook log takes it off the timeline", !firstDay2.includes("soup"), JSON.stringify(firstDay2));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
