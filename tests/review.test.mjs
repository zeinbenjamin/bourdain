// The review / edit form: the description can be edited, and tapping Save twice on
// a slow connection saves one recipe, not two.
import { suite, startServer, slowProxy, openBrowser, openApp, sleep } from "./lib.mjs";

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
  await page.click('#tabs button[data-view="recipes"]'); await page.click("#btnManual");
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
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); px?.close(); await s?.cleanup(); }
