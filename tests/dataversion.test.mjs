// Data version groundwork (1.10.1): the server and the phone agree on the shape of
// stored data, so a rollback from 2.0 can't mix 2.0-shaped data into 1.x.
// See docs/multi-user.md, "Rollback".
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("dataversion");
let s, b;
try {
  s = await startServer({ port: 19501 });
  const req = (method, path, { dv, body } = {}) => fetch(s.url + path, { method, headers: { "Content-Type": "application/json", ...(dv ? { "X-Bourdain-Data": String(dv) } : {}) }, body: body && JSON.stringify(body) });

  // --- server
  const ver = await (await fetch(s.url + "/api/version")).json();
  const health = await (await fetch(s.url + "/api/health")).json();
  check("server reports data version 1", ver.dataVersion === 1 && health.dataVersion === 1, JSON.stringify({ v: ver.dataVersion, h: health.dataVersion }));
  check("write with no header (apps before 1.10.1) is accepted", (await req("PUT", "/api/recipes/old", { body: { title: "Old app" } })).status === 204);
  check("write stamped data 1 is accepted", (await req("PUT", "/api/recipes/v1", { dv: 1, body: { title: "This app" } })).status === 204);
  const r2 = await req("PUT", "/api/recipes/v2", { dv: 2, body: { title: "From 2.0" } });
  const j2 = await r2.json();
  check("write stamped data 2 is refused: 409 data_newer", r2.status === 409 && j2.code === "data_newer", JSON.stringify(j2));
  const d2 = await req("DELETE", "/api/recipes/v1", { dv: 2 });
  const st = await s.state();
  check("…and nothing from it is stored, and a data-2 delete doesn't delete", !st.recipes.v2 && st.recipes.v1 && d2.status === 409);

  // --- the phone stamps what it keeps and sends
  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  await page.evaluate(() => { const f = window.fetch; window.__sent = []; window.fetch = (u, o = {}) => { if (o.method === "PUT" || o.method === "DELETE") window.__sent.push({ u: String(u), h: o.headers }); return f(u, o); }; });
  await page.evaluate(() => { state.pantry.p1 = { id: "p1", item: "lemons", aisle: "produce" }; return store.put("pantry", "p1", state.pantry.p1); });
  const sent = await page.evaluate(() => window.__sent);
  check("every write sends X-Bourdain-Data: 1", sent.length === 1 && sent[0].h["X-Bourdain-Data"] === "1", JSON.stringify(sent));
  const mirror = await page.evaluate(() => JSON.parse(localStorage.getItem("bourdain")));
  check("the offline copy is stamped dv: 1", mirror.dv === 1 && mirror.pantry.p1);
  await s.stop();
  await page.evaluate(() => { store.online = false; state.pantry.p2 = { id: "p2", item: "rice", aisle: "pantry" }; return store.put("pantry", "p2", state.pantry.p2); });
  const ob = await page.evaluate(() => JSON.parse(localStorage.getItem("bourdain.outbox")));
  check("outbox entries are stamped dv: 1", ob.length === 1 && ob[0].dv === 1, JSON.stringify(ob));
  await s.restart();
  await page.evaluate(() => store.flush()); await sleep(300);
  check("the queued write syncs once the server is back", Boolean((await s.state()).pantry.p2));

  // --- after a rollback: what a 2.0 app left on the phone
  await page.evaluate(() => {
    localStorage.setItem("bourdain.outbox", JSON.stringify([
      { col: "recipes", id: "from2", dv: 2, doc: { title: "Written by 2.0" } },
      { col: "recipes", id: "legacy", doc: { title: "Queued by 1.9 (no stamp)" } },
      { col: "recipes", id: "v1", dv: 1, doc: { title: "Queued by 1.10.1" } },
    ]));
  });
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(600);
  const after = await s.state();
  check("newer (dv 2) change is not sent to the 1.x server", !after.recipes.from2);
  check("unstamped and dv 1 changes still sync", after.recipes.legacy?.title === "Queued by 1.9 (no stamp)" && after.recipes.v1?.title === "Queued by 1.10.1");
  const parked = await page.evaluate(() => ({ parked: JSON.parse(localStorage.getItem("bourdain.outbox.parked") || "[]"), outbox: JSON.parse(localStorage.getItem("bourdain.outbox") || "[]"), shown: Boolean(state.recipes.from2), sub: document.getElementById("syncSub").textContent }));
  check("…it's set aside on the phone, not deleted", parked.parked.length === 1 && parked.parked[0].id === "from2" && parked.parked[0].doc.title === "Written by 2.0", JSON.stringify(parked.parked));
  check("…isn't shown, isn't counted as unsynced, and has left the outbox", !parked.shown && !/not synced/.test(parked.sub) && parked.outbox.length === 0, JSON.stringify(parked));
  check("…and the phone says so", /set aside, because the server is on an older version/.test(await page.textContent("#toast")), await page.textContent("#toast"));
  await page.reload(); await page.waitForFunction(() => !store.loading);
  check("a second open doesn't set it aside twice", (await page.evaluate(() => JSON.parse(localStorage.getItem("bourdain.outbox.parked")).length)) === 1);

  // --- an offline copy written by 2.0 is ignored, not shown
  await s.stop();
  await page.evaluate(() => localStorage.setItem("bourdain", JSON.stringify({ dv: 2, recipes: { z: { title: "Only in 2.0's copy" } }, plan: {}, pantry: {}, shop: {} })));
  await page.reload({ waitUntil: "domcontentloaded" }); await sleep(800);
  check("offline + a dv 2 copy: its recipes aren't shown", !(await page.evaluate(() => Boolean(state.recipes.z))) && !/Only in 2\.0/.test(await page.textContent("#rlist")));
  await page.evaluate(() => localStorage.setItem("bourdain", JSON.stringify({ dv: 1, recipes: { y: { title: "In this app's copy" } }, plan: {}, pantry: {}, shop: {} })));
  await page.reload({ waitUntil: "domcontentloaded" }); await sleep(800);
  check("offline + a dv 1 copy: shown as before", /In this app's copy/.test(await page.textContent("#rlist")));
  await s.restart();
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
