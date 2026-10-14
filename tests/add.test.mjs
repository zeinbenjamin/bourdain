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
  check("five tabs with + in the middle: Plan, Recipes, Add, Pantry, Archives; no Shop tab (2.9.0)", tabs.map((t) => t.v).join() === "plan,recipes,add,pantry,timeline" && labels === "Plan,Recipes,Add,Pantry,Archives", labels);
  check("…and the app still opens on Recipes", (await onTab()) === "recipes" && await page.isVisible("#view-recipes.active"));
  check("tabs share the width evenly", Math.max(...tabs.map((t) => t.w)) - Math.min(...tabs.map((t) => t.w)) < 1 && tabs[0].w >= 60, JSON.stringify(tabs));

  // --- "+" asks how
  await page.click("#btnManual");
  const opts = await page.$$eval("#sheet.open [data-act]", (bs) => bs.map((x) => x.dataset.act));
  check("'+' opens a sheet: Import a recipe / Guess from a photo / Cook from the pantry / Write one yourself (2.9.0)", opts.join() === "import,guess,pantry,manual" && /Import a recipe/.test(await page.textContent("#sheet")) && /Cook from the pantry/.test(await page.textContent("#sheet")) && /Write one yourself/.test(await page.textContent("#sheet")), opts.join());

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
  check("unsaved import: sheet offers to carry on with it first", acts2.join() === "resume,import,guess,pantry,manual" && (await page.textContent('#sheet [data-act="resume"]')).includes(title), await page.textContent("#sheet"));
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

  // --- the + tab (2.9.0): the same sheet, over the page you're on
  await page.evaluate(() => closeSheet()); await page.click('#tabs button[data-view="plan"]'); await page.waitForTimeout(200);
  await page.click('#tabs button[data-view="add"]'); await page.waitForSelector("#sheet.open");
  check("2.9.0: the + tab opens Add a recipe over the page, and the tab you were on stays lit", /Add a recipe/.test(await page.textContent("#sheet.open h3")) && (await page.evaluate(() => state.view)) === "plan" && (await onTab()) === "plan", await onTab());
  // Cook from the pantry: with nothing in the pantry it says so; with things in, the ideas come up
  await page.click('#sheet [data-act="pantry"]'); await page.waitForTimeout(300);
  check("2.9.0: Cook from the pantry with an empty pantry opens Pantry and says to add what you have", (await page.evaluate(() => state.view)) === "pantry" && /Add what you have in first/.test(await page.textContent("#toast")), await page.textContent("#toast"));
  await page.fill("#pantryAdd", "eggs, rice"); await page.click("#pantryAddBtn"); await page.waitForTimeout(400);
  await page.click('#tabs button[data-view="add"]'); await page.click('#sheet [data-act="pantry"]');
  await page.waitForFunction(() => /Lemon rice/.test(document.getElementById("ideas").textContent), null, { timeout: 8000 }).catch(() => {});
  check("…with things in, it runs Cook from what I have: the ideas show", /Lemon rice/.test(await page.textContent("#ideas")) && (await onTab()) === "pantry", await page.textContent("#ideas"));

  // --- 2.9.0: Paste beside the link box, turning into Fetch & read once there's a link
  // what's on the clipboard (the headless browser's own clipboard isn't dependable across a long suite)
  const clip = (t) => page.evaluate((t) => { navigator.clipboard.readText = () => Promise.resolve(t); }, t);
  const said = async (re) => { await page.waitForFunction((src) => new RegExp(src).test(document.getElementById("toast").textContent), re.source, { timeout: 3000 }).catch(() => {}); return re.test(await page.textContent("#toast")); };
  const slot = () => page.evaluate(() => ({ paste: !document.getElementById("btnPaste").hidden, fetch: !document.getElementById("btnFetch").hidden }));
  await page.click('#tabs button[data-view="recipes"]'); await page.click("#btnManual"); await page.click('#sheet [data-act="import"]');
  await page.click("#btnClear");
  let sl = await slot();
  check("2.9.0: an empty link box has Paste beside it, not Fetch & read", sl.paste && !sl.fetch, JSON.stringify(sl));
  await page.fill("#srcUrl", "https://example.com/x"); sl = await slot();
  check("…typing a link turns it into Fetch & read", !sl.paste && sl.fetch, JSON.stringify(sl));
  await page.fill("#srcUrl", ""); sl = await slot();
  check("…and clearing it brings Paste back", sl.paste && !sl.fetch, JSON.stringify(sl));
  await clip("");
  await page.click("#btnPaste");
  check("…Paste with nothing copied says so", await said(/clipboard is empty/), await page.textContent("#toast"));
  await clip("2 eggs, whisked, then fried");
  await page.click("#btnPaste");
  check("…copied recipe text goes into the text box", (await page.inputValue("#srcText")) === "2 eggs, whisked, then fried" && (await page.inputValue("#srcUrl")) === "" && await said(/Pasted into the recipe text/), await page.inputValue("#srcText"));
  await clip("Look at this https://www.instagram.com/p/ABC123/, so good");
  await page.click("#btnPaste");
  check("…a copied link (in a sentence) goes into the link box, tidied, and is read straight away", (await page.inputValue("#srcUrl")) === "https://www.instagram.com/p/ABC123/" && (await slot()).fetch, await page.inputValue("#srcUrl"));
  await page.waitForSelector("#review:not([hidden]) #fTitle", { timeout: 8000 }).catch(() => {});
  check("…which lands on the review form, as Fetch & read does", await page.isVisible("#review"));
  await page.evaluate(() => document.getElementById("revBack").click()); await page.waitForSelector("#btnClear");
  await page.click("#btnClear");
  await page.evaluate(() => { navigator.clipboard.readText = () => Promise.reject(new Error("NotAllowedError")); });
  await page.click("#btnPaste");
  check("…and if the phone won't let Bourdain read the clipboard, it says how to paste by hand", await said(/Press and hold in the link box/), await page.textContent("#toast"));
  await page.click("#impBack");

  // --- empty book
  await page.click('#tabs button[data-view="recipes"]');
  await page.evaluate(() => { state.recipes = {}; show("recipes"); });
  check("empty book mentions the + button", /Tap \+ to import/.test(await page.textContent("#rlist")));
  await page.click('#rlist [data-go="add"]');
  check("empty book's Add a recipe button opens the same sheet", /Add a recipe/.test(await page.textContent("#sheet.open h3")));
  await page.click('#sheet [data-act="import"]');
  check("…and Import from there opens the import form, even with a blank draft open", await page.isVisible("#importForm"));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
