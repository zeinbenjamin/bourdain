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
// A key still set to the compose file's placeholder counts as missing, so the app says "no key" rather than "key rejected".
const realKey = (k) => (k && !/REPLACE-ME/.test(k) ? k : "");
const API_KEY = realKey(process.env.ANTHROPIC_API_KEY);
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const OPENAI_KEY = realKey(process.env.OPENAI_API_KEY);
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-2";
const IMAGE_QUALITY = process.env.IMAGE_QUALITY || "medium";

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
  res.json({ ok: true, hasApiKey: Boolean(API_KEY), hasImageKey: Boolean(OPENAI_KEY), version: VERSION, commit: COMMIT })
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

/* ---------------- upstream calls ----------------
   Every failure from Claude or OpenAI becomes an UpstreamError with a code the
   client turns into a specific message; retrying only helps for some of them. */
class UpstreamError extends Error {
  constructor(status, code, message, detail) { super(message); this.status = status; this.code = code; this.detail = detail; }
}
const send = (res, err) => res.status(err.status).json({ error: err.message, code: err.code, ...(err.detail ? { detail: err.detail } : {}) });

// Aborts when the phone stops waiting (Stop button, dropped connection) or after `ms`.
function upstreamSignal(res, ms) {
  const client = new AbortController();
  res.on("close", () => { if (!res.writableFinished) client.abort(); });
  const timeout = AbortSignal.timeout(ms);
  return { signal: AbortSignal.any([client.signal, timeout]), clientGone: () => client.signal.aborted, timedOut: () => timeout.aborted };
}

/* ---------------- Claude ----------------
   The API key lives here and never reaches the browser.               */
async function callClaude({ content, maxTokens = 16000, up, who = "claude" }) {
  if (!API_KEY) throw new UpstreamError(503, "no_api_key", "no Anthropic API key configured");
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      signal: up.signal,
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
    });
  } catch (err) {
    if (up.clientGone()) throw err;
    if (up.timedOut()) throw new UpstreamError(504, "upstream_timeout", "Claude took too long to answer");
    console.error(`${who}: could not reach Anthropic`, err.message);
    throw new UpstreamError(502, "upstream_unreachable", "could not reach the Anthropic API");
  }
  if (!r.ok) {
    const body = await r.text();
    let msg = ""; try { msg = JSON.parse(body).error?.message || ""; } catch {}
    console.error(`${who}: anthropic ${r.status}`, body.slice(0, 500));
    if (r.status === 401 || r.status === 403) throw new UpstreamError(502, "bad_api_key", "the Anthropic API key was rejected");
    if (r.status === 404) throw new UpstreamError(502, "model_unavailable", `model ${MODEL} is not available`, MODEL);
    if (r.status === 413) throw new UpstreamError(413, "too_large", "request too large for the Anthropic API");
    if (r.status === 429) throw new UpstreamError(429, "rate_limited", "rate limited");
    if (r.status === 529 || r.status === 503) throw new UpstreamError(503, "overloaded", "Claude is overloaded");
    if (r.status === 400 && /credit balance/i.test(msg)) throw new UpstreamError(402, "no_credit", "the Anthropic account is out of credit");
    if (r.status === 400 && /image/i.test(msg)) throw new UpstreamError(422, "image_rejected", "an image was rejected", msg.slice(0, 200));
    if (r.status === 400) throw new UpstreamError(422, "upstream_rejected", "the Anthropic API rejected the request", msg.slice(0, 200));
    throw new UpstreamError(502, "upstream_error", "the Anthropic API returned an error");
  }
  const data = await r.json();
  if (data.stop_reason === "refusal") throw new UpstreamError(422, "refused", "Claude declined the request");
  if (data.stop_reason === "max_tokens") throw new UpstreamError(422, "truncated", "Claude's reply was cut off before it finished");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

app.post("/api/claude", async (req, res) => {
  const { prompt, images } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "no prompt", code: "no_prompt" });
  const content = [];
  for (const img of images || []) {
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type || "image/jpeg", data: img.data } });
  }
  content.push({ type: "text", text: prompt });

  const up = upstreamSignal(res, 120_000);
  try {
    const text = await callClaude({ content, up });
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
    if (up.clientGone()) return console.log("claude call cancelled: the client stopped waiting");
    if (err instanceof UpstreamError) return send(res, err);
    console.error("claude call failed", err);
    res.status(502).json({ error: "claude call failed", code: "upstream_error" });
  }
});

/* ---------------- covers ----------------
   Claude describes the finished dish from the recipe, then OpenAI paints it in the
   house style on a transparent background. Covers are stored as WebP (keeps the
   transparency; the photo pipeline's JPEG would not) next to the photos.      */
const COVER_STYLE = process.env.COVER_STYLE ||
  "Make a Ghibli-inspired food icon I can use to display a recipe for the food. " +
  "I just want the bowl or plate and the cooked final product, nothing else. " +
  "The background must be fully transparent: no table, no backdrop, no cast shadow, " +
  "no border or frame, so the dish looks like it is floating. The dish: ";

async function describeDish(recipe, up) {
  const lines = [
    `Title: ${recipe.title || ""}`,
    recipe.description ? `Description: ${recipe.description}` : "",
    `Ingredients: ${(recipe.ingredients || []).map((i) => i.item || i.raw_text).filter(Boolean).join(", ")}`,
    `Method: ${(recipe.steps || []).join(" ").slice(0, 3000)}`,
  ].filter(Boolean).join("\n");
  const text = await callClaude({
    who: "cover",
    maxTokens: 400,
    up,
    content: [{ type: "text", text:
      "Describe what this finished dish looks like when served, in one sentence of at most 40 words, " +
      "for an illustrator: the main components as they sit on the plate or in the bowl, the garnish, " +
      "and a serving vessel that suits the cuisine. No people, no table, no background. " +
      "Reply with only the sentence.\n\n" + lines }],
  });
  return text.trim().replace(/^"|"$/g, "");
}

async function paintCover(prompt, up) {
  if (!OPENAI_KEY) throw new UpstreamError(503, "no_image_key", "no OpenAI API key configured");
  const attempt = async (background) => {
    let r;
    try {
      r = await fetch("https://api.openai.com/v1/images/generations", {
        signal: up.signal,
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: IMAGE_MODEL, prompt: background === "transparent" ? prompt : prompt + " Use a plain pure white (#ffffff) background.",
          n: 1, size: "1024x1024", quality: IMAGE_QUALITY, background, output_format: "png",
        }),
      });
    } catch (err) {
      if (up.clientGone()) throw err;
      if (up.timedOut()) throw new UpstreamError(504, "image_timeout", "the image model took too long");
      console.error("cover: could not reach OpenAI", err.message);
      throw new UpstreamError(502, "image_unreachable", "could not reach the OpenAI API");
    }
    if (r.ok) {
      const data = await r.json();
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new UpstreamError(502, "image_failed", "the image model returned no image");
      return Buffer.from(b64, "base64");
    }
    const body = await r.text();
    let e = {}; try { e = JSON.parse(body).error || {}; } catch {}
    const msg = String(e.message || "").slice(0, 200);
    console.error(`cover: openai ${r.status}`, body.slice(0, 500));
    if (r.status === 401 || r.status === 403) throw new UpstreamError(502, "bad_image_key", "the OpenAI API key was rejected");
    if (r.status === 429 && /quota|billing/i.test(`${e.code} ${e.type} ${msg}`)) throw new UpstreamError(402, "no_image_credit", "the OpenAI account is out of credit or quota");
    if (r.status === 429) throw new UpstreamError(429, "image_rate_limited", "OpenAI rate limited the request");
    if (r.status === 400 && /moderation|safety|content.?policy/i.test(`${e.code} ${e.type} ${msg}`)) throw new UpstreamError(422, "image_refused", "the image model declined the prompt", msg);
    if (r.status === 400 && background === "transparent" && /background|transparen/i.test(msg)) return null; // retry below
    if (r.status === 400 || r.status === 404) throw new UpstreamError(422, "image_request_rejected", "OpenAI rejected the request", msg);
    throw new UpstreamError(502, "image_upstream_error", "the OpenAI API returned an error");
  };
  // Transparency is a preview feature on gpt-image-2: if the model turns it down, fall
  // back to a white background, which looks the same because covers sit on white.
  const png = (await attempt("transparent")) || (await attempt("opaque"));
  return png;
}

app.post("/api/cover", async (req, res) => {
  const recipe = req.body?.recipe;
  if (!recipe || !recipe.title) return res.status(400).json({ error: "recipe needs a title", code: "no_title" });
  if (!OPENAI_KEY) return send(res, new UpstreamError(503, "no_image_key", "no OpenAI API key configured"));
  const up = upstreamSignal(res, 240_000);
  try {
    const dish = await describeDish(recipe, up);
    const png = await paintCover(COVER_STYLE + dish, up);
    const id = randomUUID().replace(/-/g, "");
    const webp = await sharp(png).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
    await writeFile(path.join(PHOTO_DIR, `${id}.webp`), webp);
    console.log(`cover ${id} for "${recipe.title}": ${dish}`);
    res.json({ id, url: `/api/covers/${id}`, dish });
  } catch (err) {
    if (up.clientGone()) return console.log("cover cancelled: the client stopped waiting");
    if (err instanceof UpstreamError) return send(res, err);
    console.error("cover failed", err);
    res.status(500).json({ error: "could not make the cover", code: "cover_failed" });
  }
});

app.get("/api/covers/:id", (req, res) => {
  if (!/^[a-f0-9]{32}$/.test(req.params.id)) return res.status(400).end();
  const file = path.join(PHOTO_DIR, `${req.params.id}.webp`);
  if (!existsSync(file)) return res.status(404).end();
  res.type("image/webp").set("Cache-Control", "public, max-age=31536000, immutable");
  createReadStream(file)
    .on("error", (err) => { console.error("cover read failed", req.params.id, err.message); if (!res.headersSent) res.status(500).end(); else res.destroy(); })
    .pipe(res);
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
  console.log(`Bourdain ${VERSION} (${COMMIT}) on :${PORT}  data=${DATA_DIR}  key=${API_KEY ? "set" : "MISSING"}  images=${OPENAI_KEY ? IMAGE_MODEL + "/" + IMAGE_QUALITY : "no OpenAI key"}`);
});
