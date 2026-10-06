// The preview in Claude (tools/preview): it still builds from today's index.html, and the
// real app runs in it on demo data with nothing reaching a server.
import http from "node:http";
import path from "node:path";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { suite, openBrowser, ROOT, sleep } from "./lib.mjs";

const { check, finish } = suite("preview");
const out = mkdtempSync(path.join(tmpdir(), "bourdain-preview-"));
let srv, b;
try {
  const log = execFileSync(process.execPath, [path.join(ROOT, "tools/preview/build.mjs"), out]).toString();
  const page_ = readFileSync(path.join(out, "index.html"), "utf8");
  const files = JSON.parse(readFileSync(path.join(out, "files.json"), "utf8"));
  check("it builds from today's index.html", /built Bourdain .* preview/.test(log), log);
  check("…as a page for the artifact: no document tags of its own, a title in the first 8KB", !/<!doctype|<html|<head>|<body>/i.test(page_) && /<title>Bourdain preview<\/title>/.test(page_.slice(0, 8192)));
  check("…with no service worker, manifest or placeholders left", !/serviceWorker\?\.register|rel="manifest"|__APP_(VERSION|COMMIT)__/.test(page_));
  check("…and every picture it needs listed to publish with it", files.length >= 30 && files.every((f) => existsSync(path.join(out, f.path))), files.length);
  check("no API key or real address in it", !/sk-ant-[\w-]{8}|sk-[A-Za-z0-9]{20}|elevengrant/.test(page_));

  // Serve it the way the artifact does: wrapped in a plain document, files beside it.
  const SKELETON = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>';
  const apiHits = [];
  srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split("?")[0]);
    if (u.startsWith("/api/")) { apiHits.push(u); r.writeHead(500); return r.end(); }
    if (u === "/") { r.writeHead(200, { "content-type": "text/html" }); return r.end(SKELETON + page_ + "</body></html>"); }
    const f = path.join(out, u); if (!existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "content-type": "image/webp" }); r.end(readFileSync(f));
  }).listen(20901);
  b = await openBrowser();
  const { page, errors } = b;
  await page.goto("http://localhost:20901/"); await page.waitForFunction(() => !store.loading);
  check("the app opens on Recipes with the demo book", (await page.locator("#rlist .rcard").count()) >= 6 && /Beef Rendang/.test(await page.textContent("#rlist")));
  check("…and says it's the preview", /preview/.test(await page.evaluate(() => APP.version)));
  const imgs = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 400)); return [...document.querySelectorAll("#rlist img")].slice(0, 4).map((i) => i.naturalWidth); });
  check("…covers load from the published files", imgs.length && imgs.every((w) => w > 0), JSON.stringify(imgs));
  for (const v of ["plan", "pantry", "shop", "timeline"]) { await page.click(`#tabs button[data-view="${v}"]`); await sleep(250); }
  check("every tab draws: the Plan has meals, the Shop a list, the Archives other people's cooks",
    /Gyudon/.test(await page.textContent("#view-plan")) && (await page.locator("#shopList .item").count()) > 0 && /Alex Tran|Sam Lee/.test(await page.textContent("#view-timeline")));
  await page.click('#tabs button[data-view="recipes"]'); await page.click('.rcard:has-text("Beef Rendang")'); await page.click("#cookThis"); await page.waitForSelector("#cookIng");
  check("cook mode opens, with step timers", (await page.locator("#view-cook .tmr").count()) > 0);
  await page.click("#cookBack"); await page.click("#back");
  await page.click('#tabs button[data-view="pantry"]'); await page.fill("#pantryAdd", "lemons"); await page.click("#pantryAddBtn"); await sleep(400);
  await page.reload(); await page.waitForFunction(() => !store.loading); await page.click('#tabs button[data-view="pantry"]');
  check("a change is kept through a reload (on the device)", /lemons/.test(await page.textContent("#pantryList")));
  await page.click('#tabs button[data-view="recipes"]'); await page.click("#btnManual"); await page.click('#sheet [data-act="import"]');
  await page.fill("#srcUrl", "https://www.instagram.com/reel/DdR9Szhy_wE/"); await page.click("#btnFetch");
  await page.waitForSelector("#fTitle", { timeout: 15000 });
  check("an import goes through the canned link fetch and AI to the review screen", /Beef Pepper Rice/.test(await page.inputValue("#fTitle")));
  await page.goto("about:blank"); await page.goto("http://localhost:20901/#reset"); await page.waitForFunction(() => !store.loading); await page.click('#tabs button[data-view="pantry"]');
  check("#reset starts the demo over", !/lemons/.test(await page.textContent("#pantryList")));
  check("nothing reached a server: every /api call was answered in the page", apiHits.length === 0, apiHits.slice(0, 5).join(" "));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); srv?.close(); rmSync(out, { recursive: true, force: true }); }
