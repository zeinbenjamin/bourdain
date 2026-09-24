// Cover illustrations in the app, import error messages, and screenshot shrinking.
import sharp from "sharp";
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("covers & imports");
let s, b;
try {
  s = await startServer({ port: 18401, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-test" } });
  b = await openBrowser();
  const { page, errors } = b;
  await s.put("recipes", "r1", { title: "Chicken donburi", servings: 2, ingredients: [{ item: "chicken thigh", quantity: 2, unit: "whole" }], steps: ["Cook."], photos: [], tags: ["japanese"], created_at: "2026-09-02" });
  await s.put("recipes", "r2", { title: "Leek soup", ingredients: [], steps: [], photos: [], tags: ["soup"], created_at: "2026-09-01" });
  await openApp(page, s.url);

  // --- make a cover from the recipe page
  await page.click('.rcard:has-text("Chicken donburi")');
  check("recipe page shows 'Make cover'", (await page.textContent("#makeCover")) === "Make cover");
  s.setMode({ imageDelay: 1500 }); await page.click("#makeCover");
  check("painting sheet opens with Stop", await page.locator('#sheet.open [data-act="stop"]').isVisible() && /Painting the cover/.test(await page.textContent("#sheet")));
  await page.waitForSelector("img.hero.cover", { timeout: 15000 });
  check("cover becomes the hero; button now 'New cover'", (await page.textContent("#makeCover")) === "New cover");
  const hero = await page.evaluate(() => { const i = document.querySelector("img.hero.cover"), cs = getComputedStyle(i); return { fit: cs.objectFit, bg: cs.backgroundColor, loaded: i.complete && i.naturalWidth > 0 }; });
  check("hero shown whole on white", hero.fit === "contain" && hero.bg === "rgb(255, 255, 255)" && hero.loaded, JSON.stringify(hero));
  check("cover id saved on the server", /^[a-f0-9]{32}$/.test((await s.state()).recipes.r1.cover || ""));
  await page.click("#back");
  const card = await page.evaluate(() => { const t = document.querySelector('.rcard[data-id="r1"] .thumb'); return { cls: t.className, bg: getComputedStyle(t).backgroundColor, fit: getComputedStyle(t.querySelector("img")).objectFit }; });
  check("card: cover on a white tile, uncropped", card.cls.includes("cover") && card.bg === "rgb(255, 255, 255)" && card.fit === "contain", JSON.stringify(card));
  check("card without a cover keeps the grey letter tile", (await page.evaluate(() => getComputedStyle(document.querySelector('.rcard[data-id="r2"] .thumb')).backgroundColor)) === "rgb(247, 247, 247)");

  // --- Stop, and an error shown in the sheet
  await page.click('.rcard:has-text("Leek soup")'); s.clearLog(); s.setMode({ imageDelay: 8000 });
  await page.click("#makeCover"); await sleep(1200); await page.click('#sheet [data-act="stop"]'); await sleep(600);
  check("Stop: message + OpenAI call cancelled", /Stopped\. No cover was made/.test(await page.textContent("#toast")) && /MOCK: upstream aborted/.test(s.log()));
  s.setMode({ image: "moderation" }); await page.click("#makeCover"); await page.waitForSelector("#coverStatus.err");
  check("refusal: specific message, heading and Close", /declined that prompt/.test(await page.textContent("#coverStatus")) && (await page.textContent("#sheet h3")) === "Couldn't make the cover" && (await page.textContent('#sheet [data-act="stop"]')) === "Close");
  await page.click('#sheet [data-act="stop"]');

  // --- cover on the review screen keeps unsaved edits
  s.setMode({}); await page.click('#tabs button[data-view="import"]'); await page.fill("#srcText", "2 chicken thighs, cook them");
  await page.click("#btnParse"); await page.waitForSelector("#revCover");
  await page.fill("#fTitle", "Mock donburi (edited)");
  await page.click("#revCover"); await page.waitForSelector(".coverbox img", { timeout: 15000 });
  check("review: cover preview appears, typed edit kept", (await page.inputValue("#fTitle")) === "Mock donburi (edited)");
  await page.click("#revSave"); await page.waitForSelector("img.hero.cover");
  const imported = Object.values((await s.state()).recipes).find((x) => x.title === "Mock donburi (edited)");
  check("review: saved recipe has the cover", imported && /^[a-f0-9]{32}$/.test(imported.cover || ""));

  // --- import error messages
  await page.click('#tabs button[data-view="import"]');
  for (const [mode, re] of [["max_tokens", /too long to finish in one reply/], ["credit", /out of credit/], ["529", /overloaded/]]) {
    s.setMode({ claude: mode }); await page.fill("#srcText", "some recipe text here"); await page.click("#btnParse");
    await page.waitForFunction(() => document.querySelector("#importStatus").classList.contains("err"));
    check(`import ${mode}: specific message`, re.test(await page.textContent("#importStatus")), await page.textContent("#importStatus"));
  }
  s.setMode({});

  // --- screenshots are shrunk before sending
  const big = await sharp({ create: { width: 1290, height: 2796, channels: 3, background: "#fafafa" } }).png({ compressionLevel: 0 }).toBuffer();
  await page.setInputFiles("#srcImgs", { name: "shot.png", mimeType: "image/png", buffer: big });
  await page.waitForFunction(() => state.images.length === 1);
  const im = await page.evaluate(async () => { const f = state.images[0]; const bm = await createImageBitmap(f); return { type: f.type, size: f.size, long: Math.max(bm.width, bm.height) }; });
  check("screenshot shrunk to 1568px JPEG before sending", im.type === "image/jpeg" && im.size < big.length && im.long === 1568, JSON.stringify(im));

  // --- offline
  await page.evaluate(() => { store.online = false; }); await page.click('#tabs button[data-view="recipes"]');
  await page.click('.rcard:has-text("Leek soup")'); await page.click("#makeCover");
  check("offline: explains covers need the server", /Covers are painted on the server/.test(await page.textContent("#toast")));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
