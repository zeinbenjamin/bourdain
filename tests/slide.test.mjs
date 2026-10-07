// Slide to choose (2.8.0): press the tab bar, or Everyone / Just me in the Archives, and
// slide. A pill follows the finger inside the bar's own padding, the button under it
// lights, and letting go chooses. Taps, scrolling and a redraw mid-slide still behave.
import Database from "better-sqlite3";
import path from "node:path";
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("slide");
let s, b;
try {
  s = await startServer({ port: 20961 });
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await s.put("recipes", "soup", { title: "Leek soup", servings: 2, ingredients: [{ item: "leek", quantity: 2, unit: "whole" }], steps: ["Soften."], photos: [], tags: [], cooks: [{ date: today, at: d.toISOString(), mult: 1 }], created_at: "2026-09-01" });
  // someone else with a name, so the Archives show Everyone / Just me
  const db = new Database(path.join(s.data, "bourdain.db"));
  db.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('sam', 'sam@example.com', 'Sam Lee', datetime())").run();
  db.prepare("INSERT INTO recipes (owner, id, doc, updated_at) VALUES ('sam', 'dal', ?, datetime())").run(JSON.stringify({ title: "Tarka dal", ingredients: [{ item: "lentils" }], steps: [], photos: [], cooks: [{ date: today, at: d.toISOString(), mult: 1 }] }));
  db.close();

  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  const M = page.mouse, view = () => page.evaluate(() => state.view);
  const at = (sel) => page.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, r: r.right }; }, sel);
  const press = async (x, y) => { await M.move(x, y); await M.down(); await sleep(60); };
  const glide = async (x0, x1, y, dy = 0) => { for (let k = 1; k <= 12; k++) { await M.move(x0 + (x1 - x0) * k / 12, y + dy * k / 12); await sleep(16); } };
  const gaps = (sel) => page.evaluate((q) => { const box = document.querySelector(q), p = box.querySelector(".slidepill")?.getBoundingClientRect(), r = box.getBoundingClientRect(), bw = box.clientLeft;
    return p && { top: Math.round(p.top - r.top - bw), bottom: Math.round(r.bottom - bw - p.bottom), left: Math.round(p.left - r.left - bw), right: Math.round(r.right - bw - p.right) }; }, sel);

  // --- the tab bar
  const rec = await at('#tabs [data-view="recipes"]'), shop = await at('#tabs [data-view="shop"]'), bar = await at("#tabs");
  await press(rec.x, rec.y); await glide(rec.x, shop.x, rec.y);
  const mid = await page.evaluate(() => ({ pill: !!document.querySelector("#tabs .slidepill"), near: document.querySelector("#tabs button.near")?.dataset.view, view: state.view }));
  check("sliding from Recipes to Shop: a pill follows, Shop lights up, nothing opens yet", mid.pill && mid.near === "shop" && mid.view === "recipes", JSON.stringify(mid));
  await M.up(); await sleep(400);
  check("…letting go opens Shop, and the pill is gone (the tab draws itself again)", (await view()) === "shop" && !(await page.evaluate(() => document.querySelector(".slidepill, .sliding"))));
  // the pill's gap from the bar's edge at each end is the same as above and below it
  await press(shop.x, shop.y); await glide(shop.x, bar.l - 30, shop.y);
  const left = await gaps("#tabs"); await M.up(); await sleep(400);
  check("…slid past the left end, the pill keeps the bar's 6px on all four sides", left && left.left === 6 && left.top === 6 && left.bottom === 6, JSON.stringify(left));
  check("…and letting go there opens Plan", (await view()) === "plan");
  const plan = await at('#tabs [data-view="plan"]');
  await press(plan.x, plan.y); await glide(plan.x, bar.r + 30, plan.y);
  const right = await gaps("#tabs"); await M.up(); await sleep(400);
  check("…and past the right end too (6px), opening Archives", right && right.right === 6 && right.top === 6 && (await view()) === "timeline", JSON.stringify(right));
  const pantry = await at('#tabs [data-view="pantry"]');
  await page.mouse.click(pantry.x, pantry.y); await sleep(300);
  check("a plain tap still opens a tab", (await view()) === "pantry");
  const tl = await at('#tabs [data-view="timeline"]');
  await press(pantry.x, pantry.y); await glide(pantry.x, tl.x, pantry.y); await glide(tl.x, pantry.x, pantry.y); await M.up(); await sleep(400);
  check("sliding away and back to where you started changes nothing", (await view()) === "pantry");
  const sz = await page.evaluate(() => { const nav = document.getElementById("tabs"); return getComputedStyle(nav).touchAction; });
  check("the bar keeps the gesture to itself (touch-action: none), so the page doesn't scroll under it", sz === "none", sz);

  // --- Everyone / Just me
  await page.mouse.click(tl.x, tl.y); await page.waitForSelector("#view-timeline .seg"); await sleep(300);
  const who = () => page.evaluate(() => document.querySelector(".seg button.on")?.dataset.who);
  const ev = await at('.seg [data-who="everyone"]'), me = await at('.seg [data-who="me"]'), seg = await at(".seg");
  check("the Archives open on Everyone", (await who()) === "everyone");
  await press(ev.x, ev.y); await glide(ev.x, seg.r + 30, ev.y);
  const segRight = await gaps(".seg"); await M.up(); await sleep(400);
  check("sliding Everyone → Just me switches, and is remembered on the phone", (await who()) === "me" && (await page.evaluate(() => localStorage.getItem("bourdain.archivesWho"))) === "me");
  check("…its pill keeps the switch's 3px on all sides at the end", segRight && segRight.right === 3 && segRight.top === 3 && segRight.bottom === 3, JSON.stringify(segRight));
  await page.mouse.click(ev.x, ev.y); await sleep(300);
  check("…a tap still switches back", (await who()) === "everyone");
  await press(ev.x, ev.y); await glide(ev.x, ev.x + 14, ev.y, -80); await M.up(); await sleep(300);
  check("a mostly up-and-down drag that starts on the switch is a scroll, not a choice", (await who()) === "everyone" && !(await page.evaluate(() => document.querySelector(".seg.sliding"))));
  // the Archives redraw while you slide (the feed arrives): the slide carries on with the new switch
  await press(ev.x, ev.y); await glide(ev.x, ev.x + 40, ev.y);
  await page.evaluate(() => { const el = document.querySelector(".seg"); el.replaceWith(el.cloneNode(true)); });
  await glide(ev.x + 40, me.x, ev.y); await M.up(); await sleep(400);
  check("…a redraw mid-slide doesn't lose it: letting go on Just me still switches", (await who()) === "me" && !(await page.evaluate(() => document.querySelector(".slidepill"))));

  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
