// Data version (1.10.1, now 2 since 2.0.0): the server and the phone agree on the
// shape of stored data, so a rollback can't mix newer data into older tables.
// Since 2.0 the phone also keeps its copy and outbox per person, adopts what 1.x
// kept, and picks set-aside changes back up. See docs/multi-user.md, "Rollback".
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("dataversion");
let s, b;
try {
  s = await startServer({ port: 19501 });
  const req = (method, path, { dv, body } = {}) => fetch(s.url + path, { method, headers: { "Content-Type": "application/json", ...(dv ? { "X-Bourdain-Data": String(dv) } : {}) }, body: body && JSON.stringify(body) });
  const owner = (await (await fetch(s.url + "/api/me")).json()).id;

  // --- server
  const ver = await (await fetch(s.url + "/api/version")).json();
  const health = await (await fetch(s.url + "/api/health")).json();
  check("server reports data version 2", ver.dataVersion === 2 && health.dataVersion === 2, JSON.stringify({ v: ver.dataVersion, h: health.dataVersion }));
  check("writes with no stamp, stamped 1 and stamped 2 are accepted", (await req("PUT", "/api/recipes/old", { body: { title: "1.9 app" } })).status === 204
    && (await req("PUT", "/api/recipes/v1", { dv: 1, body: { title: "1.10 app" } })).status === 204 && (await req("PUT", "/api/recipes/v2", { dv: 2, body: { title: "2.0 app" } })).status === 204);
  const r3 = await req("PUT", "/api/recipes/v3", { dv: 3, body: { title: "From a future app" } });
  const j3 = await r3.json();
  const d3 = await req("DELETE", "/api/recipes/v1", { dv: 3 });
  const st = await s.state();
  check("stamped 3 is refused (409 data_newer), stored nowhere, and can't delete", r3.status === 409 && j3.code === "data_newer" && !st.recipes.v3 && st.recipes.v1 && d3.status === 409, JSON.stringify(j3));

  // --- a phone that ran 1.x: its copy and unsynced changes become the owner's
  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  await s.stop();
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("bourdain", JSON.stringify({ dv: 1, recipes: { old: { title: "1.9 app" }, mine: { title: "Only on this phone so far" } }, plan: {}, pantry: {}, shop: {} }));
    localStorage.setItem("bourdain.outbox", JSON.stringify([{ col: "recipes", id: "mine", dv: 1, doc: { title: "Only on this phone so far" } }]));
  });
  await s.restart();
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(500);
  const adopted = await page.evaluate((id) => ({ me: JSON.parse(localStorage.getItem("bourdain.me") || "null"), legacyCopy: localStorage.getItem("bourdain"), legacyBox: localStorage.getItem("bourdain.outbox"), copy: JSON.parse(localStorage.getItem("bourdain:" + id) || "null"), box: JSON.parse(localStorage.getItem("bourdain.outbox:" + id) || "null") }), owner);
  check("first open after updating: this phone's 1.x copy moves under the owner", adopted.me?.id === owner && adopted.legacyCopy === null && adopted.copy?.dv === 2 && adopted.copy.recipes.old, JSON.stringify(adopted).slice(0, 300));
  check("…and its unsynced 1.x change is sent, now the owner's", (await s.state()).recipes.mine?.title === "Only on this phone so far" && adopted.legacyBox === null && adopted.box.length === 0);

  // --- the phone stamps what it keeps and sends
  await page.evaluate(() => { const f = window.fetch; window.__sent = []; window.fetch = (u, o = {}) => { if (o.method === "PUT" || o.method === "DELETE") window.__sent.push({ u: String(u), h: o.headers }); return f(u, o); }; });
  await page.evaluate(() => { state.pantry.p1 = { id: "p1", item: "lemons", aisle: "produce" }; return store.put("pantry", "p1", state.pantry.p1); });
  const sent = await page.evaluate(() => window.__sent);
  check("every write sends X-Bourdain-Data: 2", sent.length === 1 && sent[0].h["X-Bourdain-Data"] === "2", JSON.stringify(sent));
  await s.stop();
  await page.evaluate(() => { store.online = false; state.pantry.p2 = { id: "p2", item: "rice", aisle: "pantry" }; return store.put("pantry", "p2", state.pantry.p2); });
  const ob = await page.evaluate((id) => JSON.parse(localStorage.getItem("bourdain.outbox:" + id)), owner);
  check("outbox entries are stamped dv 2 and with who made them", ob.length === 1 && ob[0].dv === 2 && ob[0].uid === owner, JSON.stringify(ob));
  await s.restart();
  await page.evaluate(() => store.flush()); await sleep(300);
  check("the queued write syncs once the server is back", Boolean((await s.state()).pantry.p2));

  // --- the server was rolled back to 1.x while this phone runs 2.0
  let hits = 0;
  await page.route("**/api/pantry/**", (r) => { hits++; r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "newer app", code: "data_newer" }) }); });
  const res = await page.evaluate(() => { state.pantry.p3 = { id: "p3", item: "eggs", aisle: "dairy & eggs" }; return store.put("pantry", "p3", state.pantry.p3); });
  const aside = await page.evaluate((id) => ({ parked: JSON.parse(localStorage.getItem("bourdain.outbox.parked") || "[]"), box: JSON.parse(localStorage.getItem("bourdain.outbox:" + id) || "[]"), toast: document.getElementById("toast").textContent }), owner);
  check("refused as too new: not 'Saved', kept aside on the phone, not dropped", res === false && aside.parked.some((o) => o.id === "p3") && aside.box.length === 0, JSON.stringify(aside));
  check("…and the phone says why", /server is on an older version of Bourdain/.test(aside.toast), aside.toast);
  await page.evaluate(() => { state.pantry.p4 = { id: "p4", item: "milk" }; return store.put("pantry", "p4", state.pantry.p4); });
  check("…after that it stops sending until reopened", hits === 1, `${hits} attempts`);
  await page.unroute("**/api/pantry/**");

  // --- reopened against a 2.x server: set-aside changes go back in the queue
  await page.evaluate((id) => {
    const kept = JSON.parse(localStorage.getItem("bourdain.outbox.parked") || "[]");
    kept.push({ col: "recipes", id: "parked1x", dv: 2, doc: { title: "Written by 2.0, set aside by 1.x" } }); // 1.x's own set-aside had no uid
    kept.push({ col: "recipes", id: "future", dv: 3, doc: { title: "From a future app" } });
    kept.push({ col: "recipes", id: "theirs", dv: 2, uid: "someone-else", doc: { title: "Another person's" } });
    localStorage.setItem("bourdain.outbox.parked", JSON.stringify(kept));
  }, owner);
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(600);
  const back = await s.state();
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem("bourdain.outbox.parked") || "[]").map((o) => o.id));
  check("set-aside changes (this version, this person) are sent once the server's 2.x again", back.pantry.p3 && back.pantry.p4 && back.recipes.parked1x, JSON.stringify(Object.keys(back.pantry)));
  check("…a future version's and another person's stay set aside", JSON.stringify(left.sort()) === JSON.stringify(["future", "theirs"]) && !back.recipes.future && !back.recipes.theirs, JSON.stringify(left));

  // --- offline copies stamped newer are ignored
  await s.stop();
  await page.evaluate((id) => localStorage.setItem("bourdain:" + id, JSON.stringify({ dv: 3, recipes: { z: { title: "Only in a future app's copy" } }, plan: {}, pantry: {}, shop: {} })), owner);
  await page.reload({ waitUntil: "domcontentloaded" }); await sleep(800);
  check("offline + a dv 3 copy: its recipes aren't shown", !(await page.evaluate(() => Boolean(state.recipes.z))) && !/future app/.test(await page.textContent("#rlist")));
  await page.evaluate((id) => localStorage.setItem("bourdain:" + id, JSON.stringify({ dv: 2, recipes: { y: { title: "In this app's copy" } }, plan: {}, pantry: {}, shop: {} })), owner);
  await page.reload({ waitUntil: "domcontentloaded" }); await sleep(800);
  check("offline + a dv 2 copy: shown", /In this app's copy/.test(await page.textContent("#rlist")));

  // --- someone else signs in on this phone: the owner's copy is not theirs
  await s.restart();
  await page.route("**/api/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "someone-else", email: "sam@example.com", is_admin: false }) }));
  await page.route("**/api/state", (r) => r.abort());
  await page.evaluate(() => {
    localStorage.removeItem("bourdain.me"); // their first open on this phone
    localStorage.setItem("bourdain", JSON.stringify({ dv: 1, recipes: { leak: { title: "Left by 1.x" } }, plan: {}, pantry: {}, shop: {} }));
    localStorage.setItem("bourdain.outbox", JSON.stringify([
      { col: "recipes", id: "old1x", dv: 1, doc: { title: "Queued by 1.x (the owner's)" } },
      { col: "recipes", id: "offlineFirst", dv: 2, doc: { title: "Made before the app knew who I was" } },
    ]));
  });
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => !store.loading); await sleep(300);
  const other = await page.evaluate((id) => ({ recipes: Object.keys(state.recipes), me: store.me.id, ownerCopy: Boolean(localStorage.getItem("bourdain:" + id)), legacy: Boolean(localStorage.getItem("bourdain")) }), owner);
  check("a different person on this phone sees none of the owner's copy, and doesn't adopt 1.x leftovers", other.me === "someone-else" && !other.recipes.includes("y") && !other.recipes.includes("leak") && other.ownerCopy && other.legacy, JSON.stringify(other));
  check("…while their own set-aside change, and what they made before signing in, come to them", JSON.stringify(other.recipes.sort()) === JSON.stringify(["offlineFirst", "theirs"]), JSON.stringify(other.recipes));
  const leftovers = await page.evaluate(() => JSON.parse(localStorage.getItem("bourdain.outbox") || "[]").map((o) => o.id));
  check("…and the owner's 1.x queued change is left where it was, not given to them", JSON.stringify(leftovers) === JSON.stringify(["old1x"]), JSON.stringify(leftovers));
  await page.unroute("**/api/me"); await page.unroute("**/api/state");
  // --- Export my data, from the version sheet
  await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.click("#brand"); await page.waitForSelector('#sheet.open [data-act="export"]');
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('#sheet [data-act="export"]')]);
  const dlPath = await dl.path();
  const { readFileSync } = await import("node:fs");
  const head = readFileSync(dlPath).subarray(0, 4).toString("hex");
  check("Export my data downloads bourdain-YYYY-MM-DD.zip", /^bourdain-\d{4}-\d{2}-\d{2}\.zip$/.test(dl.suggestedFilename()) && head === "504b0304", `${dl.suggestedFilename()} ${head}`);
  check("…and says what's in it", /It has your recipes, plan, pantry and their photos/.test(await page.textContent("#toast")));
  // --- opened through Cloudflare before 2.3
  await page.route("**/api/state", (r) => r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "not set up", code: "cf_not_set_up" }) }));
  await page.reload(); await page.waitForFunction(() => !store.loading);
  check("through Cloudflare too early: says to use the home address", /can't be opened from this address yet/.test(await page.textContent("#toast")), await page.textContent("#toast"));
  await page.unroute("**/api/state");
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
