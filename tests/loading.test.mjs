// Opening the app on slow or flaky Wi-Fi: loading states, the service worker's
// fallback, import Stop, the Plan picker with an untitled recipe, and the version sheet.
import { suite, startServer, slowProxy, openBrowser, swCacheName, sleep } from "./lib.mjs";

const { check, finish } = suite("loading");
let s, px, b;
try {
  s = await startServer({ port: 18301, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test" } });
  px = slowProxy({ port: 18302, target: 18301 });
  const B = px.url;
  b = await openBrowser({ fonts: "hang" }); // fonts never answer: the page must paint anyway
  const { page, errors } = b;
  const go = () => page.goto(B, { waitUntil: "domcontentloaded" });

  // --- a new phone on a slow server
  px.delays.state = 4000;
  let t0 = Date.now(); await page.goto(B, { waitUntil: "commit" }); await page.waitForSelector("#rlist .empty");
  const paint = Date.now() - t0;
  check("paints quickly even with fonts hanging", paint < 2500, paint + "ms");
  const early = await page.textContent("#rlist");
  check("new phone: 'Loading your recipes…', not 'Nothing in the book yet'", /Loading your recipes/.test(early) && !/Nothing in the book/.test(early), early.trim().slice(0, 40));
  check("header says Loading…", /Loading…/.test(await page.textContent("#syncSub")));
  await page.waitForFunction(() => !store.loading, null, { timeout: 10000 });
  check("after load: empty-book message", /Nothing in the book yet/.test(await page.textContent("#rlist")));

  // --- the Plan picker survives an untitled recipe
  await s.put("recipes", "r1", { title: "Leek soup", created_at: "2026-09-01" });
  await s.put("recipes", "r2", { deleted: true });
  px.delays.state = 0; await go(); await page.waitForFunction(() => !store.loading);
  await page.click('#tabs button[data-view="plan"]'); await page.locator("[data-add]").first().click();
  check("Plan picker opens with an untitled recipe present", await page.locator("#sheet.open #pickList").isVisible() && errors.length === 0, errors.join("|"));
  await page.click("#sheetBg");

  // --- a returning phone shows its own copy straight away
  await page.click('#tabs button[data-view="recipes"]');
  px.delays.state = 5000; t0 = Date.now(); await go();
  await page.waitForSelector('.rcard:has-text("Leek soup")'); const shown = Date.now() - t0;
  check("returning phone, slow server: recipes show immediately", shown < 2000 && (await page.evaluate(() => store.loading)), shown + "ms");
  await page.waitForFunction(() => !store.loading, null, { timeout: 10000 }); px.delays.state = 0;

  // --- the service worker falls back to its cached app after 3s
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 8000 });
  await go(); await sleep(500);
  const cache = await swCacheName();
  check(`service worker cache is ${cache}`, await page.evaluate(async (c) => (await caches.keys()).includes(c), cache));
  px.delays.shell = 15000; t0 = Date.now(); await page.goto(B, { waitUntil: "commit", timeout: 20000 }); await page.waitForSelector("#brand");
  const sw = Date.now() - t0;
  check("page takes 15s from the server: cached app shows in ~3s", sw >= 2500 && sw < 6000, sw + "ms");
  px.delays.shell = 0; await sleep(300);

  // --- version sheet
  await go(); await page.waitForFunction(() => !store.loading);
  const ver = await page.evaluate(() => APP.version);
  check("header shows the version", (await page.textContent("#verLabel")) === "v" + ver);
  await page.click("#brand"); await page.waitForSelector(".rel");
  check("version sheet: up to date, history listed, this phone marked", /Up to date/.test(await page.textContent("#verBody")) && (await page.locator(".rel").count()) > 3 && /· this phone/.test(await page.locator(".rel h4").first().textContent()));
  await page.click('[data-act="close"]');

  // --- import Stop
  s.setMode({ claudeDelay: 8000 }); s.clearLog();
  await page.click('#tabs button[data-view="import"]'); await page.fill("#srcText", "1 leek. Cook it.");
  await page.click("#btnParse"); await page.waitForSelector("#stopParse"); await sleep(1000);
  await page.click("#stopParse"); await sleep(700);
  check("Stop: says it stopped", /Stopped\. Nothing was imported\./.test(await page.textContent("#importStatus")));
  check("Stop: Read button usable again", await page.locator("#btnParse").isEnabled());
  check("Stop: server cancelled the Claude call", /MOCK: upstream aborted/.test(s.log()) && /claude call cancelled/.test(s.log()));
  await sleep(8500);
  check("Stop: no review screen appears later", await page.locator("#review").isHidden());
  s.setMode({});
  await page.click("#btnParse"); await page.waitForSelector("#fTitle", { timeout: 15000 });
  check("without Stop: import reaches the review screen", (await page.inputValue("#fTitle")) === "Mock donburi");
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); px?.close(); await s?.cleanup(); }
