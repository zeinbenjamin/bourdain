// How much of the AI allowance is left (2.6.0): counts and a percentage in /api/me and
// with every AI reply, never prices; a line under the button from half left, one toast
// a day per kind, one at half the month; the whole picture in the profile sheet.
import { suite, startServer, openBrowser, openApp, addRecipe, sleep } from "./lib.mjs";

const { check, finish } = suite("allowance");
let s, b;
try {
  s = await startServer({ port: 20201, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-test" } });
  const get = async (p) => (await fetch(s.url + p)).json();
  const putLimits = (body) => fetch(s.url + "/api/admin/limits", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  // --- the server
  check("the owner, exempt by default: allowance says so and nothing else", JSON.stringify((await get("/api/me")).allowance) === '{"exempt":true}');
  await putLimits({ defaults: { admin_exempt: false, import: 4, scan: 4, ideas: 4, cover: 4, monthly_usd: 0.05 } });
  let me = await get("/api/me");
  check("not exempt: today's count and limit for imports, scans, ideas and covers, the month as a percentage, and photo storage",
    me.allowance.exempt === false && ["import", "scan", "ideas", "cover"].every((g) => me.allowance.today[g].used === 0 && me.allowance.today[g].limit === 4) && !("cost" in me.allowance.today)
    && me.allowance.month_pct === 0 && me.allowance.storage.limit_mb === 500, JSON.stringify(me.allowance));
  check("…and never a price: no US$ and no monthly allowance amount", !/usd|price|\$/i.test(JSON.stringify(me)), JSON.stringify(me));
  const r1 = await s.post("/api/ai", { kind: "import", material: { text: "2 chicken thighs" } });
  check("an AI reply carries the new count for its kind, and the month", r1.allowance?.group === "import" && r1.allowance.used === 1 && r1.allowance.limit === 4 && r1.allowance.month_pct > 0 && !/usd/i.test(JSON.stringify(r1.allowance)), JSON.stringify(r1.allowance));
  me = await get("/api/me");
  check("…and /api/me agrees", me.allowance.today.import.used === 1);

  // --- the phone
  b = await openBrowser();
  const { page, errors } = b;
  await page.addInitScript(() => { window.__toasts = []; });
  await openApp(page, s.url);
  await page.evaluate(() => { new MutationObserver(() => { const t = document.querySelector("#toast")?.textContent; if (t && window.__toasts.at(-1) !== t) window.__toasts.push(t); }).observe(document.querySelector("#toast"), { childList: true, characterData: true, subtree: true }); });
  await addRecipe(page, "import");
  const line = () => page.evaluate(() => { const el = document.querySelector('#view-import [data-allow="import"]'); return { shown: !el.hidden, text: el.textContent, none: el.classList.contains("none") }; });
  check("3 of 4 left: no line yet (more than half)", !(await line()).shown);
  const read = async () => { await page.fill("#srcText", "2 chicken thighs, cook them"); await page.click("#btnParse"); await page.waitForSelector("#review:not([hidden]) #fTitle", { timeout: 15000 }); await page.evaluate(() => { state.draft = null; renderImport(); }); };
  await read();
  let l = await line();
  check("half left: '2 imports left today' under Read recipe", l.shown && l.text === "2 imports left today" && !l.none, JSON.stringify(l));
  await sleep(3000);
  let toasts = await page.evaluate(() => window.__toasts);
  check("…and one toast saying so", toasts.filter((t) => /That's 2 imports left today/.test(t)).length === 1, JSON.stringify(toasts));
  await read(); await sleep(3000);
  l = await line(); toasts = await page.evaluate(() => window.__toasts);
  check("1 left: the line counts down; no second imports toast that day", l.text === "1 import left today" && !toasts.some((t) => /1 import left/.test(t)), JSON.stringify({ l, toasts }));
  check("…the month at half or more: one toast for that, never with a price", toasts.filter((t) => /half of this month's AI allowance/.test(t)).length === 1 && !toasts.some((t) => /\$/.test(t)), JSON.stringify(toasts));
  await read();
  l = await line();
  check("none left: says so in red", l.text === "No imports left today. More tomorrow." && l.none, JSON.stringify(l));
  check("other kinds still have more than half: no line under Scan or Ideas", await page.evaluate(() => [...document.querySelectorAll('#view-pantry [data-allow]')].every((el) => el.hidden)));

  // --- the profile sheet
  await page.evaluate(() => profileSheet(false)); await page.waitForSelector("#sheet.open #pfAllow .arow"); await sleep(600);
  const box = await page.evaluate(() => { const b = document.querySelector("#pfAllow"); return { text: b.textContent.replace(/\s+/g, " "), low: [...b.querySelectorAll(".arow.low .arow-t span:first-child")].map((x) => x.textContent), bars: b.querySelectorAll(".abar").length,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  check("profile: your allowance, each kind today, the month in %, photos, and when it resets",
    /Your allowance/.test(box.text) && /Imports and photo guesses today ?4 of 4/.test(box.text) && /Fridge scans today ?0 of 4/.test(box.text) && /AI this month ?\d+% used/.test(box.text) && /Photos \(MB\) ?0 of 500/.test(box.text) && /reset at midnight/.test(box.text) && box.bars === 6, JSON.stringify(box));
  check("…what's at half or past it is in red: imports and the month", box.low.join() === "Imports and photo guesses today,AI this month", JSON.stringify(box.low));
  check("…no prices, and no sideways scroll", !/\$|US|usd/.test(box.text) && box.over <= 0, box.text);
  await page.evaluate(() => closeSheet());

  // --- the owner, exempt again
  await putLimits({ defaults: { admin_exempt: true } });
  await page.evaluate(() => allowance.refresh()); await sleep(300);
  check("exempt owner: no lines anywhere", await page.evaluate(() => [...document.querySelectorAll("[data-allow]")].every((el) => el.hidden)));
  await page.evaluate(() => profileSheet(false)); await page.waitForSelector("#sheet.open #pfAllow"); await sleep(600);
  check("…and the profile says No limits (owner)", /No limits \(owner\)/.test(await page.textContent("#pfAllow")));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
