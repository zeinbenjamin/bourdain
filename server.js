import express from "express";
import multer from "multer";
import Database from "better-sqlite3";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync, createReadStream, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || "/data";
const PHOTO_DIR = path.join(DATA_DIR, "photos");
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

mkdirSync(PHOTO_DIR, { recursive: true });

/* ---------------- version ----------------
   package.json holds the version; the build passes the commit in as APP_COMMIT.
   CHANGELOG.md is parsed once at startup for the in-app version history.   */
const VERSION = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
const COMMIT = (process.env.APP_COMMIT || "dev").slice(0, 7);
function readChangelog() {
  let text = "";
  try { text = readFileSync(path.join(__dirname, "CHANGELOG.md"), "utf8"); }
  catch { return []; }
  const out = [];
  for (const line of text.split("\n")) {
    const h = line.match(/^##\s+(\S+)\s+[—-]+\s+(\d{4}-\d{2}-\d{2})/);
    if (h) { out.push({ version: h[1], date: h[2], notes: [] }); continue; }
    const b = line.match(/^-\s+(.+)/);
    if (b && out.length) out[out.length - 1].notes.push(b[1].trim());
  }
  return out;
}
const CHANGELOG = readChangelog();
// The served index.html carries its own version, so the phone can tell which build it is running.
const INDEX_HTML = readFileSync(path.join(__dirname, "public", "index.html"), "utf8")
  .replace('content="__APP_VERSION__"', `content="${VERSION}"`)
  .replace('content="__APP_COMMIT__"', `content="${COMMIT}"`);

/* ---------------- database ---------------- */
const db = new Database(path.join(DATA_DIR, "bourdain.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS plan    (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pantry  (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS shop    (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
`);

const COLLECTIONS = new Set(["recipes", "plan", "pantry", "shop"]);
// One unreadable row must not take the whole app down, so skip it and say which.
const readAll = (t) => {
  const out = {};
  for (const r of db.prepare(`SELECT id, doc FROM ${t}`).all()) {
    try { out[r.id] = JSON.parse(r.doc); }
    catch (err) { console.error(`skipping corrupt row ${t}/${r.id}:`, err.message); }
  }
  return out;
};

/* ---------------- app ---------------- */
const app = express();
app.use(express.json({ limit: "30mb" }));
app.disable("x-powered-by");

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, hasApiKey: Boolean(API_KEY), version: VERSION, commit: COMMIT })
);

app.get("/api/version", (_req, res) => res.json({ version: VERSION, commit: COMMIT, changelog: CHANGELOG }));

app.get("/api/state", (_req, res) => {
  res.json({
    recipes: readAll("recipes"),
    plan: readAll("plan"),
    pantry: readAll("pantry"),
    shop: readAll("shop"),
  });
});

app.put("/api/:col/:id", (req, res) => {
  const { col, id } = req.params;
  if (!COLLECTIONS.has(col)) return res.status(404).json({ error: "unknown collection", code: "bad_collection" });
  db.prepare(`INSERT INTO ${col} (id, doc, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`)
    .run(id, JSON.stringify(req.body ?? {}), new Date().toISOString());
  res.status(204).end();
});

app.delete("/api/:col/:id", (req, res) => {
  const { col, id } = req.params;
  if (!COLLECTIONS.has(col)) return res.status(404).json({ error: "unknown collection", code: "bad_collection" });
  db.prepare(`DELETE FROM ${col} WHERE id = ?`).run(id);
  res.status(204).end();
});

/* ---------------- photos ---------------- */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.post("/api/photos", upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file", code: "no_file" });
  try {
    const id = randomUUID().replace(/-/g, "");
    const jpeg = await sharp(req.file.buffer)
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    await writeFile(path.join(PHOTO_DIR, `${id}.jpg`), jpeg);
    res.json({ id, url: `/api/photos/${id}` });
  } catch (err) {
    console.error("photo failed", err);
    res.status(500).json({ error: "could not process image", code: "image_failed" });
  }
});

app.get("/api/photos/:id", (req, res) => {
  if (!/^[a-f0-9]{32}$/.test(req.params.id)) return res.status(400).end();
  const file = path.join(PHOTO_DIR, `${req.params.id}.jpg`);
  if (!existsSync(file)) return res.status(404).end();
  res.type("image/jpeg").set("Cache-Control", "public, max-age=31536000, immutable");
  createReadStream(file)
    .on("error", (err) => {
      // Without this handler a read error would crash the whole process.
      console.error("photo read failed", req.params.id, err.message);
      if (!res.headersSent) res.status(500).end(); else res.destroy();
    })
    .pipe(res);
});

/* ---------------- Claude proxy ----------------
   The API key lives here and never reaches the browser.               */
app.post("/api/claude", async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: "no API key configured", code: "no_api_key" });
  const { prompt, images } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "no prompt", code: "no_prompt" });

  const content = [];
  for (const img of images || []) {
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type || "image/jpeg", data: img.data } });
  }
  content.push({ type: "text", text: prompt });

  // If the phone stops waiting (the Stop button, or a dropped connection), cancel the
  // upstream call too rather than finishing a recipe nobody will see.
  const upstream = new AbortController();
  res.on("close", () => { if (!res.writableFinished) upstream.abort(); });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      signal: upstream.signal,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content }] }),
    });

    if (r.status === 429) return res.status(429).json({ error: "rate limited", code: "rate_limited" });
    if (!r.ok) {
      const detail = await r.text();
      console.error("anthropic error", r.status, detail.slice(0, 500));
      return res.status(502).json({ error: "upstream error", code: "upstream_error" });
    }

    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    try {
      return res.json({ json: JSON.parse(cleaned), raw: text });
    } catch {
      // Sometimes there's a sentence before the JSON — grab the outermost object or array.
      const m = cleaned.match(/[[{][\s\S]*[\]}]/);
      if (m) { try { return res.json({ json: JSON.parse(m[0]), raw: text }); } catch {} }
      return res.status(422).json({ error: "model did not return JSON", code: "invalid_json", raw: text.slice(0, 500) });
    }
  } catch (err) {
    if (upstream.signal.aborted) return console.log("claude call cancelled: the client stopped waiting");
    console.error("claude call failed", err);
    res.status(502).json({ error: "could not reach the API", code: "upstream_error" });
  }
});

/* ---------------- link fetching ----------------
   Recipe sites embed schema.org data, which is exact and free to parse.
   Anything else falls back to page text for the model to read.        */
function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function findRecipe(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findRecipe(n, depth + 1); if (hit) return hit; }
    return null;
  }
  if (typeof node !== "object") return null;
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("Recipe")) return node;
  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    if (node[key]) { const hit = findRecipe(node[key], depth + 1); if (hit) return hit; }
  }
  return null;
}

function schemaToRecipe(r) {
  const minutes = (iso) => {
    if (!iso || typeof iso !== "string") return null;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!m) return null;
    return (Number(m[1] || 0) * 60) + Number(m[2] || 0) || null;
  };
  const steps = [];
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === "string") return steps.push(stripTags(x));
    if (x.itemListElement) return walk(x.itemListElement);
    if (x.text) steps.push(stripTags(x.text));
  };
  walk(r.recipeInstructions);

  const yieldRaw = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield;
  const servings = yieldRaw ? Number(String(yieldRaw).match(/\d+/)?.[0]) || null : null;

  return {
    title: stripTags(String(r.name || "")),
    description: stripTags(String(r.description || "")).slice(0, 300),
    servings,
    prep_min: minutes(r.prepTime),
    cook_min: minutes(r.cookTime),
    // raw_text only: the client's reader turns these into structured quantities
    ingredients: (r.recipeIngredient || []).map((line) => ({ raw_text: stripTags(String(line)) })),
    steps,
    tags: [r.recipeCuisine, r.recipeCategory].flat().filter(Boolean).map((t) => String(t).toLowerCase()).slice(0, 5),
    notes: "",
  };
}

app.post("/api/fetch", async (req, res) => {
  const { url } = req.body || {};
  if (!/^https?:\/\//i.test(url || "")) return res.status(400).json({ error: "bad url", code: "bad_url" });

  const targets = [url];
  // TikTok's public oEmbed endpoint returns the caption, which the page itself hides.
  if (/tiktok\.com/i.test(url)) targets.push(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);

  const parts = [];
  let recipeJson = null;

  for (const target of targets) {
    try {
      const r = await fetch(target, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; Bourdain/1.0)", accept: "text/html,application/json" },
        signal: AbortSignal.timeout(20000),
        redirect: "follow",
      });
      if (!r.ok) continue;
      const body = await r.text();

      if (body.trim().startsWith("{")) {
        try {
          const j = JSON.parse(body);
          parts.push([j.title, j.author_name && `by ${j.author_name}`].filter(Boolean).join("\n"));
          continue;
        } catch {}
      }

      if (!recipeJson) {
        for (const m of body.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
          try {
            const hit = findRecipe(JSON.parse(m[1].trim()));
            if (hit) { recipeJson = schemaToRecipe(hit); break; }
          } catch {}
        }
      }

      const ogDesc = body.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1];
      parts.push([ogDesc, stripTags(body).slice(0, 20000)].filter(Boolean).join("\n\n"));
    } catch (err) {
      console.warn("fetch failed", target, err.message);
    }
  }

  const text = parts.join("\n\n---\n\n").trim();
  if (!text && !recipeJson) return res.status(502).json({ error: "nothing came back", code: "fetch_failed" });
  res.json({ text, recipeJson });
});

/* ---------------- errors ----------------
   Every /api failure answers in JSON with a code the client can act on,
   never Express's HTML error page.                                     */
app.use("/api", (_req, res) => res.status(404).json({ error: "no such endpoint", code: "not_found" }));

function describe(err) {
  if (err.type === "entity.too.large" || err.code === "LIMIT_FILE_SIZE")
    return [413, "too_large", "request too large"];
  if (err.type === "entity.parse.failed") return [400, "bad_json", "request body is not valid JSON"];
  if (err.code === "SQLITE_READONLY" || err.code === "SQLITE_CANTOPEN" || err.code === "SQLITE_PERM")
    return [500, "db_readonly", "database is not writable; check the container runs as 568:568"];
  if (err.code === "SQLITE_FULL" || err.code === "ENOSPC") return [500, "disk_full", "the NAS dataset is full"];
  if (err.code === "SQLITE_BUSY" || err.code === "SQLITE_LOCKED") return [503, "db_busy", "database is busy, try again"];
  return [err.status || err.statusCode || 500, "server_error", "unexpected server error"];
}

/* ---------------- static ----------------
   The app shell must be revalidated on every load, or a phone keeps the old
   app after a redeploy. no-cache still allows a cheap 304 via the ETag.   */
const revalidate = (res) => res.set("Cache-Control", "no-cache");
const sendIndex = (_req, res) => { revalidate(res); res.type("html").send(INDEX_HTML); }; // Express adds an ETag, so 304s still work
app.get(["/", "/index.html"], sendIndex);
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  setHeaders: (res, file) => { if (/\.html$|[\\/]sw\.js$/.test(file)) revalidate(res); },
}));
app.get(/.*/, sendIndex);

// Last, so it catches errors from every route above.
app.use((err, req, res, _next) => {
  const [status, code, error] = describe(err);
  // A 4xx is the request's fault, so the message is enough; a 5xx gets the full stack.
  console.error(`${req.method} ${req.path} failed (${code}):`, status >= 500 ? err : err.message);
  if (res.headersSent) return res.destroy();
  res.status(status).json({ error, code });
});

process.on("unhandledRejection", (err) => console.error("unhandled rejection", err));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bourdain ${VERSION} (${COMMIT}) on :${PORT}  data=${DATA_DIR}  key=${API_KEY ? "set" : "MISSING"}`);
});
