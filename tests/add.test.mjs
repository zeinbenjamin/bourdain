// Adding a recipe: the Recipes "+" asks import or write your own, and there's no Import tab (1.8.0).
import { suite, startServer, openBrowser, openApp } from "./lib.mjs";

const { check, finish } = suite("add");
let s, b;
try {
  s = await startServer({ port: 19301, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test" } });
  b = await openBrowser();
  const { page, errors } = b;
  await s.put("recipes", "a", { title: "Leek soup", ingredients: [], steps: [], photos: [], created_at: "2026-09-01" });
  await openApp(page, s.url);
  const onTab = () => page.evaluate(() => document.querySelector("#tabs button.on")?.dataset.view);

  // --- tab bar
  const tabs = await page.evaluate(() => [...document.querySelectorAll("#tabs button")].map((t) => ({ v: t.dataset.view, w: t.getBoundingClientRect().width })));
  const labels = await page.$$eval("#tabs button", (bs) => bs.map((b) => b.textContent.trim()).join());
  check("four tabs: Recipes, Plan, Archives, Pantry; no Import", tabs.map((t) => t.v).join() === "recipes,plan,timeline,pantry" && labels === "Recipes,Plan,Archives,Pantry", labels);
  check("tabs share the width evenly", Math.max(...tabs.map((t) => t.w)) - Math.min(...tabs.map((t) => t.w)) < 1 && tabs[0].w > 80, JSON.stringify(tabs));

  // --- "+" asks how
  await page.click("#btnManual");
  const opts = await page.$$eval("#sheet.open [data-act]", (bs) => bs.map((x) => x.dataset.act));
  check("'+' opens a sheet: Import a recipe / Write one yourself / Guess from a photo", opts.join() === "import,manual,guess" && /Import a recipe/.test(await page.textContent("#sheet")) && /Write one yourself/.test(await page.textContent("#sheet")), opts.join());

  // --- import
  await page.click('#sheet [data-act="import"]');
  check("Import opens the import form", await page.isVisible("#importForm") && await page.isHidden("#review") && !(await page.isVisible("#sheet.open")));
  const form = await page.evaluate(() => ({ hints: document.querySelectorAll("#importForm .hint").length, label: document.querySelector('label[for="srcText"]').textContent, ph: document.getElementById("srcText").placeholder, text: document.getElementById("importForm").textContent }));
  check("import form: no hint paragraphs under the sections", form.hints === 0 && !/Works for recipe websites|A screen recording is best/.test(form.text), JSON.stringify(form));
  check("import form: text box labelled 'Video caption, recipe text or notes', not repeating the placeholder", form.label === "Video caption, recipe text or notes" && !form.ph.startsWith(form.label), JSON.stringify(form));
  check("Recipes tab stays highlighted on the import form", (await onTab()) === "recipes", await onTab());
  await page.click("#impBack");
  check("‹ Recipes goes back to the list", await page.isVisible("#view-recipes") && await page.isVisible(".rcard"));

  // --- write your own
  await page.click("#btnManual"); await page.click('#sheet [data-act="manual"]');
  check("Write one yourself opens a blank recipe", await page.isVisible("#review") && (await page.inputValue("#fTitle")) === "" && /Save recipe/.test(await page.textContent("#revSave")));
  const head = async () => page.evaluate(() => [document.querySelector("#review h2").textContent, document.querySelector("#review .revhint")?.textContent || ""]);
  const manualHead = await head();
  check("blank recipe: 'New recipe', no mention of an import or the reader", manualHead[0] === "New recipe" && !/import|reader/i.test(manualHead.join(" ")), JSON.stringify(manualHead));
  await page.click("#revBack");
  check("Back from a blank recipe returns to the list, not the import form", await page.isVisible("#view-recipes") && (await onTab()) === "recipes");

  // --- an unsaved import can be picked up again
  await page.click("#btnManual"); await page.click('#sheet [data-act="import"]');
  await page.fill("#srcText", "2 chicken thighs, cook them"); await page.click("#btnParse"); await page.waitForSelector("#revSave");
  const title = await page.inputValue("#fTitle");
  check("imported recipe: same 'New recipe' heading and hint", JSON.stringify(await head()) === JSON.stringify(manualHead), JSON.stringify(await head()));
  await page.click('#tabs button[data-view="plan"]'); await page.click('#tabs button[data-view="recipes"]');
  await page.click("#btnManual");
  const acts2 = await page.$$eval("#sheet.open [data-act]", (bs) => bs.map((x) => x.dataset.act));
  check("unsaved import: sheet offers to carry on with it first", acts2.join() === "resume,import,manual,guess" && (await page.textContent('#sheet [data-act="resume"]')).includes(title), await page.textContent("#sheet"));
  check("the other choices say they replace it", (await page.textContent('#sheet [data-act="manual"]')).includes(`Replaces “${title}”`));
  await page.click('#sheet [data-act="resume"]');
  check("Carry on returns to the review screen", (await page.inputValue("#fTitle")) === title);
  await page.click("#revBack");
  check("Back from an imported recipe goes to the import form", await page.isVisible("#importForm"));
  await page.click("#btnParse"); await page.waitForSelector("#revSave"); await page.click("#revSave"); await page.waitForSelector("#view-detail.active");
  check("saving works and lands on the recipe", Object.values((await s.state()).recipes).some((r) => r.title === title));
  await page.click('#tabs button[data-view="recipes"]'); await page.click("#btnManual");
  check("after saving, no 'carry on'", !(await page.$('#sheet [data-act="resume"]')));
  await page.click('#sheet [data-act="manual"]');
  check("Write one yourself after an import starts blank", (await page.inputValue("#fTitle")) === "");

  // --- empty book
  await page.evaluate(() => { state.recipes = {}; show("recipes"); });
  check("empty book mentions the + button", /Tap \+ to import/.test(await page.textContent("#rlist")));
  await page.click('#rlist [data-go="add"]');
  check("empty book's Add a recipe button opens the same sheet", /Add a recipe/.test(await page.textContent("#sheet.open h3")));
  await page.click('#sheet [data-act="import"]');
  check("…and Import from there opens the import form, even with a blank draft open", await page.isVisible("#importForm"));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
