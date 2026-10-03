// Signing in (2.3): Cloudflare Access tokens checked on the server, the home
// network as the owner, everyone's data kept to themselves, the owner's view and
// limits for other people, the photo storage cap, the link fetcher refusing
// private addresses (#14), and the phone's "Signed out" state.
import sharp from "sharp";
import { suite, startServer, openBrowser, openApp, sleep, CF_ENV, viaCf, cfToken, otherKey } from "./lib.mjs";

const { check, finish } = suite("signin");
let s, b, b2;
try {
  s = await startServer({ port: 20201, mock: true, named: false, env: { ...CF_ENV, ANTHROPIC_API_KEY: "sk-ant-test", TRUSTED_NETS: "" } });
  const call = async (method, p, headers = {}, body) => {
    const r = await fetch(s.url + p, { method, headers: { ...headers, ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) }, body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  const OWNER = viaCf("owner@example.com"), SAM = viaCf("sam@example.com");

  // --- who gets in
  check("/api/health stays open", (await call("GET", "/api/health")).status === 200);
  let r = await call("GET", "/api/state");
  check("no token, not through Cloudflare, not a trusted network: 401 not_trusted", r.status === 401 && r.j?.code === "not_trusted", JSON.stringify(r));
  check("…saying which address it saw, so a wrong TRUSTED_NETS can be spotted", /^(127\.0\.0\.1|::1)$/.test(r.j?.seen), JSON.stringify(r.j));
  check("…and logging it once, with the trusted list", /refused a request from (127\.0\.0\.1|::1) with no Cloudflare sign-in: it isn't in TRUSTED_NETS \(empty\)/.test(s.log()) && s.log().split("refused a request from").length === 2);
  await call("GET", "/api/state");
  r = await call("GET", "/api/state", viaCf(undefined));
  check("through Cloudflare with no token (Access not guarding it, or expired): 401 signed_out", r.status === 401 && r.j?.code === "signed_out", JSON.stringify(r));
  r = await call("GET", "/api/me", OWNER);
  check("a valid token for OWNER_EMAIL is the owner, and the admin", r.status === 200 && r.j.email === "owner@example.com" && r.j.is_admin === true, JSON.stringify(r));
  check("…whatever the email's capitals", (await call("GET", "/api/me", viaCf("Owner@Example.COM"))).j?.is_admin === true);
  check("the team's keys were fetched from Cloudflare", /MOCK_CF_CERTS https:\/\/bourdain-test\.cloudflareaccess\.com\/cdn-cgi\/access\/certs/.test(s.log()));
  r = await call("GET", "/api/me", SAM);
  check("someone new gets their own account, not an admin, with no name yet", r.status === 200 && r.j.email === "sam@example.com" && r.j.is_admin === false && r.j.name === null, JSON.stringify(r));
  const samId = r.j.id;
  check("…and it's the same account next time", (await call("GET", "/api/me", SAM)).j.id === samId);

  const bad = {
    "for another app (aud)": viaCf("sam@example.com", { aud: ["someone-elses-app"] }),
    "from another team (iss)": viaCf("sam@example.com", { iss: "https://evil.cloudflareaccess.com" }),
    "expired": viaCf("sam@example.com", { exp: Math.floor(Date.now() / 1000) - 3600 }),
    "signed with another key": viaCf("sam@example.com", { key: otherKey }),
    "an unknown key id": viaCf("sam@example.com", { kid: "nope" }),
    "no email (a service token)": viaCf(null),
    "not a token": { ...viaCf(undefined), "Cf-Access-Jwt-Assertion": "garbage" },
    "alg none": { ...viaCf(undefined), "Cf-Access-Jwt-Assertion": Buffer.from('{"alg":"none"}').toString("base64url") + "." + Buffer.from(JSON.stringify({ email: "owner@example.com", aud: ["test-aud"], iss: "https://bourdain-test.cloudflareaccess.com", exp: 9e9 })).toString("base64url") + "." },
  };
  const t = cfToken("sam@example.com").split(".");
  bad["a changed email"] = { ...viaCf(undefined), "Cf-Access-Jwt-Assertion": [t[0], Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(t[1], "base64url")), email: "owner@example.com" })).toString("base64url"), t[2]].join(".") };
  const refused = [];
  for (const [label, h] of Object.entries(bad)) { const x = await call("GET", "/api/me", h); if (!(x.status === 401 && x.j?.code === "signed_out")) refused.push(`${label}: ${x.status}`); }
  check("bad tokens are all refused with 401 signed_out (wrong app, team, expired, forged, altered, no email)", refused.length === 0, refused.join("; "));
  check("…and a plain email header means nothing", (await call("GET", "/api/me", { "Cf-Access-Authenticated-User-Email": "owner@example.com" })).status === 401);

  // --- each person's data is their own
  await call("PUT", "/api/me", OWNER, { name: "Zein" });
  await call("PUT", "/api/recipes/o1", OWNER, { title: "Owner's dal" });
  await call("PUT", "/api/recipes/s1", SAM, { title: "Sam's laksa" });
  const os = (await call("GET", "/api/state", OWNER)).j, ss = (await call("GET", "/api/state", SAM)).j;
  check("each person's state holds only their own recipes", Object.keys(os.recipes).join() === "o1" && Object.keys(ss.recipes).join() === "s1");
  await call("DELETE", "/api/recipes/o1", SAM);
  await call("PUT", "/api/recipes/o1", SAM, { title: "Sam overwrote it?" });
  check("…and nobody can delete or overwrite someone else's", (await call("GET", "/api/state", OWNER)).j.recipes.o1?.title === "Owner's dal");
  await call("DELETE", "/api/recipes/o1", SAM);
  check("…though they can read it, as 2.1 allows", (await call("GET", `/api/people/${(await call("GET", "/api/me", OWNER)).j.id}/recipes/o1`, SAM)).j?.recipe?.title === "Owner's dal");

  // --- the owner's view and the limits, for someone who isn't the owner
  r = await call("GET", "/api/admin/summary", SAM);
  const r2 = await call("PUT", "/api/admin/limits", SAM, { defaults: { import: 1000 } }), r3 = await call("GET", "/api/admin/activity", SAM);
  check("the owner's view is refused to anyone else (403 not_admin)", [r, r2, r3].every((x) => x.status === 403 && x.j?.code === "not_admin"), JSON.stringify([r.status, r2.status, r3.status]));
  r = await call("GET", "/api/admin/summary", OWNER);
  check("…and shows the owner how this request was recognised", r.status === 200 && r.j.signin.cloudflare === true && r.j.signin.team === "bourdain-test" && r.j.signin.you.how === "Cloudflare" && r.j.signin.you.cloudflare === true, JSON.stringify(r.j?.signin));
  check("…with Sam among the people", r.j.people.some((p) => p.email === "sam@example.com" && !p.is_admin));
  await call("PUT", "/api/admin/limits", OWNER, { defaults: { import: 1 } });
  const i1 = await call("POST", "/api/ai", SAM, { kind: "import", material: { text: "x" } }), i2 = await call("POST", "/api/ai", SAM, { kind: "import", material: { text: "y" } });
  check("AI limits hold for someone else", i1.status === 200 && i2.status === 429 && i2.j.code === "ai_limit", JSON.stringify([i1.status, i2.j]));
  const i3 = await call("POST", "/api/ai", OWNER, { kind: "import", material: { text: "x" } }), i4 = await call("POST", "/api/ai", OWNER, { kind: "import", material: { text: "y" } });
  check("…while the owner stays exempt", i3.status === 200 && i4.status === 200);

  // --- photo storage
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer();
  const form = () => { const f = new FormData(); f.append("photo", new Blob([jpeg], { type: "image/jpeg" }), "p.jpg"); return f; };
  await call("PUT", "/api/admin/limits", OWNER, { user: samId, overrides: { storage_mb: 0 } });
  r = await call("POST", "/api/photos", SAM, form());
  check("over the photo storage cap: 413 storage_full with the limit", r.status === 413 && r.j.code === "storage_full" && r.j.limit === 0, JSON.stringify(r));
  check("…the owner isn't held to it", (await call("POST", "/api/photos", OWNER, form())).status === 200);
  await call("PUT", "/api/admin/limits", OWNER, { user: samId, overrides: null });
  r = await call("POST", "/api/photos", SAM, form());
  const sum = (await call("GET", "/api/admin/summary", OWNER)).j;
  check("within it, the photo uploads and counts toward that person's storage", r.status === 200 && sum.people.find((p) => p.id === samId).storage_bytes > 0 && sum.defaults.storage_mb === 500, JSON.stringify(r));
  const photoId = r.j.id;
  check("photos need a signed-in person too", (await call("GET", "/api/photos/" + photoId)).status === 401 && (await fetch(s.url + "/api/photos/" + photoId, { headers: OWNER })).status === 200);

  const acts = (await call("GET", "/api/admin/activity?user=" + samId, OWNER)).j;
  check("signing in is on the activity log", acts.some((a) => a.action === "signed_in" && a.target === "Cloudflare"), JSON.stringify(acts.slice(-3)));
  const health = (await call("GET", "/api/admin/summary", OWNER)).j.health;
  check("health: signing in is operational once Cloudflare's keys have loaded", health.auth.status === "ok" && /Cloudflare Access \(bourdain-test\)/.test(health.auth.detail), JSON.stringify(health.auth));
  check("a new person is in the audit log", (await call("GET", "/api/admin/audit", OWNER)).j.some((a) => a.action === "person_joined" && a.detail === "sam@example.com"));

  // --- pausing someone (owner's view, 2.4)
  await call("PUT", "/api/me", SAM, { name: "Sam" });
  r = await call("PUT", "/api/admin/people/" + samId, SAM, { paused: true });
  check("only the owner can pause someone", r.status === 403 && r.j?.code === "not_admin");
  r = await call("PUT", "/api/admin/people/" + samId, OWNER, { paused: true });
  const samState = await call("GET", "/api/state", SAM), samExport = await fetch(s.url + "/api/export", { headers: SAM });
  check("paused: Sam gets 403 account_disabled, but can still export their data", r.j?.paused === true && samState.status === 403 && samState.j?.code === "account_disabled" && samExport.status === 200, JSON.stringify([r.j, samState]));
  check("…and is hidden from everyone else (people, search)", !(await call("GET", "/api/people", OWNER)).j.some((p) => p.id === samId) && (await call("GET", "/api/search?q=laksa", OWNER)).j.length === 0);
  await call("PUT", "/api/admin/people/" + samId, OWNER, { paused: false });
  check("resumed: Sam is back", (await call("GET", "/api/state", SAM)).status === 200 && (await call("GET", "/api/people", OWNER)).j.some((p) => p.id === samId));

  // --- Cloudflare's keys can't be fetched
  await s.stop(); s.setMode({ cfCerts: "down" }); await s.restart();
  r = await call("GET", "/api/me", OWNER);
  check("Cloudflare's keys unreachable: 503 signin_unavailable, not a sign-out", r.status === 503 && r.j?.code === "signin_unavailable", JSON.stringify(r));
  s.setMode({});

  // --- the home network
  await s.restart({ TRUSTED_NETS: "127.0.0.1/32, ::1, not-a-network, ::ffff:0:0/96" });
  r = await call("GET", "/api/me");
  check("TRUSTED_NETS: no token from the home network is the owner", r.status === 200 && r.j.is_admin === true, JSON.stringify(r));
  check("…a bad entry is ignored with a log line", /ignoring "not-a-network"/.test(s.log()));
  check("…and so is an IPv6 range that would take in every IPv4 address", /ignoring "::ffff:0:0\/96": it would match every IPv4 address/.test(s.log()));
  check("…but through Cloudflare it still needs a token, whatever the address", (await call("GET", "/api/me", viaCf(undefined))).j?.code === "signed_out");
  check("…and a token still wins from home", (await call("GET", "/api/me", SAM)).j?.email === "sam@example.com");
  r = await call("GET", "/api/admin/summary");
  check("…the owner's view says so", r.j.signin.you.how === "home network" && r.j.signin.you.cloudflare === false && /^(127\.0\.0\.1|::1)$/.test(r.j.signin.you.ip) && r.j.signin.trusted.includes("127.0.0.1/32"), JSON.stringify(r.j.signin));

  // --- #14: the link fetcher only reaches public addresses
  const blocked = [];
  for (const u of ["http://127.0.0.1:20201/api/state", "http://localhost:20201/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "http://192.168.1.1/", "http://172.17.0.1/",
    "http://100.100.100.100/", "http://0.0.0.0/", "http://2130706433/", "http://0x7f.1/", "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/"]) {
    const x = await call("POST", "/api/fetch", {}, { url: u });
    if (!(x.status === 400 && x.j?.code === "blocked_address")) blocked.push(`${u}: ${x.status} ${x.j?.code}`);
  }
  check("links to private, loopback, link-local and cloud-metadata addresses are refused (400 blocked_address)", blocked.length === 0, blocked.join("; "));
  check("…and nothing was fetched from them", !/"GET \/api\/state/.test(s.log()) && !/fetch failed/.test(s.log()));
  check("a link that isn't http(s) is refused", (await call("POST", "/api/fetch", {}, { url: "file:///etc/passwd" })).j?.code === "bad_url");
  // 2.5.4: ::ffff:0:0/96 in the list made Node's BlockList refuse every IPv4 address, so every
  // website was "private" from 2.3.0 on. Public addresses and names must get as far as fetching.
  const passed = [];
  for (const u of ["http://157.240.8.174/", "http://8.8.8.8/", "http://[2a03:2880:f275:1e9:face:b00c:0:4420]/", "https://www.instagram.com/reel/Dd-9fPHSUb_/", "https://www.tiktok.com/t/ZPLeaQbpv/"]) {
    const x = await call("POST", "/api/fetch", {}, { url: u });
    if (x.j?.code === "blocked_address") passed.push(u);
  }
  check("public addresses and sites are not refused as private (Instagram, TikTok, plain IPv4 and IPv6)", passed.length === 0, passed.join("; "));
  check("…and no public address was logged as private", !/refused to fetch (http:\/\/157|http:\/\/8\.8|http:\/\/\[2a03|https:\/\/www\.(instagram|tiktok))/.test(s.log()), (s.log().match(/refused to fetch.*/g) || []).join(" | "));
  // 2.5.5: who fetched which kind of link is in the activity log, by site only
  await call("POST", "/api/fetch", SAM, { url: "http://192.168.1.1/secret-path?token=abc" });
  await call("POST", "/api/fetch", SAM, { url: "https://www.tiktok.com/t/ZPLeaQbpv/" });
  const links = (await call("GET", "/api/admin/activity?cat=links&limit=50", OWNER)).j || [];
  const samLinks = links.filter((r) => r.user && r.action === "link_fetched" && /sam/i.test(r.name));
  check("a link fetch is in the activity log: who, which site, and how it went", samLinks.some((r) => r.target === "192.168.1.1 · refused as private") && samLinks.some((r) => /^tiktok\.com · /.test(r.target)), JSON.stringify(links.slice(0, 4)));
  check("…the site only, never the rest of the link", !links.some((r) => /secret-path|token|ZPLeaQbpv/.test(r.target)));
  const others = [...((await call("GET", "/api/admin/activity?cat=nosignin&limit=200", OWNER)).j || []), ...((await call("GET", "/api/admin/activity?cat=content&limit=200", OWNER)).j || [])];
  check("…under its own filter, kept out of the rest of the activity", others.length > 0 && !others.some((r) => r.action === "link_fetched"));
  check("…and the server log says who asked", /refused to fetch http:\/\/192\.168\.1\.1\/secret-path\?token=abc for sam@example\.com/.test(s.log()));

  // --- the phone: a new person sees the welcome
  b2 = await openBrowser();
  await b2.ctx.setExtraHTTPHeaders(viaCf("ava@example.com"));
  await openApp(b2.page, s.url);
  await b2.page.waitForSelector("#sheet.open");
  check("someone signing in for the first time is asked their name", /ava/i.test(await b2.page.inputValue("#sheet input[type=text], #sheet input:not([type])").catch(() => "")) || /name/i.test(await b2.page.textContent("#sheet")));
  check("…and is not the admin", await b2.page.evaluate(() => store.me && store.me.email === "ava@example.com" && store.me.is_admin === false));
  await b2.browser.close(); b2 = null;

  // --- the phone: signed out
  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  check("from home the app opens as the owner, no bar", await page.evaluate(() => store.me?.is_admin === true) && !(await page.isVisible("#signinBar")));
  await page.route("**/api/recipes/**", (rt) => rt.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "signed out", code: "signed_out" }) }));
  const res = await page.evaluate(() => { state.recipes.w1 = { title: "Written while signed out" }; return store.put("recipes", "w1", state.recipes.w1); });
  await sleep(200);
  const st = await page.evaluate(() => ({ box: store.outbox.map((o) => o.id), sub: document.getElementById("syncSub").textContent, bar: document.getElementById("signinBar").textContent, toast: document.getElementById("toast").textContent }));
  check("a write while signed out: not 'Saved', kept on the phone", res === false && st.box.includes("w1"), JSON.stringify(st));
  check("…the red bar says Signed out, tap to sign in", await page.isVisible("#signinBar") && /Signed out\. Tap to sign in again\./.test(st.bar));
  check("…the header says Signed out, not Offline", /Signed out/.test(st.sub) && !/Offline/.test(st.sub), st.sub);
  check("…and the toast says it syncs once you sign in", /sync once you sign in again/.test(st.toast), st.toast);
  await page.evaluate(() => store.flush()); await sleep(200);
  check("…retrying doesn't drop it", await page.evaluate(() => store.outbox.some((o) => o.id === "w1")));
  await page.unroute("**/api/recipes/**");

  // Cloudflare's own way of saying it: a redirect to its login page
  await page.route("**/api/**", (rt) => rt.fulfill({ status: 302, headers: { location: "https://bourdain-test.cloudflareaccess.com/cdn-cgi/access/login/x" } }));
  await page.reload(); await page.waitForFunction(() => !store.loading);
  check("a redirect to Cloudflare's login is seen as signed out, with this phone's copy shown", await page.isVisible("#signinBar") && /Signed out/.test(await page.textContent("#syncSub")) && /You're signed out/.test(await page.textContent("#toast")), await page.textContent("#toast"));
  check("…the unsynced change is still there", await page.evaluate(() => store.outbox.some((o) => o.id === "w1") && Boolean(state.recipes.w1)));
  await page.unroute("**/api/**");
  await page.route("**/api/**", (rt) => rt.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Sign in ・ Cloudflare Access</title>" }));
  await page.reload(); await page.waitForFunction(() => !store.loading);
  check("Cloudflare's login page served in place of JSON: signed out too, change still waiting", await page.isVisible("#signinBar") && await page.evaluate(() => store.outbox.some((o) => o.id === "w1")));
  await page.unroute("**/api/**");

  // signing in again (the tap reloads; Cloudflare would ask here)
  await Promise.all([page.waitForEvent("load"), page.click("#signinBar")]);
  await page.waitForFunction(() => !store.loading); await sleep(500);
  check("after signing in again: no bar, and the waiting change reaches the server", !(await page.isVisible("#signinBar")) && (await (await fetch(s.url + "/api/state")).json()).recipes.w1?.title === "Written while signed out");

  await page.route("**/api/state", (rt) => rt.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "x", code: "not_trusted", seen: "172.16.0.1" }) }));
  await page.route("**/api/admin/summary", (rt) => rt.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "x", code: "not_trusted", seen: "172.16.0.1" }) }));
  await page.reload(); await page.waitForFunction(() => !store.loading);
  check("an untrusted network gets its own words, with the address the server saw", /doesn't recognise this network \(it sees this device as 172\.16\.0\.1\)/.test(await page.textContent("#signinBar")), await page.textContent("#signinBar"));
  await page.evaluate(() => openAdmin()); await page.waitForFunction(() => state.admin);
  check("…and the owner's view says the same, not 'check the server logs'", /it sees this device as 172\.16\.0\.1/.test(await page.textContent("#view-admin")) && !/server logs/.test(await page.textContent("#view-admin")), await page.textContent("#view-admin"));
  await page.unroute("**/api/state"); await page.unroute("**/api/admin/summary");
  await page.reload(); await page.waitForFunction(() => !store.loading);

  // the link fetcher's refusal, in the import form
  await page.click('#tabs button[data-view="recipes"]'); await page.click("#btnManual"); await page.click('#sheet [data-act="import"]');
  await page.fill("#srcUrl", "http://192.168.1.1/recipe"); await page.click("#btnFetch");
  await page.waitForFunction(() => document.querySelector("#importStatus").classList.contains("err"));
  check("import from a private link: says why", /points inside a private network/.test(await page.textContent("#importStatus")), await page.textContent("#importStatus"));

  // the owner's view shows how the server sees this phone
  await page.evaluate(() => openAdmin()); await page.waitForSelector("#view-admin.active .adm-title");
  const adm = await page.textContent("#view-admin");
  check("the owner's view: Signing in shows the setup and this phone's address", /Cloudflare Access \(team bourdain-test\)/.test(adm) && /Recognised by\s*home network/.test(adm) && /Came through Cloudflare\s*No/.test(adm), adm.slice(adm.indexOf("Signing in"), adm.indexOf("Signing in") + 300));
  check("…signing in shows as operational in System health", /Signing in[\s\S]*Operational/.test(adm));
  await page.evaluate(() => adminGo("ai")); await page.waitForSelector("#lim_storage_mb");
  check("…and photo storage is in the overview and the limits", /Storage/.test(adm) && await page.isVisible("#lim_storage_mb"));
  // a paused account, on the phone
  await page.route("**/api/state", (rt) => rt.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "paused", code: "account_disabled" }) }));
  await page.reload(); await page.waitForFunction(() => !store.loading);
  check("a paused account says so on the red bar, not Offline", /account is paused/.test(await page.textContent("#signinBar")) && !/Offline/.test(await page.textContent("#syncSub")), await page.textContent("#signinBar"));
  await page.unroute("**/api/state");
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await b2?.browser.close(); await s?.cleanup(); }
