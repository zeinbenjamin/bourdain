// Offline behaviour end to end: the write outbox (saves, deletes, pantry) and the
// photo queue, across the server going down, app reloads, and the server returning.
import sharp from "sharp";
import { suite, startServer, openBrowser, sleep } from "./lib.mjs";

const { check, finish } = suite("offline");
let s, b;
try {
  s = await startServer({ port: 18201 });
  b = await openBrowser();
  const { page, errors } = b;
  const toast = () => page.textContent("#toast");
  const indicator = () => page.textContent("#syncSub");
  const recipes = async () => Object.values((await s.state()).recipes);
  const reconnect = async () => { await s.restart(); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await sleep(1500); };
  const jpeg = async (c) => ({ name: "photo.jpg", mimeType: "image/jpeg", buffer: await sharp({ create: { width: 1200, height: 900, channels: 3, background: c } }).jpeg().toBuffer() });
  const newRecipe = async (title) => {
    await page.click('#tabs button[data-view="recipes"]'); await page.click("#btnManual");
    await page.fill("#fTitle", title); await page.locator(".ingrow [data-f=item]").first().fill("leek");
  };

  await page.goto(s.url); await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
  await page.reload(); await page.waitForFunction(() => !store.loading);

  // --- 1. online save
  await newRecipe("Online soup"); await page.click("#revSave"); await sleep(500);
  check("online save reaches the server", (await recipes()).some((r) => r.title === "Online soup"));
  check("online save says 'Saved'", (await toast()) === "Saved", await toast());
  check("no unsynced indicator online", (await indicator()) === "");

  // --- 2. server down: save, pantry add and delete are queued
  await s.stop();
  await newRecipe("Offline stew"); await page.click("#revSave"); await sleep(800);
  check("failed save does not say 'Saved'", (await toast()) !== "Saved", await toast());
  await page.click('#tabs button[data-view="pantry"]'); await page.fill("#pantryAdd", "2 lemons"); await page.click("#pantryAddBtn"); await sleep(300);
  await page.click('#tabs button[data-view="recipes"]'); await page.click('.rcard:has-text("Online soup")');
  await page.click("#del"); await page.click('[data-act="yes"]'); await sleep(500);
  check("indicator counts queued changes", /3 changes not synced/.test(await indicator()), await indicator());

  // --- 3. reload while still down
  await page.reload(); await sleep(1500);
  let titles = await page.locator(".rcard h3").allTextContents();
  check("offline reload: new recipe still there", titles.includes("Offline stew"), JSON.stringify(titles));
  check("offline reload: deleted recipe stays deleted", !titles.includes("Online soup"));
  check("offline reload: queue survives", /3 changes not synced/.test(await indicator()), await indicator());

  // --- 4. server back
  await reconnect();
  let st = await s.state(); const names = Object.values(st.recipes).map((r) => r.title);
  check("offline save reached the server", names.includes("Offline stew"));
  check("offline delete reached the server (no resurrection)", !names.includes("Online soup"));
  check("offline pantry add reached the server", Object.values(st.pantry).some((p) => p.item === "lemons"));
  check("indicator clears once synced", (await indicator()) === "");
  await page.reload(); await page.waitForFunction(() => !store.loading);
  titles = await page.locator(".rcard h3").allTextContents();
  check("online reload shows the server's truth", titles.includes("Offline stew") && !titles.includes("Online soup"));

  // --- 5. start offline, then the server returns with another device's change
  await s.stop(); await page.reload(); await sleep(1500);
  check("offline start shows 'Offline'", /Offline/.test(await indicator()), await indicator());
  await s.restart();
  await s.put("recipes", "other1", { title: "From the laptop", created_at: new Date().toISOString() });
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await sleep(1500);
  titles = await page.locator(".rcard h3").allTextContents();
  check("server back: app picks up server data", titles.includes("From the laptop"), JSON.stringify(titles));
  check("'Offline' clears", (await indicator()) === "");

  // --- 6. photo taken while offline, on a saved recipe
  await page.click('.rcard:has-text("Offline stew")');
  await s.stop();
  let [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#addPhoto")]); await fc.setFiles(await jpeg("#c44"));
  await page.waitForSelector("img.hero"); await sleep(500);
  check("offline photo: 'saved on this phone' message", /saved on this phone/i.test(await toast()), await toast());
  const shown = () => page.evaluate(() => { const i = document.querySelector("img.hero"); return !!i && i.complete && i.naturalWidth > 0; });
  check("offline photo: shows straight away", await shown());
  check("offline photo: counted as unsynced", /2 changes not synced/.test(await indicator()), await indicator());
  await page.reload(); await sleep(1500); await page.click('.rcard:has-text("Offline stew")'); await page.waitForSelector("img.hero"); await sleep(300);
  check("offline photo: still shows after reload (kept on the phone)", await shown());
  await reconnect(); await sleep(500);
  st = await s.state(); const stew = Object.values(st.recipes).find((r) => r.title === "Offline stew");
  const pid = stew && stew.photos && stew.photos[0];
  check("offline photo: uploaded, recipe points at the real photo", /^[a-f0-9]{32}$/.test(pid || ""), JSON.stringify(stew && stew.photos));
  const got = pid && (await fetch(`${s.url}/api/photos/${pid}`));
  check("offline photo: file is on the server", got && got.status === 200 && got.headers.get("content-type") === "image/jpeg");
  check("offline photo: nothing left in the phone's queue", (await page.evaluate(() => photoQueue.count)) === 0 && (await indicator()) === "");
  check("no 'local-' ids reached the server", !JSON.stringify(st).includes("local-"));

  // --- 7. photo added to a new import while offline, then saved
  await s.stop();
  await newRecipe("Offline salad");
  [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-addp]")]); await fc.setFiles(await jpeg("#4c4"));
  await page.waitForSelector("#revPhotos .ph img"); await page.click("#revSave"); await sleep(600);
  await reconnect(); await sleep(500);
  const salad = (await recipes()).find((r) => r.title === "Offline salad");
  check("offline draft photo: saved recipe ends up with the real photo", salad && /^[a-f0-9]{32}$/.test((salad.photos || [])[0] || ""), JSON.stringify(salad && salad.photos));

  // --- 8. photo on a draft that's then discarded: not counted, never uploaded
  await s.stop();
  await newRecipe("Never saved");
  [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-addp]")]); await fc.setFiles(await jpeg("#44c"));
  await page.waitForSelector("#revPhotos .ph img"); await page.click("#revBack"); await sleep(300);
  check("discarded draft photo: not counted as unsynced", !/not synced/.test(await indicator()), await indicator());
  s.clearLog(); await reconnect();
  check("discarded draft photo: never uploaded", !(await recipes()).some((r) => r.title === "Never saved") && (await page.evaluate(() => photoQueue.pending)) === 0);

  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
