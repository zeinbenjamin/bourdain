// Guess from a photo of a dish, and YouTube links (2.5): the dish job names the
// dish with a confidence and writes a likely recipe, which lands on the review
// screen saying it's a guess; YouTube links read the title and description.
import path from "node:path";
import sharp from "sharp";
import Database from "better-sqlite3";
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("dish");
let s, b;
try {
  s = await startServer({ port: 20501, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test" } });
  const img = "data:image/jpeg;base64," + (await sharp({ create: { width: 64, height: 64, channels: 3, background: "#a63" } }).jpeg().toBuffer()).toString("base64");
  const jpeg = async () => ({ name: "dish.jpg", mimeType: "image/jpeg", buffer: await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#b74" } }).jpeg().toBuffer() });

  // --- the dish job, on the server
  s.clearLog();
  const one = await s.post("/api/ai", { kind: "dish", material: {}, images: [img] });
  check("a photo of a dish gives a recipe and a guess with a confidence", one.status === 200 && one.json?.title && one.json.guess?.dish === "Afghan mantu" && one.json.guess.confidence === 62 && one.json.guess.alternatives.length === 2, JSON.stringify(one.json?.guess));
  check("…the photo reaches Claude", /MOCK_DISH images=1/.test(s.log()));
  const many = await s.post("/api/ai", { kind: "dish", material: {}, images: [img, img, img, img] });
  check("…at most 3 photos", many.status === 400 && many.code === "too_many_images");
  s.setMode({ dish: "nofood" });
  const none = await s.post("/api/ai", { kind: "dish", material: {}, images: [img] });
  check("a photo that isn't food says so", none.status === 200 && none.json?.error, JSON.stringify(none.json));
  s.setMode({});
  { const d = new Database(path.join(s.data, "bourdain.db")); const u = d.prepare("SELECT grp FROM ai_usage WHERE kind = 'dish'").all(); d.close();
    check("guesses count against the import limit", u.length >= 1 && u.every((r) => r.grp === "import"), JSON.stringify(u)); }

  // --- in the app
  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  const guessFlow = async () => {
    await page.click('#tabs button[data-view="recipes"]'); await page.click("#btnManual");
    const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click('#sheet [data-act="guess"]')]);
    await fc.setFiles(await jpeg());
  };
  check("the + sheet offers Guess from a photo of a dish", /Guess from a photo of a dish/.test(await (async () => { await page.click('#tabs button[data-view="recipes"]'); await page.click("#btnManual"); const t = await page.textContent("#sheet"); await page.keyboard.press("Escape"); await page.evaluate(() => closeSheet()); return t; })()));
  await guessFlow();
  await page.waitForSelector("#review .guessnote", { timeout: 15000 });
  const note = (await page.textContent("#review .guessnote")).replace(/\s+/g, " ");
  check("the review form says it's a guess, how sure, and what else it could be", /Guessed from a photo · Medium confidence \(62%\)/.test(note) && /Looks like Afghan mantu; it could also be Turkish manti, Shish barak/.test(note) && /Check the ingredients/.test(note), note);
  check("…the photo is the recipe's picture", await page.evaluate(() => state.draft.photos.length === 1 && state.draft.source_type === "photo"));
  await page.click("#revSave"); await page.waitForSelector("#view-detail .guessline");
  const id = await page.evaluate(() => state.detailId);
  check("after saving, the recipe page still says it was guessed", /Guessed from a photo · Medium confidence \(62%\)/.test(await page.textContent("#view-detail .guessline")));
  check("…and the stored recipe keeps the guess", (await s.state()).recipes[id]?.guess?.confidence === 62);
  await page.click('#tabs button[data-view="recipes"]');
  check("…its card says it came from a photo", /photo/.test(await page.textContent(`#view-recipes .rcard[data-id="${id}"] .meta`)));

  s.setMode({ dish: "unsure" });
  await guessFlow(); await page.waitForSelector("#review .guessnote");
  check("an unsure guess is marked Low and stands out", /Low confidence \(30%\)/.test(await page.textContent("#review .guessnote")) && await page.$eval("#review .guessnote", (e) => e.classList.contains("low")));
  await page.evaluate(() => { state.draft = null; state.view = "recipes"; show("recipes"); });
  s.setMode({ dish: "nofood" });
  await guessFlow(); await page.waitForFunction(() => /Couldn't guess/.test(document.querySelector("#sheet")?.textContent || ""), null, { timeout: 15000 });
  check("a photo with no dish in it says what to try", /closer photo of the food/.test(await page.textContent("#sheet")));
  await page.evaluate(() => closeSheet());
  s.setMode({});

  // --- YouTube
  for (const u of ["https://www.youtube.com/watch?v=abcdefghijk", "https://youtu.be/abcdefghijk?si=x", "https://www.youtube.com/shorts/abcdefghijk"]) {
    const r = await s.post("/api/fetch", { url: u });
    check(`YouTube ${new URL(u).host}${new URL(u).pathname.split("/")[1] === "shorts" ? "/shorts" : ""}: the title, channel and description`, r.status === 200 && r.source === "youtube" && /Easy beef rendang/.test(r.text) && /by Kitchen Channel/.test(r.text) && /1kg beef chuck/.test(r.text), JSON.stringify(r).slice(0, 200));
  }
  check("…a link that isn't a video is read like any other page", (await s.post("/api/fetch", { url: "https://www.youtube.com/channel/x" })).source !== "youtube");
  s.setMode({ youtube: "nodesc" });
  const nd = await s.post("/api/fetch", { url: "https://youtu.be/abcdefghijk" });
  check("…with no description, just the title", nd.status === 200 && /Easy beef rendang/.test(nd.text) && !/beef chuck/.test(nd.text));
  check("…and the page's own description, with its entities decoded (2.5.8)", nd.text.includes('Short meta \u{1f957} it\u2019s "quick"'), nd.text);
  s.setMode({});

  await page.evaluate(() => { state.draft = null; }); await page.click('#tabs button[data-view="recipes"]'); await page.click("#btnManual"); await page.click('#sheet [data-act="import"]');
  await page.fill("#srcUrl", "https://www.youtube.com/watch?v=abcdefghijk"); await page.click("#btnFetch");
  await page.waitForSelector("#review:not([hidden]) #fTitle", { timeout: 15000 });
  check("in the app, a YouTube link fetches and reads like a recipe site", await page.evaluate(() => state.draft.source_type === "youtube" && state.draft.source_url.includes("youtube")));
  await page.evaluate(() => { state.draft = null; renderImport(); });
  await page.route("**/api/ai", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ json: { error: "no recipe found" } }) }));
  await page.fill("#srcUrl", "https://youtu.be/abcdefghijk"); await page.click("#btnFetch");
  await page.waitForFunction(() => document.querySelector("#importStatus").classList.contains("err"));
  check("a video whose description has no recipe points to a screen recording", /Screen-record the video/.test(await page.textContent("#importStatus")));
  await page.unroute("**/api/ai");

  // --- 2.5.9: when Fetch & read gets no answer from Bourdain itself, say what happened
  const fetchStatus = async (url = "https://feedthepudge.com/beef-pepper-rice/") => {
    await page.evaluate(() => { const st = document.querySelector("#importStatus"); st.className = "status"; st.textContent = ""; document.getElementById("srcText").value = ""; });
    await page.fill("#srcUrl", url); await page.click("#btnFetch");
    await page.waitForFunction(() => document.querySelector("#importStatus").classList.contains("err") || !document.getElementById("btnFetch").disabled && document.getElementById("srcText").value);
    return page.textContent("#importStatus");
  };
  let calls = 0;
  await page.route("**/api/fetch", (r) => (++calls === 1 ? r.abort("connectionreset") : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Beef pepper rice. 300g thinly sliced beef, 2 cups cooked rice, 1 tbsp butter. Cook it all on a hot pan.", recipeJson: null }) })));
  await page.route("**/api/ai", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ json: { error: "no recipe found" } }) }));
  await fetchStatus();
  check("a dropped connection is retried once, quietly", calls === 2 && /Beef pepper rice/.test(await page.inputValue("#srcText")), `${calls} calls`);
  await page.unroute("**/api/fetch"); await page.unroute("**/api/ai");
  await page.route("**/api/fetch", (r) => r.abort("connectionreset"));
  let msg = await fetchStatus();
  check("…and if nothing ever comes back, it says it couldn't get through, not that the server is down", /Couldn't get through to Bourdain/.test(msg) && !/server/i.test(msg), msg);
  await page.unroute("**/api/fetch");
  await page.route("**/api/fetch", (r) => r.fulfill({ status: 524, contentType: "text/html", body: "<html>A timeout occurred</html>" }));
  msg = await fetchStatus();
  check("an error page from Cloudflare says so, with its number", /sent back an error \(524\)/.test(msg), msg);
  await page.unroute("**/api/fetch");
  await page.route("**/api/fetch", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom", code: "server_error" }) }));
  msg = await fetchStatus();
  check("a real server error isn't called a connection problem", /Something went wrong fetching that page/.test(msg), msg);
  await page.unroute("**/api/fetch");
  await b.ctx.setOffline(true);
  msg = await fetchStatus();
  await b.ctx.setOffline(false);
  check("offline says offline", /You're offline/.test(msg), msg);

  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
