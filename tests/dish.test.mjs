// Guess from a photo of a dish, and YouTube links (2.5): the dish job names the
// dish with a confidence and writes a likely recipe, which lands on the review
// screen saying it's a guess; YouTube links read the title and description.
import path from "node:path";
import { existsSync } from "node:fs";
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
  calls = 0;
  await page.route("**/api/fetch", (r) => (++calls, r.fulfill({ status: 524, contentType: "text/html", body: "<html>A timeout occurred</html>" })));
  msg = await fetchStatus();
  check("an error page from Cloudflare is tried once more, then says so, with its number (2.5.10)", calls === 2 && /sent back an error \(524\)/.test(msg), `${calls} calls: ${msg}`);
  await page.unroute("**/api/fetch");
  await page.route("**/api/fetch", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom", code: "server_error" }) }));
  msg = await fetchStatus();
  check("a real server error isn't called a connection problem", /Something went wrong fetching that page/.test(msg), msg);
  await page.unroute("**/api/fetch");
  await b.ctx.setOffline(true);
  msg = await fetchStatus();
  await b.ctx.setOffline(false);
  check("offline says offline", /You're offline/.test(msg), msg);

  // --- 2.7.4: Instagram captions come from the post's embed page; a site that refuses
  // Bourdain says so; an earlier link's text never stays in the box after a failed fetch
  const IG = "https://www.instagram.com/reel/DdR9Szhy_wE/?stkn=YjR5OXlsNnRyeGE3";
  let ig = await s.post("/api/fetch", { url: IG });
  check("Instagram: the caption, from the embed page, with its line breaks", ig.status === 200 && ig.source === "instagram" && /Crispy garlic parmesan chicken rolls \u{1f32f}/u.test(ig.text) && /\n2 lb boneless chicken breast\n1 tbsp butter\n/.test(ig.text) && /Make the sauce & roll/.test(ig.text), JSON.stringify(ig).slice(0, 300));
  check("…headed by who posted it, without the embed's own furniture", /^by iramsfoodstory\n\nCrispy/.test(ig.text) && !/View all 883 comments|CaptionUsername|<a /.test(ig.text), ig.text.slice(0, 120));
  const igFetched = s.log().match(/MOCK_INSTAGRAM \S+ (\S+)/g) || [];
  check("…asked for at instagram.com only, from the post's code (?stkn and the rest left behind)", igFetched.at(-1) === "MOCK_INSTAGRAM GET https://www.instagram.com/p/DdR9Szhy_wE/embed/captioned/", igFetched.join(" "));
  const shapes = [];
  for (const u of ["https://instagram.com/p/DdR9Szhy_wE/", "https://www.instagram.com/reels/DdR9Szhy_wE/", "https://www.instagram.com/iramsfoodstory/reel/DdR9Szhy_wE/?igsh=x", "https://m.instagram.com/tv/DdR9Szhy_wE"])
    if ((await s.post("/api/fetch", { url: u })).source !== "instagram") shapes.push(u);
  check("…/p/, /reels/, /tv/, and links with the account name in them", shapes.length === 0, shapes.join(" "));
  s.setMode({ instagram: "json" });
  ig = await s.post("/api/fetch", { url: IG });
  check("…or from the post's data when the page draws no caption block", ig.status === 200 && /Garlic rolls \u{1f32f}\n\n2 lb chicken breast/u.test(ig.text) && /^by iramsfoodstory/.test(ig.text), JSON.stringify(ig).slice(0, 200));
  s.setMode({ instagram: "json2" });
  ig = await s.post("/api/fetch", { url: "https://www.instagram.com/reel/Dct0lIPyvQJ/?utm_source=ig_web_copy_link&stkn=NTc4MTIwNjQ2YQ==" });
  check("…or from data two levels of quoting deep, inside a script (2.7.6)", ig.status === 200 && /Crispy chipotle beef tacos \u{1f32e}\n\n2 lb ground beef/u.test(ig.text), JSON.stringify(ig).slice(0, 200));
  s.setMode({ instagram: "escaped" });
  ig = await s.post("/api/fetch", { url: "https://www.instagram.com/reel/Dct0lIPyvQJ/?utm_source=ig_web_copy_link&stkn=NTc4MTIwNjQ2YQ==" });
  check("…or from the caption block sent inside a script, quotes and all escaped (2.7.6: the reel that failed, Dct0lIPyvQJ)", ig.status === 200 && /^by iramsfoodstory\n\nCrispy chipotle beef tacos chipotle lime crema \u{1f32e}\n\nIngredients\n\nFor the taco seasoning:\n\n1 tbsp red chili powder\n2 tbsp garlic powder\n\nMethod:\nMix it all\.$/u.test(ig.text), JSON.stringify(ig.text));
  // 2.7.7: Instagram sent the NAS its error page for the embed: the post query, then the link preview
  s.setMode({ instagram: "blocked-embed" });
  s.clearLog(); ig = await s.post("/api/fetch", { url: "https://www.instagram.com/reels/Dct0lIPyvQJ/" });
  check("when Instagram sends its error page for the embed, the post query gets the caption", ig.status === 200 && /^by iramsfoodstory\n\nCrispy chipotle beef tacos \u{1f32e}\n\n2 lb ground beef/u.test(ig.text) && /MOCK_INSTAGRAM POST https:\/\/www\.instagram\.com\/graphql\/query/.test(s.log()), JSON.stringify(ig).slice(0, 200));
  s.setMode({ instagram: "preview-only" });
  ig = await s.post("/api/fetch", { url: "https://www.instagram.com/reels/Dct0lIPyvQJ/" });
  check("…and when that's refused too, the link preview Instagram gives apps quotes it", ig.status === 200 && /^by iramsfoodstory\n\nCrispy chipotle beef tacos chipotle lime crema \u{1f32e}\n\n2 lb ground beef\n1 tbsp taco seasoning$/u.test(ig.text), JSON.stringify(ig.text));
  check("…and the preview is asked first, as what got through from the NAS (2.7.8)", /^MOCK_INSTAGRAM GET https:\/\/www\.instagram\.com\/p\/Dct0lIPyvQJ\/$/m.test((s.log().match(/MOCK_INSTAGRAM .*/g) || []).slice(-1)[0] ? s.log().split("\n").filter((l) => l.startsWith("MOCK_INSTAGRAM")).slice(-1)[0] : ""), s.log().split("\n").filter((l) => l.startsWith("MOCK_INSTAGRAM")).slice(-4).join(" | "));
  s.setMode({ instagram: "preview-cut" });
  ig = await s.post("/api/fetch", { url: "https://www.instagram.com/reels/Dct0lIPyvQJ/" });
  check("…a preview that looks cut short ('…') is used only when nothing better comes back, and says so", ig.status === 200 && /2 lb ground beef\n1 tbsp taco…$/.test(ig.text), JSON.stringify(ig.text));
  let viaLog = await (await fetch(s.url + "/api/admin/activity?cat=links&limit=5")).json();
  check("…the log calls it 'maybe cut short'", viaLog.some((r) => r.target === "instagram.com · read the caption (preview, maybe cut short)"), JSON.stringify(viaLog.map((r) => r.target)));
  viaLog = await (await fetch(s.url + "/api/admin/activity?cat=links&limit=8")).json();
  check("…the activity log says which way worked", viaLog.some((r) => r.target === "instagram.com · read the caption (preview)") && viaLog.some((r) => r.target === "instagram.com · read the caption (query)"), JSON.stringify(viaLog.map((r) => r.target)));
  s.setMode({ instagram: "nocaption" });
  ig = await s.post("/api/fetch", { url: IG });
  check("…with no caption: what each way got is said, and the pages are kept in the data folder to look at", /^instagram\.com sent no caption \(preview: 200, 0 KB, its error page; embed: 200, 0 KB; query: 401; embed-browser: 200, 0 KB\)$/.test(ig.detail) && existsSync(path.join(s.data, "debug", "instagram-DdR9Szhy_wE-embed.html")) && existsSync(path.join(s.data, "debug", "instagram-DdR9Szhy_wE-preview.html")), ig.detail);
  check("…no caption is a failed fetch, not 'read' (2.7.3 logged a login wall as read)", ig.status === 422 && ig.code === "fetch_failed" && ig.source === "instagram", JSON.stringify(ig));
  const links = await (await fetch(s.url + "/api/admin/activity?cat=links&limit=20")).json();
  check("…and the owner's activity says so: 'no caption', and 'read the caption' when there was one", links.some((r) => /^instagram\.com · no caption \(instagram\.com sent no caption \(preview: /.test(r.target)) && links.some((r) => r.target === "instagram.com · read the caption (embed)") && !links.some((r) => /^instagram\.com · read$/.test(r.target)), JSON.stringify(links.map((r) => r.target).slice(0, 6)));
  // in the app: an earlier link's text is cleared, and the message says what to do
  await page.evaluate(() => { const st = document.querySelector("#importStatus"); st.className = "status"; st.textContent = ""; document.getElementById("srcText").value = ""; });
  s.setMode({});
  await page.route("**/api/ai", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ json: { error: "no recipe found" } }) }));
  await page.fill("#srcUrl", "https://www.instagram.com/reel/DdR9Szhy_wE/"); await page.click("#btnFetch");
  await page.waitForFunction(() => document.querySelector("#importStatus").classList.contains("err"));
  check("app: an Instagram link fills the box with the caption", /Crispy garlic parmesan/.test(await page.inputValue("#srcText")));
  s.setMode({ instagram: "nocaption" });
  await page.fill("#srcUrl", "https://www.instagram.com/reel/DKZV_VdBiqX/"); await page.click("#btnFetch");
  await page.waitForFunction(() => document.querySelector("#importStatus").classList.contains("err") && /caption/.test(document.querySelector("#importStatus").textContent));
  check("…a second link with no caption clears the first one's text (it used to stay and be read as this recipe)", (await page.inputValue("#srcText")) === "", await page.inputValue("#srcText"));
  check("…and says how to get the caption in", /copy the caption and paste it into the box above/.test(await page.textContent("#importStatus")), await page.textContent("#importStatus"));
  s.setMode({});
  await page.fill("#srcText", "My own notes about this dish");
  await page.route("**/api/fetch", (r) => r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "nothing came back", code: "fetch_failed", detail: "rasamalaysia.com said 403", blocked: true, site: "rasamalaysia.com" }) }));
  await page.fill("#srcUrl", "https://rasamalaysia.com/sambal-ladys-finger-recipe/"); await page.click("#btnFetch");
  await page.waitForFunction(() => document.querySelector("#importStatus").classList.contains("err"));
  check("a site that refuses Bourdain (403): says so by name, and how to get the recipe in", /rasamalaysia\.com doesn't let apps read its pages\. Open the link in your browser, copy the recipe/.test(await page.textContent("#importStatus")), await page.textContent("#importStatus"));
  check("…and what you typed yourself stays in the box", (await page.inputValue("#srcText")) === "My own notes about this dish");
  await page.unroute("**/api/fetch"); await page.unroute("**/api/ai");

  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
