// The Shop tab (2.7.0): the shopping list built from the Plan, in step with the Plan's
// week, from today on for this week, amounts in the recipe's own unit, pantry items
// ticked with a tag, Share list and Clear ticked.
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("shop");
let s, b;
try {
  s = await startServer({ port: 20601 });
  const I = (quantity, unit, item, aisle) => ({ raw_text: `${quantity ?? ""} ${unit} ${item}`.trim(), quantity, unit, item, prep: "", section: "", aisle, optional: false });
  const R = (id, title, servings, ings) => s.put("recipes", id, { title, servings, ingredients: ings, steps: ["Cook."], photos: [], tags: [], created_at: "2026-10-01" });
  await R("bpr", "Beef pepper rice", 2, [I(300, "g", "beef ribeye", "meat & seafood"), I(1, "whole", "onion", "produce"), I(2, "tbsp", "soy sauce", "pantry"), I(1, "tbsp", "honey", "pantry")]);
  await R("curry", "Coconut chicken curry", 4, [I(600, "g", "chicken thigh", "meat & seafood"), I(400, "ml", "coconut milk", "pantry"), I(1, "tbsp", "fish sauce", "pantry"), I(1, "whole", "lime", "produce")]);
  await R("cuke", "Cucumber noodle salad", 2, [I(3, "whole", "mini cucumber", "produce"), I(1, "tbsp", "soy sauce", "pantry"), I(30, "ml", "fish sauce", "pantry"), I(0.75, "l", "water", "other")]);
  await R("soup", "Leek soup", 4, [I(2, "whole", "leek", "produce")]);
  // Today is Tuesday 6 Oct: Monday's meal is behind us, Wednesday's and next week's ahead
  await s.put("plan", "2026-10-05", { date: "2026-10-05", entries: [{ recipeId: "soup", servings: 4 }] });
  await s.put("plan", "2026-10-06", { date: "2026-10-06", entries: [{ recipeId: "curry", servings: 4 }] });
  await s.put("plan", "2026-10-08", { date: "2026-10-08", entries: [{ recipeId: "cuke", servings: 2 }, { recipeId: "bpr", servings: 4 }] });
  await s.put("plan", "2026-10-13", { date: "2026-10-13", entries: [{ recipeId: "soup", servings: 8 }] });
  await s.put("pantry", "p1", { id: "p1", item: "honey", aisle: "pantry" });
  await s.put("pantry", "p2", { id: "p2", item: "Limes", aisle: "produce" }); // not "lime" exactly, but the same item
  // A 1.x shop doc (no `need`, no `checked`) must still open
  await s.put("shop", "2026-09-28", { week: "2026-09-28", items: [] });

  b = await openBrowser();
  const { page, errors } = b;
  await page.clock.setFixedTime(new Date("2026-10-06T09:00:00"));
  await openApp(page, s.url);
  await page.click('#tabs button[data-view="shop"]');
  const shop = () => page.evaluate(() => ({
    week: document.getElementById("shopWeekTitle").textContent, current: document.querySelector("#view-shop .weeknav").classList.contains("current"),
    sub: document.getElementById("shopSub")?.textContent ?? null, meals: /meals? planned/.test(document.getElementById("view-shop").textContent),
    aisles: [...document.querySelectorAll("#shopList .aisle h3")].map((h) => h.textContent),
    rows: Object.fromEntries([...document.querySelectorAll("#shopList .item")].map((r) => [[...r.querySelector(".lbl").childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(), {
      q: r.querySelector(".q")?.textContent || "", from: r.querySelector(".from")?.textContent || "", done: r.querySelector("input").checked, pantry: !!r.querySelector(".ptag") }])),
    text: document.getElementById("shopList").textContent }));

  // --- built from the Plan, this week from today on
  let v = await shop();
  check("the Shop tab opens on this week, marked like the Plan's", v.week === "5 Oct – 11 Oct" && v.current && (await page.evaluate(() => document.querySelector("#tabs button.on").dataset.view)) === "shop", JSON.stringify(v.week));
  check("…from today: Monday's leek soup isn't on it; Tuesday's and Wednesday's meals are", !/leek/.test(v.text) && /chicken thigh/.test(v.text) && /mini cucumber/.test(v.text), v.text.slice(0, 200));
  check("2.7.3: no 'From today · 3 meals planned' line under the dates", v.sub === null && !v.meals, String(v.sub));
  check("grouped by aisle in shop order", v.aisles.join() === "Produce,Meat & seafood,Pantry,Other", v.aisles.join());
  check("each item says which recipes it's for", v.rows["soy sauce"]?.from === "Cucumber noodle salad, Beef pepper rice", JSON.stringify(v.rows["soy sauce"]));
  check("amounts are scaled to the serves planned (beef for 4, not 2)", v.rows["beef ribeye"]?.q === "600 g", JSON.stringify(v.rows["beef ribeye"]));
  check("…in the recipe's own unit when every recipe uses it: 1 + 4 tbsp soy sauce is 5 tbsp, not 75 ml", v.rows["soy sauce"]?.q === "5 tbsp", JSON.stringify(v.rows["soy sauce"]));
  check("…added up in ml when the units differ (1 tbsp + 30 ml fish sauce = 45 ml)", v.rows["fish sauce"]?.q === "45 ml", JSON.stringify(v.rows["fish sauce"]));
  check("…litres show as L", v.rows["water"]?.q === "0.75 L" || v.rows["water"]?.q === "¾ L", JSON.stringify(v.rows["water"]));

  // --- pantry items: in their aisle, ticked, tagged; untick to buy
  check("pantry items stay in their aisle, ticked, with a 'from pantry' tag (honey; 'Limes' matches 'lime')", v.rows["honey"]?.done && v.rows["honey"]?.pantry && v.rows["lime"]?.done && v.rows["lime"]?.pantry && !v.rows["soy sauce"]?.pantry, JSON.stringify([v.rows.honey, v.rows.lime]));
  const tag = await page.evaluate(() => { const t = document.querySelector("#shopList .ptag"), row = t.closest(".item"); return { display: getComputedStyle(t).display, rowDone: row.classList.contains("done"), strike: getComputedStyle(row.querySelector(".lbl")).textDecorationLine }; });
  check("…the item is struck through but the tag isn't (it's inline-block)", tag.rowDone && tag.strike === "line-through" && tag.display === "inline-block", JSON.stringify(tag));
  await page.locator('#shopList .item:has-text("honey") input').uncheck(); await sleep(400);
  let doc = (await s.state()).shop["2026-10-05"];
  check("unticking a pantry item puts it back on the list, and the server keeps that", !(await shop()).rows.honey.done && doc?.need?.["honey|vol"] === true && !doc.checked?.["honey|vol"], JSON.stringify(doc));
  await page.reload(); await page.waitForFunction(() => !store.loading); await page.click('#tabs button[data-view="shop"]');
  check("…still unticked after a reload", (await shop()).rows.honey.done === false);

  // --- ticking, adding by hand, Clear ticked
  await page.locator('#shopList .item:has-text("onion") input').check(); await sleep(400);
  doc = (await s.state()).shop["2026-10-05"];
  check("ticking an item saves it", doc?.checked?.["onion|count:whole"] === true, JSON.stringify(doc?.checked));
  await page.fill("#manualItem", "2 lemons"); await page.press("#manualItem", "Enter"); await sleep(400);
  v = await shop();
  check("'Add something else' adds it to its aisle (lemons in Produce)", /2\s*lemons/.test(await page.textContent("#shopList .aisle:first-child")), await page.textContent("#shopList .aisle:first-child"));
  await page.locator('#shopList .item:has-text("lemons") input').check(); await sleep(300);
  // honey was unticked above; tick it again to check Clear ticked leaves pantry items alone
  await page.locator('#shopList .item:has-text("honey") input').check(); await sleep(300);
  await page.click("#clearChecked"); await sleep(400);
  v = await shop();
  check("Clear ticked unticks what you ticked yourself (onion, lemons) but not the pantry (honey, lime)", !v.rows.onion.done && !v.rows["lemons"]?.done && v.rows.honey.done && v.rows.lime.done, JSON.stringify([v.rows.onion, v.rows.lemons, v.rows.honey]));
  check("…with Undo", await page.isVisible("#toast .toast-btn"));
  await page.click("#toast .toast-btn"); await sleep(400);
  v = await shop();
  check("…which puts the ticks back", v.rows.onion.done && v.rows.lemons.done && (await s.state()).shop["2026-10-05"].checked["onion|count:whole"] === true);
  await page.locator('#shopList .item:has-text("lemons") .x').click(); await sleep(400);
  check("× removes something you added", !/lemons/.test((await shop()).text) && !(await s.state()).shop["2026-10-05"].manual.length);

  // --- Share list
  await page.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d; }; });
  await page.click("#shareList"); await sleep(200);
  const shared = await page.evaluate(() => window.__shared);
  check("Share list shares what's left to buy, by aisle, with amounts", shared && /^Shopping list, 5 Oct – 11 Oct/.test(shared.text) && /\nProduce\n- 3 mini cucumber/.test(shared.text) && /- 5 tbsp soy sauce/.test(shared.text), JSON.stringify(shared));
  check("…without what's ticked or in the pantry", !/onion|honey|lime/.test(shared.text), shared?.text);
  await page.evaluate(() => { delete navigator.share; Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); window.__copied = null; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true }); });
  await page.click("#shareList"); await sleep(200);
  check("…and copies it where the phone can't share", (await page.evaluate(() => window.__copied)) === shared.text && /copied/i.test(await page.textContent("#toast")));

  // --- the same week as the Plan
  await page.click('#view-shop [data-week="1"]'); await sleep(300);
  v = await shop();
  check("› goes to next week, in full: 'Leek soup' for 8, nothing 'from today'", v.week === "12 Oct – 18 Oct" && !v.current && v.rows.leek?.q === "4" && !v.meals, JSON.stringify([v.week, v.rows.leek]));
  await page.click('#tabs button[data-view="plan"]');
  check("…and the Plan is on that week too", (await page.textContent("#weekTitle")) === "12 Oct – 18 Oct");
  await page.click("#prevWeek"); await page.click("#prevWeek"); await page.click('#tabs button[data-view="shop"]');
  check("moving the Plan's week moves the Shop's", (await shop()).week === "28 Sept – 4 Oct" || (await shop()).week === "28 Sep – 4 Oct", (await shop()).week);
  v = await shop();
  check("a week with nothing planned (and a 1.x list) says what to do", /Nothing to buy yet/.test(v.text) && /Plan some meals/.test(v.text), v.text);
  await page.click('#view-shop [data-week="0"]');
  check("tapping the dates comes back to this week", (await shop()).current);

  // --- the owner's activity log: the week, never what's on the list
  const act = await (await fetch(s.url + "/api/admin/activity?cat=content")).json();
  const shopActs = act.filter((a) => a.action === "shop_changed");
  check("a shopping list change is logged by week only", shopActs.some((a) => a.target === "2026-10-05") && shopActs.every((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.target)), JSON.stringify(shopActs.slice(0, 3)));

  // --- nothing hidden behind the tab bar: Share list and Clear ticked can be reached
  const reach = await page.evaluate(async () => { const m = document.getElementById("main"); m.scrollTop = m.scrollHeight; await new Promise((r) => setTimeout(r, 100));
    const tabs = document.getElementById("tabs").getBoundingClientRect(), btn = document.getElementById("clearChecked").getBoundingClientRect(); return { btnBottom: Math.round(btn.bottom), tabsTop: Math.round(tabs.top), h: Math.round(btn.height) }; });
  check("Share list and Clear ticked sit above the tab bar at the bottom of the list, 44px tall", reach.btnBottom <= reach.tabsTop && reach.h >= 44, JSON.stringify(reach));

  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
