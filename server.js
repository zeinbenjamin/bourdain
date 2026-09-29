import express from "express";
import multer from "multer";
import Database from "better-sqlite3";
import sharp from "sharp";
import { randomUUID, randomBytes } from "node:crypto";
import { crc32 } from "node:zlib";
import { mkdirSync, existsSync, createReadStream, readFileSync } from "node:fs";
import { writeFile, readdir, stat, unlink } from "node:fs/promises";
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

/* ---------------- database ----------------
   Data version 2 (2.0.0, docs/multi-user.md): every row in the four collections
   has an owner, and `users` says who's who. A version 1 database (single user,
   no owner column) is converted once, on the first start, inside one
   transaction: it either finishes or leaves the old tables exactly as they were. */
const db = new Database(path.join(DATA_DIR, "bourdain.db"));
db.pragma("journal_mode = WAL");
const COLLECTIONS = new Set(["recipes", "plan", "pantry", "shop"]);
/* The shape of stored data, 2 since 2.0.0. Phones send theirs with every write as
   X-Bourdain-Data; a write from a newer app is refused, so after a rollback a phone
   still running the newer app can't write its data into older tables. Writes
   stamped 1 (a phone that queued them before updating) are accepted: the documents
   look the same, and the owner always comes from who's signed in, never the phone. */
const DATA_VERSION = 2;
// The one account that owns everything from before 2.0 and is the admin. Recognised
// by its row, not its email, so changing OWNER_EMAIL renames the account.
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim().toLowerCase();

const columns = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
function storedDataVersion() {
  const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  const row = hasMeta && db.prepare("SELECT value FROM meta WHERE key = 'data_version'").get();
  if (row) return Number(row.value);
  return columns("recipes").length ? 1 : 0; // 0: a brand new, empty database
}
const ownedTable = (t) => `CREATE TABLE ${t} (owner TEXT NOT NULL, id TEXT NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner, id))`;
const newUserId = () => randomBytes(6).toString("hex");
const counts = () => Object.fromEntries([...COLLECTIONS].map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
const fmtCounts = (c) => [...COLLECTIONS].map((t) => `${c[t]} ${t}`).join(", ");

function openData() {
  const from = storedDataVersion();
  if (from > DATA_VERSION) {
    console.error(`The database is data version ${from}, but this build only understands up to ${DATA_VERSION}. Not starting, so nothing gets damaged. Deploy the newer image, or roll the data dataset back to the snapshot taken before it.`);
    process.exit(1);
  }
  if (!OWNER_EMAIL) {
    console.error("OWNER_EMAIL is not set. Add it to the app's environment (the email you'll sign in with) and redeploy. Nothing was changed.");
    process.exit(1);
  }
  const now = new Date().toISOString();
  const setUp = db.transaction(() => {
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, photo TEXT,
             is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_seen TEXT)`);
    let owner = db.prepare("SELECT * FROM users WHERE is_admin = 1 ORDER BY created_at LIMIT 1").get();
    if (!owner) {
      db.prepare("INSERT INTO users (id, email, is_admin, created_at) VALUES (?, ?, 1, ?)").run(newUserId(), OWNER_EMAIL, now);
      owner = db.prepare("SELECT * FROM users WHERE is_admin = 1").get();
    }
    if (from === 0) for (const t of COLLECTIONS) db.exec(ownedTable(t));
    if (from === 1) {
      const before = counts();
      console.log(`data migration 1 → 2: found ${fmtCounts(before)}; giving them all to ${OWNER_EMAIL}`);
      for (const t of COLLECTIONS) {
        db.exec(ownedTable(`${t}_v2`));
        db.prepare(`INSERT INTO ${t}_v2 (owner, id, doc, updated_at) SELECT ?, id, doc, updated_at FROM ${t}`).run(owner.id);
        db.exec(`DROP TABLE ${t}; ALTER TABLE ${t}_v2 RENAME TO ${t}`);
      }
      const after = counts();
      if (fmtCounts(after) !== fmtCounts(before)) throw new Error(`counts changed during the migration (${fmtCounts(before)} → ${fmtCounts(after)})`);
      console.log(`data migration 1 → 2: done, ${fmtCounts(after)} now owned by ${OWNER_EMAIL}`);
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(DATA_VERSION));
    if (owner.email !== OWNER_EMAIL) {
      db.prepare("UPDATE users SET email = ? WHERE id = ?").run(OWNER_EMAIL, owner.id);
      console.log(`owner email changed: ${owner.email} → ${OWNER_EMAIL} (same account, same recipes)`);
    }
  });
  try { setUp(); }
  catch (err) {
    console.error(`Couldn't set up the database, so nothing was changed: ${err.message}. The data is exactly as it was; this build won't start until that's fixed.`);
    process.exit(1);
  }
  return db.prepare("SELECT * FROM users WHERE is_admin = 1 ORDER BY created_at LIMIT 1").get();
}
const OWNER = openData();

// One unreadable row must not take the whole app down, so skip it and say which.
const readAll = (t, owner) => {
  const out = {};
  for (const r of db.prepare(`SELECT id, doc FROM ${t} WHERE owner = ?`).all(owner)) {
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
  res.json({ ok: true, hasApiKey: Boolean(API_KEY), hasImageKey: Boolean(OPENAI_KEY), version: VERSION, commit: COMMIT, dataVersion: DATA_VERSION })
);

app.get("/api/version", (_req, res) => res.json({ version: VERSION, commit: COMMIT, dataVersion: DATA_VERSION, changelog: CHANGELOG }));

/* ---------------- who is asking ----------------
   2.0 is still single-user: Cloudflare sign-in isn't checked until 2.3 (see
   docs/multi-user.md), so every request is the owner. Until then, anything that
   arrives through Cloudflare is refused outright: a public hostname added to the
   tunnel too early must show "not set up yet", never the owner's recipes.
   /api/health and /api/version above stay open; they hold no data.            */
let lastSeenWritten = 0;
app.use("/api", (req, res, next) => {
  if (req.get("cf-ray") || req.get("cf-connecting-ip") || req.get("cf-access-jwt-assertion"))
    return res.status(403).json({ error: "Bourdain isn't set up for access through Cloudflare yet", code: "cf_not_set_up" });
  req.user = OWNER;
  if (Date.now() - lastSeenWritten > 5 * 60_000) { // a write per request would be wasteful; every 5 minutes is plenty
    lastSeenWritten = Date.now();
    db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(new Date().toISOString(), req.user.id);
  }
  next();
});

const me = (u) => ({ id: u.id, email: u.email, name: u.name || null, photo: u.photo || null, is_admin: Boolean(u.is_admin) });
app.get("/api/me", (req, res) => res.json(me(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id))));
// Name and photo. The photo is an id from /api/photos, like a recipe photo.
app.put("/api/me", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 40) return res.status(400).json({ error: "a name is 1 to 40 characters", code: "bad_name" });
  const photo = req.body?.photo ?? null;
  if (photo !== null && !/^[a-f0-9]{32}$/.test(photo)) return res.status(400).json({ error: "photo must be an uploaded photo id or null", code: "bad_photo" });
  db.prepare("UPDATE users SET name = ?, photo = ? WHERE id = ?").run(name, photo, req.user.id);
  res.json(me(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)));
});

/* ---------------- other people (2.1) ----------------
   Everyone signed in can see everyone's recipes and cooks ("share all",
   docs/multi-user.md). Emails are never sent to anyone but their owner.
   Only people who have chosen a name appear; someone mid-welcome doesn't.     */
const person = (u, viewer) => ({ id: u.id, name: u.name, photo: u.photo || null, me: u.id === viewer });
const named = () => db.prepare("SELECT * FROM users WHERE name IS NOT NULL AND name != '' ORDER BY created_at").all();
const recipesOf = (owner) => readAll("recipes", owner);
app.get("/api/people", (req, res) => {
  res.json(named().map((u) => {
    const rs = Object.values(recipesOf(u.id));
    return { ...person(u, req.user.id), recipes: rs.length, cooks: rs.reduce((n, r) => n + ((r && r.cooks) || []).filter((c) => c && c.date).length, 0) };
  }));
});
app.get("/api/people/:id", (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!u || !u.name) return res.status(404).json({ error: "no such person", code: "not_found" });
  res.json({ person: person(u, req.user.id), recipes: recipesOf(u.id) });
});
app.get("/api/people/:id/recipes/:rid", (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  const row = u && db.prepare("SELECT doc FROM recipes WHERE owner = ? AND id = ?").get(u.id, req.params.rid);
  let doc = null; try { doc = row && JSON.parse(row.doc); } catch {}
  if (!doc) return res.status(404).json({ error: "that recipe isn't there any more", code: "not_found" });
  res.json({ person: person(u, req.user.id), id: req.params.rid, recipe: doc });
});

// Which of the caller's recipes are copies of whose: "owner/id" -> the copy's id.
const copiesOf = (owner) => {
  const out = new Map();
  for (const [id, r] of Object.entries(recipesOf(owner))) if (r && r.copied_from && r.copied_from.owner) out.set(`${r.copied_from.owner}/${r.copied_from.id}`, id);
  return out;
};
/* Add to my recipes: a copy the caller owns. Rating and cook log start empty (each
   copy has its owner's rating), and copied_from keeps the credit. Photos and the
   cover are shared by id: the files are never duplicated, and the cover sweep
   already looks at every owner's recipes before deleting one. */
app.post("/api/copy", (req, res) => {
  const { owner, id } = req.body || {};
  if (owner === req.user.id) return res.status(400).json({ error: "that's already your recipe", code: "own_recipe" });
  const u = typeof owner === "string" && db.prepare("SELECT * FROM users WHERE id = ?").get(owner);
  const row = u && db.prepare("SELECT doc FROM recipes WHERE owner = ? AND id = ?").get(u.id, String(id));
  let src = null; try { src = row && JSON.parse(row.doc); } catch {}
  if (!src) return res.status(404).json({ error: "that recipe isn't there any more", code: "not_found" });
  const existing = copiesOf(req.user.id).get(`${u.id}/${id}`);
  if (existing) return res.json({ id: existing, recipe: JSON.parse(db.prepare("SELECT doc FROM recipes WHERE owner = ? AND id = ?").get(req.user.id, existing).doc), already: true });
  const now = new Date().toISOString();
  const copy = { ...src, copied_from: { owner: u.id, id: String(id), name: u.name || "", title: src.title || "" }, created_at: now, updated_at: now };
  delete copy.rating; copy.cooks = [];
  const newId = randomUUID().replace(/-/g, "").slice(0, 12);
  db.prepare("INSERT INTO recipes (owner, id, doc, updated_at) VALUES (?, ?, ?, ?)").run(req.user.id, newId, JSON.stringify(copy), now);
  res.status(201).json({ id: newId, recipe: copy, already: false });
});

// Search across everyone else's books: the same fields as the phone's own search.
app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.status(400).json({ error: "type at least 2 letters", code: "short_query" });
  const copies = copiesOf(req.user.id), hits = [];
  for (const u of named()) {
    if (u.id === req.user.id) continue;
    for (const [id, r] of Object.entries(recipesOf(u.id))) {
      if (!r) continue;
      const title = (r.title || "").toLowerCase();
      const hay = [title, r.description, ...(r.tags || []), ...(r.ingredients || []).map((i) => i && (i.item || i.raw_text))].join(" ").toLowerCase();
      if (!hay.includes(q)) continue;
      hits.push({ rank: title.includes(q) ? 0 : 1, owner: u.id, name: u.name, photo: u.photo || null, id, title: r.title || "", cover: r.cover || null,
        firstPhoto: (r.photos || [])[0] || null, rating: r.rating ?? null, prep_min: r.prep_min || 0, cook_min: r.cook_min || 0, servings: r.servings || null,
        copied: copies.get(`${u.id}/${id}`) || null });
    }
  }
  hits.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  res.json(hits.slice(0, 20).map(({ rank, ...h }) => h));
});

// The Archives feed: everyone's finished cooks, newest first, paged by `before`.
app.get("/api/feed", (req, res) => {
  const before = typeof req.query.before === "string" ? req.query.before : null;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 300));
  const out = [];
  for (const u of named()) {
    const who = person(u, req.user.id);
    for (const [id, r] of Object.entries(recipesOf(u.id))) {
      for (const c of (r && r.cooks) || []) {
        if (!c || !c.date) continue;
        out.push({ who, owner: u.id, recipeId: id, title: r.title || "", cover: r.cover || null, firstPhoto: (r.photos || [])[0] || null,
          rating: r.rating ?? null, date: c.date, at: c.at || c.date, mult: c.mult || 1 });
      }
    }
  }
  // the caller's own cooks count even before they've picked a name
  if (!out.some((e) => e.who.me)) {
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!u.name) for (const [id, r] of Object.entries(recipesOf(u.id))) for (const c of (r && r.cooks) || []) {
      if (c && c.date) out.push({ who: { id: u.id, name: null, photo: u.photo || null, me: true }, owner: u.id, recipeId: id, title: r.title || "", cover: r.cover || null,
        firstPhoto: (r.photos || [])[0] || null, rating: r.rating ?? null, date: c.date, at: c.at || c.date, mult: c.mult || 1 });
    }
  }
  const key = (e) => `${e.date}|${e.at}`;
  out.sort((a, b) => key(b).localeCompare(key(a)));
  const page = (before ? out.filter((e) => key(e) < before) : out).slice(0, limit);
  res.json({ entries: page, next: page.length === limit ? key(page[page.length - 1]) : null });
});

app.get("/api/state", (req, res) => {
  res.json({
    recipes: readAll("recipes", req.user.id),
    plan: readAll("plan", req.user.id),
    pantry: readAll("pantry", req.user.id),
    shop: readAll("shop", req.user.id),
  });
});

/* Export my data: one zip with everything the caller owns (data.json) and the
   photo and cover files their recipes use. Files are stored uncompressed: JPEG
   and WebP are already compressed, and it keeps the zip writer tiny. */
function zipStore(files) {
  const parts = [], central = [];
  let offset = 0;
  const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, data } of files) {
    const n = Buffer.from(name, "utf8"), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(local, n, data); central.push(cd, n);
    offset += 30 + n.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}
app.get("/api/export", async (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const data = { exported_at: new Date().toISOString(), app_version: VERSION, data_version: DATA_VERSION, user: { email: u.email, name: u.name || null, photo: u.photo || null } };
  for (const t of COLLECTIONS) data[t] = readAll(t, u.id);
  const files = [{ name: "bourdain/data.json", data: Buffer.from(JSON.stringify(data, null, 2)) }];
  const assets = new Map(); // file name -> path on disk
  for (const r of Object.values(data.recipes)) {
    for (const id of r.photos || []) if (/^[a-f0-9]{32}$/.test(id)) assets.set(`photos/${id}.jpg`, path.join(PHOTO_DIR, `${id}.jpg`));
    if (/^[a-f0-9]{32}$/.test(r.cover || "")) assets.set(`covers/${r.cover}.webp`, path.join(PHOTO_DIR, `${r.cover}.webp`));
  }
  if (/^[a-f0-9]{32}$/.test(u.photo || "")) assets.set(`profile/${u.photo}.jpg`, path.join(PHOTO_DIR, `${u.photo}.jpg`));
  let missing = 0;
  for (const [name, file] of assets) {
    try { files.push({ name: `bourdain/${name}`, data: readFileSync(file) }); } catch { missing++; }
  }
  if (missing) console.warn(`export: ${missing} photo or cover file${missing === 1 ? " was" : "s were"} missing on disk and left out`);
  const day = new Date().toISOString().slice(0, 10);
  res.set("Content-Disposition", `attachment; filename="bourdain-${day}.zip"`).type("application/zip").send(zipStore(files));
});

// Refuse writes made by an app that stores a newer shape of data. No header = an
// app from before 1.10.1, which is data version 1 and still accepted.
const sameDataVersion = (req, res, next) => {
  const v = Number(req.get("X-Bourdain-Data") || 1);
  if (v > DATA_VERSION)
    return res.status(409).json({ error: `this change comes from a newer version of the app (data ${v}); this server is data ${DATA_VERSION}`, code: "data_newer" });
  next();
};
app.put("/api/:col/:id", sameDataVersion, (req, res) => {
  const { col, id } = req.params;
  if (!COLLECTIONS.has(col)) return res.status(404).json({ error: "unknown collection", code: "bad_collection" });
  db.prepare(`INSERT INTO ${col} (owner, id, doc, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(owner, id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`)
    .run(req.user.id, id, JSON.stringify(req.body ?? {}), new Date().toISOString());
  res.status(204).end();
});

app.delete("/api/:col/:id", sameDataVersion, (req, res) => {
  const { col, id } = req.params;
  if (!COLLECTIONS.has(col)) return res.status(404).json({ error: "unknown collection", code: "bad_collection" });
  db.prepare(`DELETE FROM ${col} WHERE owner = ? AND id = ?`).run(req.user.id, id);
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

/* Old covers are swept, not deleted inline: a cover can be referenced by a draft
   that isn't saved yet, or by a save still waiting in a phone's offline queue.
   So only a .webp no recipe points at AND older than the grace period goes.
   Photos (.jpg) are the user's own and are never touched.                     */
const COVER_GRACE_DAYS = Number(process.env.COVER_GRACE_DAYS || 7);
async function sweepCovers() {
  const used = new Set();
  let rows = 0;
  for (const r of db.prepare("SELECT id, doc FROM recipes").all()) {
    rows++;
    try { const c = JSON.parse(r.doc).cover; if (c) used.add(c); }
    catch { console.warn(`cover sweep skipped: recipe ${r.id} can't be read, so its cover can't be ruled out`); return { skipped: "corrupt_row" }; }
  }
  if (!rows) { console.warn("cover sweep skipped: no recipes in the database"); return { skipped: "no_recipes" }; }
  const cutoff = Date.now() - COVER_GRACE_DAYS * 86_400_000;
  let removed = 0, kept = 0;
  for (const f of await readdir(PHOTO_DIR)) {
    const m = f.match(/^([a-f0-9]{32})\.webp$/);
    if (!m || used.has(m[1])) continue;
    const file = path.join(PHOTO_DIR, f);
    try {
      if ((await stat(file)).mtimeMs > cutoff) { kept++; continue; }
      await unlink(file); removed++;
    } catch (err) { console.warn("cover sweep: couldn't remove", f, err.message); }
  }
  if (removed || kept) console.log(`cover sweep: removed ${removed} unused cover${removed === 1 ? "" : "s"}, kept ${kept} newer than ${COVER_GRACE_DAYS} days`);
  return { removed, kept };
}
const runSweep = () => sweepCovers().catch((err) => console.error("cover sweep failed", err));

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

runSweep();
setInterval(runSweep, 86_400_000).unref();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bourdain ${VERSION} (${COMMIT}) on :${PORT}  data=${DATA_DIR} (data v${DATA_VERSION}, owner ${OWNER.email})  key=${API_KEY ? "set" : "MISSING"}  images=${OPENAI_KEY ? IMAGE_MODEL + "/" + IMAGE_QUALITY : "no OpenAI key"}`);
});
