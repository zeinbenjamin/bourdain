// Screen-recording import: frames come out of a real recording, and a recording
// that never finishes seeking (some iOS videos) stops with a message instead of hanging.
import { suite, startServer, openBrowser, openApp } from "./lib.mjs";

const { check, finish } = suite("video");
let s, b;
try {
  s = await startServer({ port: 18601 });
  b = await openBrowser();
  const { page } = b;
  page.setDefaultTimeout(40000);
  await openApp(page, s.url);
  // Record a real 3-second WebM in the page: changing colours and text.
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 360; c.height = 640; const g = c.getContext("2d");
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" }); const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start(); const t0 = performance.now();
    await new Promise((r) => { const f = () => { const t = performance.now() - t0, k = Math.floor(t / 500); g.fillStyle = ["#c33", "#3c3", "#33c", "#cc3", "#3cc", "#c3c"][k % 6]; g.fillRect(0, 0, 360, 640); g.fillStyle = "#fff"; g.font = "40px sans-serif"; g.fillText("Step " + k, 40, 300); t < 3000 ? requestAnimationFrame(f) : r(); }; f(); });
    rec.stop(); await new Promise((r) => (rec.onstop = r));
    const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const video = { name: "rec.webm", mimeType: "video/webm", buffer: Buffer.from(b64, "base64") };
  const done = () => page.waitForFunction(() => /Got \d+ sheet|Couldn't read/.test(document.querySelector("#importStatus").textContent));
  await page.click('#tabs button[data-view="import"]');
  await page.setInputFiles("#srcImgs", video); await done();
  check("normal recording: frames extracted", /Got [1-9]\d* sheet/.test(await page.textContent("#importStatus")) && (await page.evaluate(() => state.images.length)) > 0, await page.textContent("#importStatus"));
  // Make every seek hang, as some iOS recordings do.
  await page.evaluate(() => { state.images = []; renderThumbs(); const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime"); Object.defineProperty(HTMLMediaElement.prototype, "currentTime", { get: d.get, set() {}, configurable: true }); });
  const t0 = Date.now(); await page.setInputFiles("#srcImgs", { ...video, name: "rec2.webm" }); await done();
  const took = Date.now() - t0;
  check("stuck recording: gives up with a message (~15s)", /Couldn't read that video/.test(await page.textContent("#importStatus")) && took < 20000, took + "ms");
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
