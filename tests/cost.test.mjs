// Home cost vs eating out (2.5, docs/cost-comparison.md): one AI estimate per
// recipe, worked out on the server, kept on the recipe, redone only when the
// ingredients change; the recipe page and the Archives show what cooking saved,
// against casual eating-out prices (2.5.2; mid-range is gone), every serving counted.
// 2.9.0: the same call estimates nutrition for one serve, shown on the recipe and the Plan,
// and the Archives word the saving as an estimated difference.
import path from "node:path";
import Database from "better-sqlite3";
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("cost");
let s, b, calls_ = 0;
try {
  s = await startServer({ port: 20401, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test" } });
  const db = () => new Database(path.join(s.data, "bourdain.db"));
  const rows = (sql, ...a) => { const d = db(); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const get = async (p) => (await fetch(s.url + p)).json();
  const putLimits = (body) => fetch(s.url + "/api/admin/limits", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const material = { title: "Beef rendang", servings: 6, ingredients: ["1.2 kg beef chuck", "2 cans coconut milk", "2 lemongrass"] };

  // --- the estimate, on the server
  s.clearLog();
  const est = await s.post("/api/ai", { kind: "cost", material });
  check("an estimate in AUD: home cost per serve against a casual place, no mid-range", est.json?.currency === "AUD" && est.json.home_total === 42 && est.json.home_per_serve === 7 && est.json.casual_per_serve === 22 && !("mid_per_serve" in est.json) && est.json.out_per_serve === 22 && est.json.course === "main", JSON.stringify(est.json));
  check("…the prompt has the recipe", /MOCK_COST "RECIPE: Beef rendang/.test(s.log()));
  const u = rows("SELECT * FROM ai_usage WHERE kind = 'cost'");
  check("…counted as its own kind and limit, and kept out of the activity log", u.length === 1 && u[0].grp === "cost" && !(await get("/api/admin/activity?limit=200")).some((a) => a.action === "ai_cost"), JSON.stringify(u));
  check("2.9.0: …and asks for nutrition for one serve in the same call", /MOCK_COST "RECIPE: Beef rendang[^\n]*\+nutrition/.test(s.log()) && (s.log().match(/MOCK_CLAUDE_REQ/g) || []).length === 1);
  check("…and the reply carries it, numbers checked", JSON.stringify(est.json?.nutrition) === JSON.stringify({ kcal: 640, protein_g: 48, carbs_g: 12, fat_g: 44, sat_fat_g: 30, sugar_g: 6, fibre_g: 3, sodium_mg: 620 }), JSON.stringify(est.json?.nutrition));
  s.setMode({ cost: "badnutrition" });
  const badN = await s.post("/api/ai", { kind: "cost", material });
  check("…a number no meal could have is dropped, the rest kept", badN.status === 200 && badN.json.nutrition && badN.json.nutrition.kcal === 500 && !("sugar_g" in badN.json.nutrition) && !("sodium_mg" in badN.json.nutrition), JSON.stringify(badN.json?.nutrition));
  s.setMode({ cost: "nonutrition" });
  const noN = await s.post("/api/ai", { kind: "cost", material });
  check("…a reply without nutrition still gives the cost, and no nutrition", noN.status === 200 && noN.json.home_per_serve === 7 && !("nutrition" in noN.json), JSON.stringify(noN.json));
  s.setMode({});
  check("…with no servings it assumes 2", (await s.post("/api/ai", { kind: "cost", material: { ...material, servings: null } })).json?.home_per_serve === 21);
  s.setMode({ cost: "junk" });
  const junk = await s.post("/api/ai", { kind: "cost", material });
  check("a reply that isn't a set of prices is refused (invalid_json)", junk.status === 422 && junk.code === "invalid_json", JSON.stringify(junk));
  // 2.7.10: on Sonnet 5.5 the estimate ran past its 600-token cap and every one came back truncated
  s.setMode({ cost: "long" }); s.clearLog();
  const long = await s.post("/api/ai", { kind: "cost", material });
  const asked = JSON.parse((s.log().match(/MOCK_CLAUDE_REQ (.*)/) || [])[1] || "{}");
  check("a longer estimate has room to finish (not cut off as 'truncated')", long.status === 200 && long.json?.home_per_serve === 7, JSON.stringify(long));
  check("…the cost job asks for up to 2000 tokens (you pay only for what's written)", asked.max_tokens === 2000, JSON.stringify(asked));
  s.setMode({});
  await putLimits({ defaults: { cost: 0, admin_exempt: false } });
  const lim = await s.post("/api/ai", { kind: "cost", material });
  check("cost estimates have their own daily limit", lim.status === 429 && lim.code === "ai_limit" && lim.kind === "cost", JSON.stringify(lim));
  await putLimits({ defaults: { cost: 40 } });
  s.setMode({ claudeDelay: 1200 });
  const slow = s.post("/api/ai", { kind: "import", material: { text: "x" } }); await sleep(300);
  const alongside = await s.post("/api/ai", { kind: "cost", material });
  check("an estimate runs alongside an import, without 'still working'", alongside.status === 200 && (await slow).status === 200, JSON.stringify(alongside.code));
  s.setMode({}); await putLimits({ defaults: { admin_exempt: true } });
  check("the summary shows cost estimates as a feature", (await get("/api/admin/summary")).month.byKind.some((k) => k.grp === "cost"));

  // --- adding an estimate isn't an edit
  await s.put("recipes", "x", { title: "Dal", ingredients: [{ item: "lentils" }] });
  await s.put("recipes", "x", { title: "Dal", ingredients: [{ item: "lentils" }], cost: { home_per_serve: 2, out_per_serve: 20 } });
  check("a write that only adds a cost estimate isn't logged as an edit", !(await get("/api/admin/activity?limit=200")).some((a) => a.action === "recipe_edited" && a.target === "Dal"));
  await s.put("recipes", "x", { title: "Dal", ingredients: [{ item: "lentils" }], cost: { home_per_serve: 2, out_per_serve: 20 }, nutrition: { kcal: 300, protein_g: 18, carbs_g: 40, fat_g: 6 } });
  check("2.9.0: …nor one that only adds nutrition", !(await get("/api/admin/activity?limit=200")).some((a) => a.action === "recipe_edited" && a.target === "Dal"));
  await s.put("recipes", "x", { title: "Dal", ingredients: [{ item: "lentils" }] });

  // --- the phone works out estimates by itself
  const today = new Date(), ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await s.put("recipes", "rendang", { title: "Beef rendang", servings: 6, ingredients: [{ quantity: 1.2, unit: "kg", item: "beef chuck" }, { quantity: 2, unit: "can", item: "coconut milk" }], steps: ["Simmer."], photos: [],
    cooks: [{ date: ymd, at: new Date(Date.now() - 3600e3).toISOString(), mult: 1 }, { date: ymd, at: new Date().toISOString(), mult: 2 }] });
  b = await openBrowser();
  const { page, errors } = b;
  s.clearLog();
  await openApp(page, s.url);
  check("the phone knows the server can estimate", await page.evaluate(() => store.me.ai === true));
  await page.waitForFunction(() => state.recipes.rendang?.cost && state.recipes.x?.cost?.hash, null, { timeout: 15000 });
  await sleep(600);
  const saved = (await s.state()).recipes.rendang.cost;
  check("recipes without an estimate get one in the background, saved to the recipe", saved && saved.out_per_serve === 22 && saved.home_per_serve === 7 && saved.hash, JSON.stringify(saved));
  check("…quietly: no 'Saved' toast", !/Saved/.test(await page.textContent("#toast")));
  check("…a recipe whose estimate was there but out of date (no hash) is redone too", (await s.state()).recipes.x.cost.hash);
  const nu = (await s.state()).recipes.rendang.nutrition;
  check("2.9.0: …with its nutrition from the same call, kept with the same hash", nu && nu.kcal === 640 && nu.hash === saved.hash && (s.log().match(/MOCK_COST/g) || []).length === 2, JSON.stringify(nu));
  const calls = (s.log().match(/MOCK_COST/g) || []).length;
  await page.evaluate(() => { state.detailId = "rendang"; state.mult = 1; show("detail"); }); await page.waitForSelector("#view-detail .costline");
  const line = await page.textContent("#view-detail .costline");
  check("the recipe page: about $7 a serve to make, about $22 eating out at a casual place", /About \$7 a serve to make · about \$22 eating out/.test(line) && /at a casual place/.test(line) && !/mid-range/i.test(line) && /Australian prices/.test(line), line);

  // --- 2.9.0: nutrition on the recipe page: four figures, the rest behind Show more detail
  const nut = await page.evaluate(() => ({ big: [...document.querySelectorAll("#view-detail .nutri .macros div")].map((d) => d.textContent.replace(/\s+/g, " ").trim()), open: document.querySelector("#view-detail .nutmore").open }));
  check("2.9.0: the recipe shows kcal, protein, carbs and fat for one serve", nut.big.join("|") === "640kcal a serve|48gprotein|12gcarbs|44gfat" && nut.open === false, JSON.stringify(nut));
  check("…the detail is hidden until Show more detail", !(await page.isVisible("#view-detail .nutmore table")) && /Show more detail/.test(await page.textContent("#view-detail .nutmore summary")));
  await page.click("#view-detail .nutmore summary");
  const rowsN = await page.$$eval("#view-detail .nutmore tr", (t) => t.map((r) => r.textContent.replace(/\s+/g, " ").trim()));
  check("…which opens what a label lists, kJ and kcal, with saturated fat and sugars under fat and carbs", rowsN.join("|") === "Energy2,678 kJ (640 kcal)|Protein48 g|Fat, total44 g|– saturated30 g|Carbohydrate12 g|– sugars6 g|Dietary fibre3 g|Sodium620 mg" && /Show less/.test(await page.textContent("#view-detail .nutmore summary")), JSON.stringify(rowsN));
  check("…and where the energy comes from", /Protein 30%.*Carbs 8%.*Fat 62%/.test(await page.textContent("#view-detail .splitkey")), await page.textContent("#view-detail .splitkey"));
  const hostile = await page.evaluate(() => [nutritionHtml({ nutrition: { kcal: "<img src=x onerror=alert(1)>", protein_g: 1, carbs_g: 1, fat_g: 1 } }), nutritionHtml({ nutrition: { kcal: 500, protein_g: 30, carbs_g: 40, fat_g: 20, sodium_mg: "<img src=x onerror=alert(1)>" } })]);
  check("…someone else's odd numbers show nothing, never markup", hostile[0] === "" && !/onerror/.test(hostile[1]) && /500/.test(hostile[1]));

  // --- 2.9.0: a recipe estimated before 2.9.0 has no nutrition: it's asked once more, and a reply without any isn't asked again
  s.setMode({ cost: "nonutrition" });
  await page.evaluate(() => { const r = state.recipes.rendang; delete r.nutrition; costs.failed = {}; costs.want("rendang"); });
  await page.waitForFunction(() => state.recipes.rendang.nutrition, null, { timeout: 8000 });
  const before = (s.log().match(/MOCK_COST/g) || []).length;
  check("2.9.0: an older estimate without nutrition is asked once more; a reply without it is noted as none", await page.evaluate(() => state.recipes.rendang.nutrition.none === true && !nutritionHtml(state.recipes.rendang)));
  await page.evaluate(() => { costs.failed = {}; costs.sweep(); }); await sleep(1200);
  check("…and isn't asked again", (s.log().match(/MOCK_COST/g) || []).length === before);
  s.setMode({});
  await page.evaluate(() => { const r = state.recipes.rendang; delete r.nutrition; costs.failed = {}; costs.want("rendang"); });
  await page.waitForFunction(() => state.recipes.rendang.nutrition?.kcal === 640, null, { timeout: 8000 });
  calls_ = (s.log().match(/MOCK_COST/g) || []).length;

  // --- 2.9.0: the Plan: each meal's kcal, and a day with two meals has a total
  await s.put("plan", ymd, { date: ymd, entries: [{ recipeId: "rendang", servings: 6 }, { recipeId: "x", servings: 2 }] });
  await page.evaluate(async () => { await store.init(); }); await page.waitForFunction(() => state.recipes.x?.nutrition?.kcal);
  await page.click('#tabs button[data-view="plan"]'); await page.waitForSelector("#days .slot .kc");
  const plan = await page.evaluate(() => ({ kc: [...document.querySelectorAll("#days .day.today .slot .kc")].map((x) => x.textContent), day: document.querySelector("#days .day.today .daynut")?.textContent, week: !!document.querySelector(".weeknut") }));
  check("2.9.0: the Plan shows each meal's kcal a serve, and the day's total for two meals", plan.kc.join("|") === "640 kcal a serve|640 kcal a serve" && plan.day === "Day: 1,280 kcal · 96 g protein · 24 g carbs · 88 g fat", JSON.stringify(plan));
  check("…and no week-wide figure (it read as daily intake)", !plan.week);
  await s.put("plan", ymd, { date: ymd, entries: [] }); await page.evaluate(async () => { await store.init(); });

  // --- an estimate made by 2.5.0 (average of casual and mid-range) shows the casual price
  await page.evaluate(() => { state.recipes.old = { title: "Old dal", servings: 2, ingredients: [{ item: "lentils" }], cost: { home_per_serve: 3, casual_per_serve: 18, mid_per_serve: 30, out_per_serve: 24, hash: costs.hash({ servings: 2, ingredients: [{ item: "lentils" }] }) } }; state.detailId = "old"; show("detail"); });
  const oldLine = await page.textContent("#view-detail .costline");
  check("an older estimate shows its casual price, not the old average", /about \$18 eating out/.test(oldLine) && !/mid-range/i.test(oldLine) && await page.evaluate(() => cookSaved(state.recipes.old.cost, 2, 1)) === 30, oldLine);
  await page.evaluate(() => { delete state.recipes.old; });

  // --- Archives
  await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector(".feed .slot");
  const subs = await page.$$eval('.feed [data-open="rendang"]', (xs) => xs.map((x) => x.textContent.replace(/\s+/g, " ")));
  check("Archives: each cook says how much less than eating out it came to, every serving counted (6 × $15, 12 × $15)", subs.some((t) => /6 servings · about \$90 less than eating out/.test(t)) && subs.some((t) => /12 servings · about \$180 less than eating out/.test(t)), JSON.stringify(subs));
  const sv = await page.textContent("#view-timeline .savings");
  check("…and a total for this month and this year, worded as a difference, not money saved (2.9.0)", sv.trim() === "Cooking at home came to about $270 less than eating out this month, and $270 this year." && !/saved/.test(sv), sv);

  // --- re-estimates only when it matters
  await page.evaluate(() => { const r = state.recipes.rendang; r.title = "Beef rendang (Mum's)"; return store.put("recipes", "rendang", r); }); await sleep(800);
  check("renaming a recipe doesn't re-estimate it", (s.log().match(/MOCK_COST/g) || []).length === calls_);
  await page.evaluate(() => { const r = state.recipes.rendang; r.ingredients.push({ quantity: 200, unit: "g", item: "kerisik" }); return store.put("recipes", "rendang", r); });
  await sleep(1500);
  check("changing the ingredients does, once, for both cost and nutrition", (s.log().match(/MOCK_COST/g) || []).length === calls_ + 1);

  // --- other people's cooks carry their estimate
  { const d = db(); d.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('sam', 'sam@example.com', 'Sam', datetime())").run();
    d.prepare("INSERT INTO recipes (owner, id, doc, updated_at) VALUES ('sam', 'k', ?, datetime())").run(JSON.stringify({ title: "Katsu", servings: 2, cost: { home_per_serve: 5, out_per_serve: 25, hash: "x" }, cooks: [{ date: ymd, mult: 1 }] })); d.close(); }
  const f = (await get("/api/feed")).entries.find((e) => e.owner === "sam");
  check("the feed sends someone else's estimate per serve", f && f.cost && f.cost.home_per_serve === 5 && f.cost.out_per_serve === 25, JSON.stringify(f));
  await page.evaluate(() => { feed.at = 0; feed.entries = null; people.at = 0; people.list = null; localStorage.setItem("bourdain.archivesWho", "everyone"); });
  await page.reload(); await page.waitForFunction(() => !store.loading); await page.click('#tabs button[data-view="timeline"]');
  await page.waitForSelector('.feed [data-owner="sam"]');
  check("…and the Archives show how much less than eating out their cook came to", /2 servings · about \$40 less than eating out/.test(await page.textContent('.feed [data-owner="sam"]')));

  // --- no Claude key, no estimates
  await s.restart({ ANTHROPIC_API_KEY: "" });
  await page.evaluate(() => { const r = state.recipes.rendang; r.ingredients.push({ quantity: 1, unit: "whole", item: "lime" }); });
  let aiCalls = 0; page.on("request", (rq) => { if (rq.url().includes("/api/ai")) aiCalls++; });
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(1500);
  check("a server without a Claude key: the phone doesn't ask", await page.evaluate(() => store.me.ai === false) && aiCalls === 0, String(aiCalls));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
