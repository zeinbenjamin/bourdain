// Recipe · Metric · US units (2.9.0): the switch on a recipe, remembered on the phone and
// followed by cook mode; grams for dry goods in Metric; plurals for counts ("4 cloves");
// and a recipe opened from the Plan at the servings planned.
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("units");
let s, b;
try {
  s = await startServer({ port: 20711 });
  const I = (quantity, unit, item) => ({ raw_text: `${quantity ?? ""} ${unit} ${item}`.trim(), quantity, unit, item, prep: "", section: "", aisle: "other", optional: false });
  await s.put("recipes", "rendang", { title: "Beef rendang", servings: 6, steps: ["Brown the beef.", "Simmer."], photos: [], tags: [], created_at: "2026-10-01",
    ingredients: [I(1.2, "kg", "beef chuck"), I(400, "ml", "coconut milk"), I(2, "cup", "rice"), I(1, "cup", "chicken stock"), I(4, "clove", "garlic"), I(1, "clove", "ginger"), I(2, "tbsp", "soy sauce"), I(30, "ml", "lime juice"), I(2, "can", "tomato"), I(6, "whole", "shallot")] });
  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  await page.click('.rcard[data-id="rendang"]'); await page.waitForSelector("#unitsSeg .seg");
  const ing = () => page.$$eval("#ingList li .q", (qs) => qs.map((q) => q.textContent.trim()));
  const seg = await page.$$eval("#unitsSeg button", (bs) => bs.map((x) => x.textContent + (x.classList.contains("on") ? "*" : "")));
  check("a recipe has a Recipe · Metric · US switch, on Recipe to start", seg.join() === "Recipe*,Metric,US", seg.join());
  let q = await ing();
  check("Recipe: the recipe's own units, with plurals for counts (4 cloves, 1 clove, 2 cans, 2 cups) and none for measures (2 tbsp)",
    q.join("|") === "1.2 kg|400 ml|2 cups|1 cup|4 cloves|1 clove|2 tbsp|30 ml|2 cans|6", q.join("|"));
  await page.click('#unitsSeg [data-units="metric"]'); q = await ing();
  check("Metric: cups of liquid in ml, cups of rice in grams; spoons and counts as they were", q.join("|") === "1.2 kg|400 ml|425 g|250 ml|4 cloves|1 clove|2 tbsp|30 ml|2 cans|6", q.join("|"));
  await page.click('#unitsSeg [data-units="imperial"]'); q = await ing();
  check("US: kilos in pounds, ml in cups, a little ml in spoons; counts as they were", q.join("|") === "2¾ lb|1¾ cups|2 cups|1 cup|4 cloves|1 clove|2 tbsp|2 tbsp|2 cans|6", q.join("|"));
  await page.click("#multUp"); await page.click("#multUp"); q = await ing();
  check("…and the batch scales first: 2× is 5¼ lb of beef", q[0] === "5¼ lb" || q[0] === "5¼ lb", q[0]);
  await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.evaluate(() => { state.detailId = "rendang"; state.mult = 1; show("detail"); }); await page.waitForSelector("#unitsSeg .seg");
  check("the choice is remembered on the phone", (await page.textContent("#unitsSeg .on")) === "US" && (await ing())[0] === "2¾ lb");
  await page.click("#cookThis"); await page.waitForSelector("#cookIng");
  const cookQ = await page.$$eval("#cookIng .q", (qs) => qs.map((x) => x.textContent.trim()));
  check("cook mode follows it (US), with plurals", cookQ[0] === "2¾ lb" && cookQ[4] === "4 cloves", cookQ.join("|"));
  await page.click("#cookBack"); await page.click('#unitsSeg [data-units="orig"]');
  await page.click("#cookThis"); await page.waitForSelector("#cookIng");
  check("…and Recipe again", (await page.$$eval("#cookIng .q", (qs) => qs.map((x) => x.textContent.trim())))[0] === "1.2 kg");
  await page.evaluate(() => { cooking.clear(); show("recipes"); });

  // --- a recipe opened from the Plan is at the servings planned
  const k = await page.evaluate(() => iso(new Date()));
  await s.put("plan", k, { date: k, entries: [{ recipeId: "rendang", servings: 12 }] });
  await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.click('#tabs button[data-view="plan"]'); await page.click('.view.active [data-weekview="plan"]'); await page.click("#days .slot"); await page.waitForSelector('#sheet.open [data-act="open"]');
  await page.click('#sheet [data-act="open"]'); await page.waitForSelector("#multAmt");
  check("Open recipe from the Plan shows it at the planned servings (12 of a 6-serve recipe is 2×)", /^2×/.test(await page.textContent("#multAmt")) && /12 serves/.test(await page.textContent("#multAmt")) && (await ing())[0] === "2.4 kg", await page.textContent("#multAmt"));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
