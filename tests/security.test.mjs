// Security review fixes (2.3.3): someone else's recipe can't run code in your
// session, a website can't use your browser to reach the NAS as you (DNS
// rebinding, cross-site changes), oversized writes are refused, photo storage
// counts only photos in use, and one malformed cook can't break the Archives.
import path from "node:path";
import http from "node:http";
import Database from "better-sqlite3";
import sharp from "sharp";
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("security");
let s, b;
// A raw request, so the Host header can be anything (fetch won't let us set it).
const raw = (port, { method = "GET", path: p = "/api/me", host, headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...(host ? { host } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, j }); });
  });
  r.on("error", reject); if (body) r.write(body); r.end();
});
try {
  s = await startServer({ port: 20301 });
  const db = () => new Database(path.join(s.data, "bourdain.db"));
  const PWN = "window.__pwned=(window.__pwned||0)+1";
  const evil = {
    title: `<img src=x onerror="${PWN}">Laksa`, description: `<script>${PWN}</script>`,
    photos: [`x" onerror="${PWN}`], cover: `y" onerror="${PWN}`, rating: `1" onmouseover="${PWN}`,
    source_url: `javascript:${PWN}`, tags: [`<b onmouseover="${PWN}">x</b>`],
    ingredients: [{ item: `<img src=x onerror="${PWN}">`, unit: `<i onclick="${PWN}">g</i>`, quantity: 2 }], steps: [`<img src=x onerror="${PWN}">`],
    cooks: [{ date: "2026-09-28", at: "2026-09-28T19:00:00Z", mult: `<img src=x onerror="${PWN}">` }, { date: 5, mult: 2 }, { date: "<b>", mult: 1 }],
  };
  const d = db();
  d.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('sam', 'sam@example.com', 'Sam', datetime())").run();
  d.prepare("INSERT INTO recipes (owner, id, doc, updated_at) VALUES ('sam', 'evil', ?, datetime())").run(JSON.stringify(evil));
  d.close();

  // --- the server tidies what other people's phones are sent
  const feed = await (await fetch(s.url + "/api/feed")).json();
  const f = feed.entries.filter((e) => e.owner === "sam");
  check("feed: malformed cooks are left out, not sent on", f.length === 1 && f[0].date === "2026-09-28", JSON.stringify(f));
  check("feed: cover, photo, rating and batch are the types the app expects", f[0].cover === null && f[0].firstPhoto === null && f[0].rating === null && f[0].mult === 1, JSON.stringify(f[0]));
  const hits = await (await fetch(s.url + "/api/search?q=laksa")).json();
  check("search: the same", hits.length === 1 && hits[0].cover === null && hits[0].firstPhoto === null && hits[0].rating === null, JSON.stringify(hits));

  // --- the phone: someone else's recipe can't run anything
  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  const pwned = () => page.evaluate(() => window.__pwned || 0);
  const handlers = () => page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).map((el) => el.outerHTML.slice(0, 80)));
  await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector('[data-owner="sam"]'); await sleep(400);
  check("Archives: Sam's cook shows, and nothing in it runs", (await pwned()) === 0 && (await handlers()).length === 0, JSON.stringify(await handlers()));
  await page.click('[data-owner="sam"]'); await page.waitForSelector("#view-theirs h2"); await sleep(400);
  const src = await page.$eval("#view-theirs .source a", (a) => a.getAttribute("href")).catch(() => "none");
  check("Sam's recipe opens with the title as text, and nothing runs", /<img src=x/.test(await page.textContent("#view-theirs h2")) && (await pwned()) === 0 && (await handlers()).length === 0, JSON.stringify(await handlers()));
  check("…a javascript: source link is not a link", src === "" || src === null, String(src));
  check("…a bad photo or cover id makes no image request", await page.evaluate(() => [...document.querySelectorAll("#view-theirs img")].every((i) => !i.getAttribute("src") || /^\/api\/(photos|covers)\/[a-f0-9]{32}$|^\/avatars\/[a-z-]+\.webp$|^blob:/.test(i.getAttribute("src")))));
  await page.hover("#view-theirs .source").catch(() => {}); await page.hover("#view-theirs .cstars, #view-theirs .fromline").catch(() => {});
  await page.click('#view-theirs button:has-text("Add to my recipes")'); await page.waitForSelector("#view-detail h2"); await sleep(400);
  check("…and a copy of it in your own book is just as harmless", (await pwned()) === 0 && (await handlers()).length === 0, JSON.stringify(await handlers()));
  await page.click('#tabs button[data-view="recipes"]'); await page.fill("#search", "laksa"); await sleep(900);
  check("search results: nothing runs", (await pwned()) === 0 && (await handlers()).length === 0);

  // --- DNS rebinding: the home network is only the owner under a home address
  const P = 20301;
  const ok = [];
  for (const host of ["localhost:20301", "127.0.0.1:20301", "192.168.1.109:8080", "[::1]:20301", "truenas", "truenas.local", "nas.lan", "truenas.tail1234.ts.net"])
    if ((await raw(P, { host })).status !== 200) ok.push(host);
  check("home addresses still work: IPs, localhost, plain, .local, .lan and Tailscale names", ok.length === 0, ok.join(", "));
  const reb = await raw(P, { host: "evil.example.com" }), reb2 = await raw(P, { host: "192.168.1.109.nip.io" });
  check("a web address pointed at the NAS (DNS rebinding) is refused: 403 unknown_host", reb.status === 403 && reb.j?.code === "unknown_host" && reb.j?.seen === "evil.example.com" && reb2.j?.code === "unknown_host", JSON.stringify([reb, reb2]));
  check("…and logged once, with what to do", /refused a request for evil\.example\.com: .*HOME_HOSTS/.test(s.log()));
  await s.restart({ HOME_HOSTS: "kitchen.example.com" });
  check("HOME_HOSTS lets a name of your own in", (await raw(P, { host: "kitchen.example.com" })).status === 200 && (await raw(P, { host: "evil.example.com" })).status === 403);

  // --- cross-site changes
  const cross = await raw(P, { method: "PUT", path: "/api/recipes/x", headers: { "sec-fetch-site": "cross-site" }, body: '{"title":"from another site"}' });
  const same = await raw(P, { method: "PUT", path: "/api/recipes/x", headers: { "sec-fetch-site": "same-origin" }, body: '{"title":"from Bourdain"}' });
  const crossGet = await raw(P, { path: "/api/state", headers: { "sec-fetch-site": "cross-site" } });
  check("a change sent from another website is refused (403 cross_site)", cross.status === 403 && cross.j?.code === "cross_site" && same.status === 204, JSON.stringify([cross, same.status]));
  check("…reads aren't affected (a browser won't show another site the answer anyway)", crossGet.status === 200);

  // --- sizes
  const big = "x".repeat(3 * 1024 * 1024);
  const tooBig = await raw(P, { method: "PUT", path: "/api/recipes/big", body: JSON.stringify({ title: "Big", notes: big }) });
  check("a 3 MB recipe is refused (413 too_large)", tooBig.status === 413 && tooBig.j?.code === "too_large", JSON.stringify(tooBig));
  const aiBig = await raw(P, { method: "POST", path: "/api/ai", body: JSON.stringify({ kind: "scan", images: [{ media_type: "image/jpeg", data: big }] }) });
  check("…while /api/ai still takes a few MB of screenshots (no key here, so no_api_key, not too_large)", aiBig.j?.code === "no_api_key", JSON.stringify(aiBig));
  const resp = await fetch(s.url + "/api/me");
  check("responses say nosniff and same-origin referrers", resp.headers.get("x-content-type-options") === "nosniff" && resp.headers.get("referrer-policy") === "same-origin");

  // --- photo storage counts photos in use
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer();
  const up = async () => { const fd = new FormData(); fd.append("photo", new Blob([jpeg], { type: "image/jpeg" }), "p.jpg"); const r = await fetch(s.url + "/api/photos", { method: "POST", body: fd }); return r.json(); };
  const owner = (await (await fetch(s.url + "/api/me")).json()).id;
  const p1 = await up(), p2 = await up();
  await s.put("recipes", "withphoto", { title: "With photo", photos: [p1.id] });
  { const d2 = db(); d2.prepare("UPDATE photos SET created_at = ? WHERE owner = ?").run(new Date(Date.now() - 2 * 86_400_000).toISOString(), owner); d2.close(); }
  const sum = await (await fetch(s.url + "/api/admin/summary")).json();
  const bytes = { used: sum.people.find((p) => p.id === owner).storage_bytes, one: (() => { const d3 = db(); const r = d3.prepare("SELECT bytes FROM photos WHERE id = ?").get(p1.id).bytes; d3.close(); return r; })() };
  check("photo storage counts photos in use, not ones removed a while ago", bytes.used === bytes.one && p2.id, JSON.stringify(bytes));

  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
