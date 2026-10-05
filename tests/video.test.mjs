// Screen-recording import: frames come out of a real recording, and a recording
// that never finishes seeking (some iOS videos) stops with a message instead of hanging,
// and a reel's brief captions all survive at a readable size (2.5.8).
import { suite, startServer, openBrowser, openApp, addRecipe } from "./lib.mjs";

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
  await addRecipe(page, "import");
  await page.setInputFiles("#srcImgs", video); await done();
  check("normal recording: frames extracted", /Got [1-9]\d* sheet/.test(await page.textContent("#importStatus")) && (await page.evaluate(() => state.images.length)) > 0, await page.textContent("#importStatus"));
  // 2.5.8: a reel-like recording. Ingredient captions flash up for under a second
  // each, small, with a coloured square that the test looks for in the sheets.
  // The first half has a moving background; in the second only the captions change,
  // as in a still shot with text over it.
  const MARKS = [[255, 0, 0], [0, 200, 0], [0, 0, 255], [255, 220, 0], [0, 220, 220], [230, 0, 230], [255, 120, 0], [120, 0, 255], [120, 230, 0], [255, 0, 130], [0, 120, 255], [0, 230, 120]];
  const reel = await page.evaluate(async (MARKS) => {
    const W = 720, H = 1560, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" }); const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
    const SLOT = 1.1, SHOW = 0.8, LEN = MARKS.length * SLOT + 0.4;
    rec.start(); const t0 = performance.now();
    await new Promise((r) => { const f = () => {
      const t = (performance.now() - t0) / 1000, moving = t < LEN / 2;
      g.fillStyle = "#777"; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 14; i++) { const y = (i * 120 + (moving ? t * 260 : 0)) % H, v = 60 + ((i * 37) % 140); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect((i * 53) % 400, y, 320, 90); }
      const k = Math.floor((t - 0.3) / SLOT), into = t - 0.3 - k * SLOT;
      if (k >= 0 && k < MARKS.length && into < SHOW) {
        g.fillStyle = `rgb(${MARKS[k].join(",")})`; g.fillRect(60, 1180, 40, 40);
        g.fillStyle = "#fff"; g.font = "32px sans-serif"; g.fillText(`${k + 1} tbsp ingredient ${k + 1}`, 116, 1212);
      }
      t < LEN ? requestAnimationFrame(f) : r(); }; f(); });
    rec.stop(); await new Promise((r) => (rec.onstop = r));
    const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }, MARKS);
  await page.evaluate(() => { state.images = []; renderThumbs(); });
  await page.setInputFiles("#srcImgs", { name: "reel.webm", mimeType: "video/webm", buffer: Buffer.from(reel, "base64") }); await done();
  const seen = await page.evaluate(async (MARKS) => {
    // For each caption: how many of its marker's pixels are in the sheets, and the
    // widest the marker is drawn (it's 40px in the 720px-wide recording).
    const out = { count: [], found: MARKS.map(() => 0), widest: MARKS.map(() => 0) };
    for (const blob of state.images) {
      const im = await createImageBitmap(blob);
      const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const g = c.getContext("2d"); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, im.width, im.height).data;
      MARKS.forEach((m, i) => { for (let y = 0; y < im.height; y++) { let run = 0; for (let x = 0; x < im.width; x++) { const k = (y * im.width + x) * 4;
        if (Math.abs(d[k] - m[0]) < 45 && Math.abs(d[k + 1] - m[1]) < 45 && Math.abs(d[k + 2] - m[2]) < 45) { out.found[i]++; run++; out.widest[i] = Math.max(out.widest[i], run); } else run = 0; } } });
      out.count.push([im.width, im.height]);
    }
    return out;
  }, MARKS);
  const missing = seen.found.map((n, i) => (n < 40 ? i + 1 : 0)).filter(Boolean);
  check("reel: every flashed-up caption makes it into the sheets", missing.length === 0, `missing caption ${missing.join(", ")} of ${MARKS.length}; ${await page.textContent("#importStatus")}`);
  // 522px frames draw the 40px marker about 29px wide; the old 2x3 sheets drew it about 16px.
  const small = Math.min(...seen.widest.filter(Boolean));
  check("reel: captions are drawn big enough to read (frames ~520px wide, sheets within 1568px)", small >= 25 && seen.count.every(([w, h]) => w <= 1568 && h <= 1568), `marker ${small}px wide; sheets ${JSON.stringify(seen.count)}`);
  const sizes = seen.count;
  check("reel: up to 10 sheets go to the reader", sizes.length >= 4 && sizes.length <= 10, String(sizes.length));

  // Make every seek hang, as some iOS recordings do.
  await page.evaluate(() => { state.images = []; renderThumbs(); const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime"); Object.defineProperty(HTMLMediaElement.prototype, "currentTime", { get: d.get, set() {}, configurable: true }); });
  const t0 = Date.now(); await page.setInputFiles("#srcImgs", { ...video, name: "rec2.webm" }); await done();
  const took = Date.now() - t0;
  check("stuck recording: gives up with a message (~15s)", /Couldn't read that video/.test(await page.textContent("#importStatus")) && took < 20000, took + "ms");
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
