// Home cost vs eating out (2.5, docs/cost-comparison.md): one AI estimate per
// recipe, worked out on the server, kept on the recipe, redone only when the
// ingredients change; the recipe page and the Archives show what cooking saved,
// against casual eating-out prices (2.5.2; mid-range is gone), every serving counted.
import path from "node:path";
import Database from "better-sqlite3";
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("cost");
let s, b;
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
  const calls = (s.log().match(/MOCK_COST/g) || []).length;
  await page.evaluate(() => { state.detailId = "rendang"; state.mult = 1; show("detail"); }); await page.waitForSelector("#view-detail .costline");
  const line = await page.textContent("#view-detail .costline");
  check("the recipe page: about $7 a serve to make, about $22 eating out at a casual place", /About \$7 a serve to make · about \$22 eating out/.test(line) && /at a casual place/.test(line) && !/mid-range/i.test(line) && /Australian prices/.test(line), line);

  // --- an estimate made by 2.5.0 (average of casual and mid-range) shows the casual price
  await page.evaluate(() => { state.recipes.old = { title: "Old dal", servings: 2, ingredients: [{ item: "lentils" }], cost: { home_per_serve: 3, casual_per_serve: 18, mid_per_serve: 30, out_per_serve: 24, hash: costs.hash({ servings: 2, ingredients: [{ item: "lentils" }] }) } }; state.detailId = "old"; show("detail"); });
  const oldLine = await page.textContent("#view-detail .costline");
  check("an older estimate shows its casual price, not the old average", /about \$18 eating out/.test(oldLine) && !/mid-range/i.test(oldLine) && await page.evaluate(() => cookSaved(state.recipes.old.cost, 2, 1)) === 30, oldLine);
  await page.evaluate(() => { delete state.recipes.old; });

  // --- Archives
  await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector(".feed .slot");
  const subs = await page.$$eval('.feed [data-open="rendang"]', (xs) => xs.map((x) => x.textContent.replace(/\s+/g, " ")));
  check("Archives: each cook says what it saved, every serving counted (6 × $15, 12 × $15)", subs.some((t) => /6 servings · about \$90 saved/.test(t)) && subs.some((t) => /12 servings · about \$180 saved/.test(t)), JSON.stringify(subs));
  const sv = await page.textContent("#view-timeline .savings");
  check("…and a total for this month and this year", /saved you about \$270 this month and \$270 this year/.test(sv), sv);

  // --- re-estimates only when it matters
  await page.evaluate(() => { const r = state.recipes.rendang; r.title = "Beef rendang (Mum's)"; return store.put("recipes", "rendang", r); }); await sleep(800);
  check("renaming a recipe doesn't re-estimate it", (s.log().match(/MOCK_COST/g) || []).length === calls);
  await page.evaluate(() => { const r = state.recipes.rendang; r.ingredients.push({ quantity: 200, unit: "g", item: "kerisik" }); return store.put("recipes", "rendang", r); });
  await sleep(1500);
  check("changing the ingredients does", (s.log().match(/MOCK_COST/g) || []).length === calls + 1);

  // --- other people's cooks carry their estimate
  { const d = db(); d.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('sam', 'sam@example.com', 'Sam', datetime())").run();
    d.prepare("INSERT INTO recipes (owner, id, doc, updated_at) VALUES ('sam', 'k', ?, datetime())").run(JSON.stringify({ title: "Katsu", servings: 2, cost: { home_per_serve: 5, out_per_serve: 25, hash: "x" }, cooks: [{ date: ymd, mult: 1 }] })); d.close(); }
  const f = (await get("/api/feed")).entries.find((e) => e.owner === "sam");
  check("the feed sends someone else's estimate per serve", f && f.cost && f.cost.home_per_serve === 5 && f.cost.out_per_serve === 25, JSON.stringify(f));
  await page.evaluate(() => { feed.at = 0; feed.entries = null; people.at = 0; people.list = null; localStorage.setItem("bourdain.archivesWho", "everyone"); });
  await page.reload(); await page.waitForFunction(() => !store.loading); await page.click('#tabs button[data-view="timeline"]');
  await page.waitForSelector('.feed [data-owner="sam"]');
  check("…and the Archives show what their cook saved", /2 servings · about \$40 saved/.test(await page.textContent('.feed [data-owner="sam"]')));

  // --- no Claude key, no estimates
  await s.restart({ ANTHROPIC_API_KEY: "" });
  await page.evaluate(() => { const r = state.recipes.rendang; r.ingredients.push({ quantity: 1, unit: "whole", item: "lime" }); });
  let aiCalls = 0; page.on("request", (rq) => { if (rq.url().includes("/api/ai")) aiCalls++; });
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(1500);
  check("a server without a Claude key: the phone doesn't ask", await page.evaluate(() => store.me.ai === false) && aiCalls === 0, String(aiCalls));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
