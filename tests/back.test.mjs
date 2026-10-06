// The phone's back gesture and back button (2.7.4), and an unsaved recipe kept through
// the app being closed (2.7.4).
import { suite, startServer, openBrowser, openApp, addRecipe, sleep } from "./lib.mjs";

const { check, finish } = suite("back");
let s, b;
try {
  s = await startServer({ port: 20701 });
  await s.put("recipes", "soup", { title: "Leek soup", servings: 4, ingredients: [{ raw_text: "3 leeks", quantity: 3, unit: "whole", item: "leek", aisle: "produce" }], steps: ["Soften the leeks for 8 minutes."], photos: [], tags: [], created_at: "2026-09-01" });
  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  const view = () => page.evaluate(() => state.view);
  const back = async () => { await page.goBack({ waitUntil: "commit" }).catch(() => {}); await sleep(250); };
  const sheetOpen = () => page.evaluate(() => document.getElementById("sheet").classList.contains("open"));

  // --- back goes where the app's own Back would
  check("at Recipes with nothing open, there's nothing of Bourdain's to go back through", (await page.evaluate(() => history.state?.bourdain)) == null);
  await page.click('.rcard:has-text("Leek soup")'); await page.waitForSelector("#view-detail.active");
  await back();
  check("a recipe → back → Recipes", (await view()) === "recipes" && await page.isVisible("#rlist"));
  await page.click('.rcard:has-text("Leek soup")'); await page.click("#cookThis"); await page.waitForSelector("#cookIng");
  await back();
  check("cooking → back → the recipe", (await view()) === "detail");
  await back();
  check("…→ back → Recipes", (await view()) === "recipes");
  await page.click('#tabs button[data-view="plan"]');
  await back();
  check("another tab → back → Recipes, the home tab", (await view()) === "recipes" && (await page.evaluate(() => document.querySelector("#tabs .on").dataset.view)) === "recipes");
  await page.click("#btnManual"); await page.waitForSelector("#sheet.open");
  await back();
  check("an open sheet → back → just closes it", !(await sheetOpen()) && (await view()) === "recipes");
  await page.click('.rcard:has-text("Leek soup")'); await page.click("#back");
  check("the app's own Back keeps the phone's history in step (nothing left to go back through)", (await view()) === "recipes" && (await page.evaluate(() => history.state?.bourdain)) == null);
  await page.click('.rcard:has-text("Leek soup")'); await page.click("#tabs button[data-view=\"recipes\"]");
  await page.click('.rcard:has-text("Leek soup")');
  await back();
  check("…and going in, out and in again still comes back one screen at a time", (await view()) === "recipes");

  // --- a recipe being written isn't lost to a stray back
  await addRecipe(page, "manual"); await page.waitForSelector("#fTitle");
  await page.fill("#fTitle", "Pho ga");
  await back();
  check("writing a recipe → back → asks first, nothing lost", await sheetOpen() && /Leave this recipe without saving\?/.test(await page.textContent("#sheet")) && (await page.inputValue("#fTitle")) === "Pho ga");
  await page.click('#sheet [data-act="stay"]');
  check("…Keep editing keeps it", !(await sheetOpen()) && (await page.inputValue("#fTitle")) === "Pho ga" && (await view()) === "import");
  await back(); await page.click('#sheet [data-act="leave"]'); await sleep(200);
  check("…Leave without saving leaves", (await view()) === "recipes" && !(await page.evaluate(() => state.draft)));

  // --- an unsaved recipe is kept through the app closing
  await addRecipe(page, "manual"); await page.waitForSelector("#fTitle");
  await page.fill("#fTitle", "Pho ga");
  await page.locator(".ingrow [data-f=item]").first().fill("chicken thigh");
  await page.fill("#fSteps", "Poach the chicken.");
  await sleep(600);
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(900);
  check("closed mid-recipe and reopened: a toast says it's kept, with Carry on", /“Pho ga” is kept\. It isn't saved yet\./.test(await page.textContent("#toast")) && await page.isVisible("#toast .toast-btn"), await page.textContent("#toast"));
  await page.click("#btnManual");
  check("…and + offers to carry on with it", /Carry on with “Pho ga”/.test(await page.textContent("#sheet")));
  await page.click('#sheet [data-act="resume"]');
  check("…carrying on brings back the form as it was", (await page.inputValue("#fTitle")) === "Pho ga" && (await page.locator(".ingrow [data-f=item]").first().inputValue()) === "chicken thigh" && /Poach the chicken/.test(await page.inputValue("#fSteps")));
  await page.click("#revSave"); await page.waitForSelector("#view-detail.active");
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(900);
  await page.click("#btnManual");
  check("once saved, it's not offered again", !/Carry on/.test(await page.textContent("#sheet")) && (await page.evaluate(() => Object.values(state.recipes).filter((r) => r.title === "Pho ga").length)) === 1);
  await page.evaluate(() => closeSheet());

  // an edit to a saved recipe
  await page.click('.rcard:has-text("Leek soup")'); await page.click("#edit"); await page.waitForSelector("#fTitle");
  await page.fill("#fTitle", "Leek and potato soup"); await sleep(600);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // the phone switching apps
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(900);
  check("closed mid-edit: 'Your changes to … are kept'", /Your changes to “Leek and potato soup” are kept/.test(await page.textContent("#toast")), await page.textContent("#toast"));
  await page.click("#toast .toast-btn"); await page.waitForSelector("#fTitle");
  check("…Carry on opens the edit, still an edit of that recipe", (await page.inputValue("#fTitle")) === "Leek and potato soup" && /Edit recipe/.test(await page.textContent("#review h2")) && (await page.evaluate(() => state.editingId)) === "soup");
  await page.click("#revBack");
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(900);
  check("…Cancel discards it: not offered again, and the recipe is as it was", !(await page.isVisible("#toast.show .toast-btn")) && (await page.evaluate(() => state.recipes.soup.title)) === "Leek soup");

  // an import not read yet: the link and the caption pasted in
  await addRecipe(page, "import");
  await page.fill("#srcUrl", "https://www.instagram.com/reel/DdR9Szhy_wE/"); await page.fill("#srcText", "Crispy garlic parmesan chicken rolls. 2 lb chicken breast.");
  await sleep(600);
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(900);
  check("closed with a link and caption pasted: they're kept too", /the import you started is kept/i.test(await page.textContent("#toast")), await page.textContent("#toast"));
  await page.click("#toast .toast-btn");
  check("…and back in the form", (await page.inputValue("#srcUrl")) === "https://www.instagram.com/reel/DdR9Szhy_wE/" && /Crispy garlic/.test(await page.inputValue("#srcText")));
  await page.click("#btnClear"); await sleep(500);
  check("…Clear forgets them", (await page.evaluate(() => localStorage.getItem(store.key("bourdain.draft")))) === null);
  check("…and the draft is kept per person, under their own key", await page.evaluate(() => store.key("bourdain.draft") === "bourdain.draft:" + store.me.id));

  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
