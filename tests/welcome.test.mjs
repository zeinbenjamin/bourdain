// The public welcome page (2.9.5): /welcome is the one page Cloudflare lets through without
// signing in, so a link preview shows Bourdain rather than Cloudflare's sign-in. It and everything
// it uses live in public/welcome/; it loads no data, and the app behind it still needs a sign-in.
import sharp from "sharp";
import { suite, startServer, openBrowser, CF_ENV } from "./lib.mjs";

const { check, finish } = suite("welcome");
let s, b;
try {
  // As on the NAS: Cloudflare sign-in set up, and no network trusted, so nothing gets data without a token.
  s = await startServer({ port: 20751, mock: true, named: false, env: { ...CF_ENV, TRUSTED_NETS: "" } });
  const cf = { "Cf-Ray": "8f00000000000000-SYD", "Cf-Connecting-Ip": "203.0.113.9" }; // what the tunnel adds, with no sign-in
  const get = (p, h = cf) => fetch(s.url + p, { headers: h, redirect: "manual" });

  let r = await get("/welcome");
  check("/welcome sends you on to /welcome/ (the address to share)", r.status === 301 && r.headers.get("location") === "/welcome/", `${r.status} ${r.headers.get("location")}`);
  r = await get("/welcome/");
  const html = await r.text();
  check("…which opens without signing in, through Cloudflare", r.status === 200 && /text\/html/.test(r.headers.get("content-type")) && /<h1>Bourdain/.test(html), String(r.status));
  check("…is always fresh (no-cache) and can't be framed by another site", r.headers.get("cache-control") === "no-cache" && r.headers.get("x-frame-options") === "DENY");
  const og = (prop) => (html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`)) || [])[1];
  check("the link preview: title, description, picture and address", og("og:title") === "Bourdain" && /^Save recipes from anywhere/.test(og("og:description") || "") && og("og:image") === "https://bourdain.elevengrant.com/welcome/og.png" && og("og:url") === "https://bourdain.elevengrant.com/welcome/" && /summary_large_image/.test(html), JSON.stringify({ t: og("og:title"), i: og("og:image"), u: og("og:url") }));
  check("…and it says Pilot version, not who invited you", /Pilot version/.test(html) && !/invited by/i.test(html));
  r = await get("/welcome/og.png");
  const pic = Buffer.from(await r.arrayBuffer()), meta = await sharp(pic).metadata();
  check("the preview picture is public too: a 1200 × 630 PNG", r.status === 200 && r.headers.get("content-type") === "image/png" && meta.width === 1200 && meta.height === 630, `${r.status} ${meta.width}x${meta.height}`);
  // 2.9.6: Zein's Eleven Grant logo, for Cloudflare's sign-in page (shared by all his Access applications)
  const logos = [];
  for (const v of ["dark", "light"]) {
    const svg = await get(`/welcome/elevengrant-${v}.svg`), png = await get(`/welcome/elevengrant-${v}.png`);
    const m = await sharp(Buffer.from(await png.arrayBuffer())).metadata(), text = await svg.text();
    logos.push({ v, svg: svg.status, type: svg.headers.get("content-type"), png: png.status, size: `${m.width}x${m.height}`, alpha: m.hasAlpha, clean: !/rgb\(1000/.test(text) && /^<svg /.test(text) });
  }
  check("…and the Eleven Grant logo, dark and light, as SVG and as a 512px PNG with a clear background, for Cloudflare's sign-in page", logos.every((l) => l.svg === 200 && /image\/svg\+xml/.test(l.type) && l.png === 200 && l.size === "512x512" && l.alpha && l.clean), JSON.stringify(logos));
  check("…and no Bourdain logo there any more", (await get("/welcome/logo.png")).status !== 200 || !/image\/png/.test((await get("/welcome/logo.png")).headers.get("content-type") || ""));
  check("the page uses nothing outside /welcome/ (anything else is behind sign-in) except Google Fonts", [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).every((u) => u === "/" || /^#\w+$/.test(u) || /^https:\/\/fonts\.googleapis\.com\//.test(u) || /^[\w-]+\.(webp|png)$/.test(u)), [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).join(" "));
  check("…and no script, so it runs nothing and reads no data", !/<script/i.test(html) && !/\/api\//.test(html));
  r = await get("/api/me");
  check("meanwhile the app's data still needs a sign-in (401)", r.status === 401, String(r.status));
  r = await get("/");
  const app = await r.text();
  check("the app's own page carries the same preview, pointing at the public picture", /<meta property="og:image" content="https:\/\/bourdain\.elevengrant\.com\/welcome\/og\.png">/.test(app) && /<meta property="og:title" content="Bourdain">/.test(app));

  // 2.9.8: browsers fetch the app manifest without cookies unless told otherwise, so behind
  // Cloudflare Access it was redirected to the sign-in page (a content-policy report,
  // manifest-src, from a pilot user's first visit) and Add to Home Screen got no name or icon.
  check("2.9.8: the app asks for its manifest with the sign-in cookie (crossorigin=use-credentials)", /<link rel="manifest" href="\/manifest\.webmanifest" crossorigin="use-credentials">/.test(app), (app.match(/<link rel="manifest"[^>]*>/) || ["none"])[0]);

  // On a phone
  b = await openBrowser();
  const { page, errors } = b;
  const asked = [];
  page.on("request", (q) => { const u = new URL(q.url()); if (u.origin === new URL(s.url).origin) asked.push(u.pathname); });
  for (const w of [390, 360]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto(s.url + "/welcome");
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, btn: document.querySelector(".btn").getBoundingClientRect().height, href: document.querySelector(".btn").getAttribute("href"), imgs: [...document.images].map((i) => i.naturalWidth > 0) }));
    check(`at ${w}px: no sideways scroll, every picture shows, Open Bourdain is a 44px+ button to the app`, m.over <= 0 && m.btn >= 44 && m.href === "/" && m.imgs.length === 4 && m.imgs.every(Boolean), JSON.stringify(m));
  }
  check("…and the page asked the server for nothing but itself and its pictures", asked.filter((p) => !p.startsWith("/welcome")).filter((p) => p !== "/favicon.ico").length === 0, asked.join(" "));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
