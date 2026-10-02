// The review / edit form: the description can be edited, and tapping Save twice on
// a slow connection saves one recipe, not two.
import { suite, startServer, slowProxy, openBrowser, openApp, sleep, addRecipe } from "./lib.mjs";

const { check, finish } = suite("review form");
let s, px, b;
try {
  s = await startServer({ port: 18701 });
  px = slowProxy({ port: 18702, target: 18701 });
  b = await openBrowser();
  const { page, errors } = b;
  await s.put("recipes", "r1", { title: "Leek soup", description: "Old description", servings: 2, ingredients: [{ item: "leek", quantity: 2, unit: "whole", raw_text: "2 leeks" }], steps: ["Cook."], photos: [], tags: [], created_at: "2026-09-01" });
  await openApp(page, px.url);

  // --- description is editable and survives a save
  await page.click('.rcard:has-text("Leek soup")'); await page.click("#edit");
  check("edit form shows the description", (await page.inputValue("#fDesc")) === "Old description");
  await page.fill("#fDesc", "Silky, peppery, ready in 30 minutes.");
  await page.click("#revSave"); await page.waitForSelector("#view-detail h2");
  check("new description shown on the recipe", /Silky, peppery/.test(await page.textContent("#view-detail")));
  check("new description saved on the server", (await s.state()).recipes.r1.description === "Silky, peppery, ready in 30 minutes.");
  check("rest of the recipe untouched", (await s.state()).recipes.r1.ingredients[0].raw_text === "2 leeks");

  // --- a new recipe starts with an empty description box
  await addRecipe(page, "manual");
  check("new recipe: empty description box", (await page.inputValue("#fDesc")) === "");

  // --- double tap on Save while the connection is slow
  await page.fill("#fTitle", "Double tap stew"); await page.locator(".ingrow [data-f=item]").first().fill("beef");
  px.delays.write = 2500;
  await page.click("#revSave");
  const disabled = await page.evaluate(() => ({ a: document.querySelector("#revSave").disabled, b: document.querySelector("#revSave2").disabled, t: document.querySelector("#revSave").textContent }));
  check("Save buttons disable and say 'Saving…'", disabled.a && disabled.b && disabled.t === "Saving…", JSON.stringify(disabled));
  await page.evaluate(() => { document.querySelector("#revSave").click(); document.querySelector("#revSave2").click(); }); // even a forced second tap
  await page.waitForSelector("#view-detail h2", { timeout: 10000 }); px.delays.write = 0; await sleep(500);
  const copies = Object.values((await s.state()).recipes).filter((r) => r.title === "Double tap stew").length;
  check("only one recipe saved", copies === 1, copies + " copies");
  check("only one on the phone too", (await page.evaluate(() => Object.values(state.recipes).filter((r) => r.title === "Double tap stew").length)) === 1);

  // --- units (2.4): litres read "L", and "drizzle" is a unit
  await s.put("recipes", "units", { title: "Unit soup", servings: 2, ingredients: [{ raw_text: "1.5 l stock", quantity: 1.5, unit: "l", item: "chicken stock" }, { raw_text: "a drizzle of olive oil", quantity: null, unit: "drizzle", item: "olive oil" }], steps: ["Simmer."], photos: [] });
  await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.evaluate(() => { state.detailId = "units"; state.mult = 1; show("detail"); }); await page.waitForSelector("#view-detail #ingList li");
  const ings = await page.$$eval("#view-detail #ingList li", (xs) => xs.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  check("a recipe shows litres as L and a drizzle as a drizzle", ings[0] === "1½ L chicken stock" && ings[1] === "drizzle olive oil", JSON.stringify(ings));
  await page.click('#view-detail button:has-text("Edit")'); await page.waitForSelector(".ingrow [data-f=unit]");
  const opts = await page.$eval(".ingrow [data-f=unit]", (sel) => ({ shown: sel.options[sel.selectedIndex].textContent, value: sel.value, all: [...sel.options].map((o) => o.textContent) }));
  check("the edit form offers L (still stored as l) and drizzle", opts.shown === "L" && opts.value === "l" && opts.all.includes("drizzle") && !opts.all.includes("l"), JSON.stringify(opts));

  // --- ingredients are saved lowercase (2.5.1)
  await page.goto(px.url); await page.waitForFunction(() => !store.loading);
  await addRecipe(page, "manual");
  check("ingredient boxes don't capitalise as you type", await page.$eval(".ingrow [data-f=item]", (i) => i.getAttribute("autocapitalize") === "none") && await page.$eval(".ingrow [data-f=prep]", (i) => i.getAttribute("autocapitalize") === "none"));
  await page.fill("#fTitle", "Shouty Salad"); await page.locator(".ingrow [data-f=item]").first().fill("Baby SPINACH"); await page.locator(".ingrow [data-f=prep]").first().fill("Washed");
  await page.click("#revSave"); await page.waitForSelector("#view-detail h2");
  const shouty = Object.values((await s.state()).recipes).find((r) => r.title === "Shouty Salad");
  check("typed in capitals, saved lowercase", shouty?.ingredients[0].item === "baby spinach" && shouty.ingredients[0].prep === "washed", JSON.stringify(shouty?.ingredients));
  check("…and shown lowercase", /baby spinach/.test(await page.textContent("#view-detail #ingList")) && !/SPINACH/.test(await page.textContent("#view-detail #ingList")));
  await page.evaluate(() => store.put("recipes", "imp", { title: "From elsewhere", ingredients: [{ raw_text: "2 Large EGGS", item: "Large EGGS", prep: "Beaten", quantity: 2 }, { item: 5 }, null] }));
  const imp = (await s.state()).recipes.imp;
  check("any recipe write lowercases names and prep, keeps the line as written", imp.ingredients[0].item === "large eggs" && imp.ingredients[0].prep === "beaten" && imp.ingredients[0].raw_text === "2 Large EGGS" && imp.ingredients[1].item === 5, JSON.stringify(imp.ingredients));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); px?.close(); await s?.cleanup(); }
