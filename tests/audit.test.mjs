// Fixes from the 2.9.2 security audit. The owner is only ever decided by where the connection
// really comes from (or a Cloudflare sign-in), never a Host or X-Forwarded-For header; a request
// that's refused is refused before its body is read; only JPEG, PNG and WebP reach the image
// library, never SVG or a picture that unpacks to gigabytes; and AI limits hold when many
// requests arrive at once. Plus the link fetcher's handling of unusual ways to write an address.
import http from "node:http";
import { crc32, deflateSync } from "node:zlib";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { suite, startServer, openBrowser, openApp, CF_ENV, viaCf, OWNER_EMAIL_FOR_TESTS, sleep } from "./lib.mjs";

const { check, finish } = suite("audit");
let s, b;
// A raw request, so Host and X-Forwarded-For can be anything, and a big body can be sent
// without waiting for it to go: we only want to know how (and how soon) the server answers.
const raw = (port, { method = "GET", path: p = "/api/me", headers = {}, body } = {}) => new Promise((resolve) => {
  const t0 = Date.now();
  const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...(body ? { "content-type": "application/json", "content-length": body.length } : {}), ...headers } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, j, ms: Date.now() - t0 }); });
  });
  r.on("error", (e) => resolve({ status: 0, error: e.code })); // the server may close before the whole body is sent
  if (body) r.write(body); r.end();
});
// A PNG whose header says 20000 × 20000 (400 megapixels) but whose file is tiny.
const chunk = (type, data) => { const t = Buffer.from(type, "latin1"), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(20000, 0); ihdr.writeUInt32BE(20000, 4); ihdr[8] = 8; ihdr[9] = 2;
const bomb = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(1000))), chunk("IEND", Buffer.alloc(0))]);
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
const upload = async (url, buf, name = "photo.jpg", type = "image/jpeg") => { const fd = new FormData(); fd.append("photo", new Blob([buf], { type }), name); const r = await fetch(url + "/api/photos", { method: "POST", body: fd }); return { status: r.status, j: await r.json().catch(() => null) }; };
const photoFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jpg")).length : 0);
const big = (mb) => Buffer.from(JSON.stringify({ kind: "import", material: { text: "x".repeat(mb * 1024 * 1024) } }));

try {
  // --- A1: sign-in not set up, TRUSTED_NETS a network this test isn't on
  s = await startServer({ port: 20731, named: false, env: { TRUSTED_NETS: "10.9.9.0/24" } });
  let r = await raw(20731, { headers: { host: "localhost" } });
  check("A1: sign-in not set up and not from a trusted network: refused, even with Host: localhost", r.status === 401 && r.j?.code === "not_trusted" && /^(127\.0\.0\.1|::1)$/.test(r.j?.seen), JSON.stringify(r));
  r = await raw(20731, { headers: { host: "192.168.1.10:8080", "x-forwarded-for": "192.168.1.20", "x-real-ip": "10.9.9.9" } });
  check("…and with a home address in Host, X-Forwarded-For or X-Real-IP: still refused (only the connection's own address counts)", r.status === 401 && r.j?.code === "not_trusted", JSON.stringify(r));
  check("…said in the log, with the networks it would accept", /refused a request from (127\.0\.0\.1|::1) with no Cloudflare sign-in: it isn't in TRUSTED_NETS \(10\.9\.9\.0\/24\)/.test(s.log()), s.log().slice(-400));
  check("…while /api/health still answers (it holds no data)", (await raw(20731, { path: "/api/health" })).status === 200);
  // --- A3: a refused request isn't read first
  r = await raw(20731, { method: "POST", path: "/api/ai", body: big(25) });
  check("A3: a 25 MB request from an untrusted address is refused as untrusted, not read and then judged too large", r.status === 401 && r.j?.code === "not_trusted", JSON.stringify(r));
  r = await raw(20731, { method: "PUT", path: "/api/recipes/x", body: big(5) });
  check("…and the same for a 5 MB write (over the 2 MB cap), refused before it's read", r.status === 401 && r.j?.code === "not_trusted", JSON.stringify(r));
  await s.stop(); await s.cleanup(); s = null;

  // --- A1 with sign-in set up (as it is on the NAS): no token, not a trusted network
  s = await startServer({ port: 20732, mock: true, named: false, env: { ...CF_ENV, TRUSTED_NETS: "10.9.9.0/24" } });
  r = await raw(20732, { headers: { host: "localhost", "x-forwarded-for": "10.9.9.9" } });
  check("A1 with Cloudflare sign-in on: a spoofed Host and X-Forwarded-For from outside TRUSTED_NETS are refused", r.status === 401 && r.j?.code === "not_trusted", JSON.stringify(r));
  r = await raw(20732, { headers: { host: "localhost", "cf-ray": "8f00000000000000-SYD" } });
  check("…and anything that came through Cloudflare without a token is signed out, whatever its Host", r.status === 401 && r.j?.code === "signed_out", JSON.stringify(r));
  r = await raw(20732, { method: "POST", path: "/api/ai", headers: { "cf-ray": "8f00000000000000-SYD", "cf-connecting-ip": "203.0.113.9" }, body: big(25) });
  check("A3 with sign-in on: a 25 MB request through Cloudflare with no token is signed out before it's read", r.status === 401 && r.j?.code === "signed_out", JSON.stringify(r));
  r = await raw(20732, { method: "POST", path: "/api/ai", headers: viaCf(OWNER_EMAIL_FOR_TESTS), body: big(31) });
  check("…while a signed-in request over the cap is still read and refused as too large", r.status === 413 && r.j?.code === "too_large", JSON.stringify(r));
  await s.stop(); await s.cleanup(); s = null;

  // --- sign-in not set up, no TRUSTED_NETS: this machine is home, as before
  s = await startServer({ port: 20733, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-test" } });
  r = await raw(20733);
  check("not set up, from this machine: the owner, as before", r.status === 200 && r.j?.is_admin === true, JSON.stringify(r));
  check("…and the start-up line says who counts as the owner", /sign-in: not set up, so every request from this machine or a home network is the owner/.test(s.log()));

  // --- A2: what reaches the image library
  const dir = path.join(s.data, "photos"), before = photoFiles(dir);
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#d3072b" } }).jpeg().toBuffer();
  r = await upload(s.url, jpeg);
  check("A2: a JPEG photo still uploads", r.status === 200 && /^[a-f0-9]{32}$/.test(r.j?.id), JSON.stringify(r));
  const png = await sharp({ create: { width: 64, height: 48, channels: 4, background: "#00000000" } }).png().toBuffer(), webp = await sharp(jpeg).webp().toBuffer();
  const [rp, rw] = [await upload(s.url, png, "a.png", "image/png"), await upload(s.url, webp, "a.webp", "image/webp")];
  check("…and so do PNG and WebP", rp.status === 200 && rw.status === 200, JSON.stringify([rp, rw]));
  r = await upload(s.url, SVG, "photo.svg", "image/svg+xml");
  check("an SVG is refused before the image library sees it (415 not_an_image)", r.status === 415 && r.j?.code === "not_an_image", JSON.stringify(r));
  r = await upload(s.url, SVG, "photo.jpg", "image/jpeg");
  check("…also when it's named photo.jpg and says it's a JPEG: the file's own bytes decide", r.status === 415 && r.j?.code === "not_an_image", JSON.stringify(r));
  r = await upload(s.url, Buffer.from("GIF89a" + "x".repeat(100)), "a.gif", "image/gif");
  check("…and any other format (a GIF here)", r.status === 415, JSON.stringify(r));
  r = await upload(s.url, bomb, "a.png", "image/png");
  check("a small PNG that would unpack to 400 megapixels is refused (413 image_too_big), not decoded", r.status === 413 && r.j?.code === "image_too_big" && bomb.length < 2000, JSON.stringify(r) + " " + bomb.length);
  r = await upload(s.url, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("not really a jpeg".repeat(20))]));
  check("a broken file that starts like a JPEG fails as image_failed (the phone drops it) and the server carries on", r.status === 500 && r.j?.code === "image_failed" && (await raw(20733, { path: "/api/health" })).status === 200, JSON.stringify(r));
  r = await upload(s.url, Buffer.concat([jpeg, Buffer.alloc(11 * 1024 * 1024)]));
  check("an 11 MB upload is refused as too large (the phone sends under 1 MB)", r.status === 413 && r.j?.code === "too_large", JSON.stringify(r));
  check("…and nothing refused was stored: only the three good photos", photoFiles(dir) - before === 3, String(photoFiles(dir) - before));
  const many = await Promise.all(Array.from({ length: 6 }, () => upload(s.url, jpeg)));
  check("six photos at once all upload (two are worked on at a time; the rest wait their turn)", many.every((x) => x.status === 200), JSON.stringify(many.map((x) => x.status)));
  s.setMode({ image: "notimage" });
  r = await (await fetch(s.url + "/api/cover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipe: { title: "Dal", ingredients: [{ item: "lentils" }], steps: ["Cook."] } }) })).json();
  check("a cover the image model sends back that isn't a picture is refused, not decoded (image_failed)", r.code === "image_failed", JSON.stringify(r));
  s.setMode({});
  r = await (await fetch(s.url + "/api/cover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipe: { title: "Dal", ingredients: [{ item: "lentils" }], steps: ["Cook."] } }) })).json();
  check("…and a real one still becomes a cover", /^[a-f0-9]{32}$/.test(r.id || ""), JSON.stringify(r));

  // --- P1 #7: AI limits when requests arrive together
  const putLimits = (body) => fetch(s.url + "/api/admin/limits", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const cost = () => s.post("/api/ai", { kind: "cost", material: { title: "Dal", servings: 4, ingredients: ["1 cup lentils"] } });
  await putLimits({ defaults: { admin_exempt: false, cost: 2 } });
  s.setMode({ claudeDelay: 800 });
  let burst = await Promise.all(Array.from({ length: 6 }, cost));
  check("P1: six cost estimates at once against a limit of 2: two go ahead, four are told the limit's reached", burst.filter((x) => x.status === 200).length === 2 && burst.filter((x) => x.code === "ai_limit").length === 4, JSON.stringify(burst.map((x) => x.status + ":" + (x.code || ""))));
  await putLimits({ defaults: { cost: 40 } });
  burst = await Promise.all(Array.from({ length: 6 }, cost));
  check("…with room under the limit, at most 3 run at once; the rest are asked to wait (ai_busy)", burst.filter((x) => x.status === 200).length === 3 && burst.filter((x) => x.code === "ai_busy").length === 3, JSON.stringify(burst.map((x) => x.status + ":" + (x.code || ""))));
  s.setMode({ claude: "529", claudeDelay: 300 });
  await Promise.all(Array.from({ length: 3 }, cost));
  s.setMode({ claudeDelay: 300 });
  burst = await Promise.all(Array.from({ length: 3 }, cost));
  check("…and calls that fail let go of their place: three more run straight after", burst.every((x) => x.status === 200), JSON.stringify(burst.map((x) => x.status + ":" + (x.code || ""))));
  const imports = await Promise.all([1, 2].map(() => s.post("/api/ai", { kind: "import", material: { text: "2 chicken thighs" } })));
  check("…and other jobs are still one at a time (ai_busy)", imports.filter((x) => x.status === 200).length === 1 && imports.some((x) => x.code === "ai_busy"), JSON.stringify(imports.map((x) => x.status)));
  s.setMode({});

  // --- A5: the link fetcher and unusual ways to write an address
  const fetchUrl = (url) => s.post("/api/fetch", { url });
  const odd = ["http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://127.1/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:a9fe:a9fe]/latest/meta-data/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[fe80::1]/", "http://0.0.0.0/", "http://localhost/", "http://100.100.100.100/"];
  const got = [];
  for (const u of odd) { const x = await fetchUrl(u); got.push(`${u} ${x.status}:${x.code || ""}`); }
  check("A5: decimal, hex, octal and short IPv4, IPv4 written as IPv6, link-local, the cloud metadata address, loopback and Tailscale are all refused (blocked_address)", got.every((x) => / 4\d\d:blocked_address$/.test(x)), got.join(" | "));
  const ftp = await fetchUrl("ftp://example.com/x"), file = await fetchUrl("file:///etc/passwd");
  check("…and anything but http and https", ftp.status >= 400 && file.status >= 400 && ![ftp, file].some((x) => x.status === 200), JSON.stringify([ftp, file]));
  check("no 5xx from any of it", !/ 5\d\d:/.test(got.join(" ")));

  // --- 2.9.3: framing refused, and a content policy (report-only for now)
  const page0 = await fetch(s.url + "/"), html = await page0.text(), api0 = await fetch(s.url + "/api/me");
  const csp = page0.headers.get("content-security-policy-report-only") || "";
  check("2.9.3: no other site may frame Bourdain (X-Frame-Options DENY and frame-ancestors 'none', enforced), on the page and the API", [page0, api0].every((r) => r.headers.get("x-frame-options") === "DENY" && r.headers.get("content-security-policy") === "frame-ancestors 'none'"), JSON.stringify([...page0.headers]));
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => "'sha256-" + createHash("sha256").update(m[1], "utf8").digest("base64") + "'");
  check("…the page's content policy lets only its own script run, by its hash, with no 'unsafe-inline' for scripts", inline.length === 1 && csp.includes(`script-src 'self' ${inline[0]}`) && !/script-src[^;]*unsafe-inline/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp) && /connect-src 'self'/.test(csp) && /report-uri \/api\/csp-report/.test(csp), csp);
  check("…and no inline event handlers left in the page (the policy wouldn't allow them)", !/\son[a-z]+="/i.test(html));
  b = await openBrowser();
  const { page, errors } = b;
  await b.ctx.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "/* fonts */" }));
  await page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`)); });
  const ph = await upload(s.url, jpeg);
  await s.put("recipes", "dal", { title: "Dal", servings: 4, photos: [ph.j.id], tags: ["easy"], steps: ["Simmer the lentils for 20 mins."], ingredients: [{ raw_text: "1 cup lentils", quantity: 1, unit: "cup", item: "lentils", aisle: "pantry" }], created_at: "2026-10-01" });
  const today = new Date(); const k = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await s.put("plan", k, { date: k, entries: [{ recipeId: "dal", servings: 4 }] });
  await openApp(page, s.url);
  // every screen once: the recipe with its photo, cook mode with a timer, the Plan and its list, Pantry, Archives, the + sheet, the import form with a screenshot, the version sheet and the owner's view
  await page.click('.rcard[data-id="dal"]'); await page.waitForSelector("#cookThis");
  await page.waitForFunction(() => [...document.querySelectorAll("#view-detail img")].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {});
  await page.click("#cookThis"); await page.waitForSelector("#cookIng"); await page.click("#cookBack");
  await page.evaluate(() => cooking.clear());
  await page.click('#tabs button[data-view="plan"]'); await page.click('.view.active [data-weekview="shop"]'); await page.click('.view.active [data-weekview="plan"]');
  await page.click('#tabs button[data-view="pantry"]'); await page.click('#tabs button[data-view="timeline"]');
  await page.click('#tabs button[data-view="add"]'); await page.click('#sheet [data-act="import"]');
  await page.setInputFiles("#srcImgs", { name: "shot.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => state.images.length === 1); await page.waitForSelector("#thumbs img");
  await page.click("#impBack"); await page.click("#brand"); await page.waitForSelector("#sheet.open");
  await page.evaluate(() => openAdmin()); await page.waitForSelector('.adm-a[data-go="gates"]');
  await sleep(500);
  check("(it was the app all along, not a blank page)", /\/$/.test(page.url()) && (await page.evaluate(() => typeof state)) === "object", page.url());
  const seen = await page.evaluate(() => window.__csp);
  check("…and nothing in the app would be blocked by it: every screen once, photos, a screenshot, cook mode, the owner's view", seen.length === 0, JSON.stringify(seen));
  check("…the fonts still switch on without an onload attribute", (await page.getAttribute("#fontcss", "media")) === "all");
  // what it would catch: a script slipped into the page, and a picture from somewhere else
  await page.evaluate(() => { const sc = document.createElement("script"); sc.textContent = "window.__slipped = 1"; document.body.appendChild(sc); const im = new Image(); im.src = "https://example.com/x.png"; });
  await page.waitForFunction(() => window.__csp.length >= 2, null, { timeout: 5000 }).catch(() => {});
  const caught = await page.evaluate(() => window.__csp);
  check("…what it would catch: a script slipped into the page and a picture from another site (reported, not yet blocked)", caught.some((x) => /^script-src/.test(x)) && caught.some((x) => /^img-src https:\/\/example\.com/.test(x)), JSON.stringify(caught));
  for (let i = 0; i < 30 && !/content policy would block script-src/.test(s.log()); i++) await sleep(200);
  const d = new Database(path.join(s.data, "bourdain.db")), rows = d.prepare("SELECT code, message FROM server_errors WHERE area = 'csp'").all(); d.close();
  check("…the browser's report reaches the server and is kept for the owner's Errors", /content policy would block script-src/.test(s.log()) && rows.some((r) => /^script-src/.test(r.code)), JSON.stringify(rows));
  const junk = await fetch(s.url + "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body: "not json" });
  const ext = await fetch(s.url + "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body: JSON.stringify({ "csp-report": { "violated-directive": "img-src", "blocked-uri": "chrome-extension://abc/x.png", "document-uri": s.url } }) });
  check("…a report that isn't JSON is refused as bad JSON, and one from a browser extension is ignored", junk.status === 400 && ext.status === 204, JSON.stringify([junk.status, ext.status]));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
