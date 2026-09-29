// 2.0.0: the one-time conversion of a 1.x database (every row becomes the owner's),
// what the server refuses to start with, Cloudflare traffic before 2.3, /api/me
// and Export. See docs/multi-user.md.
import Database from "better-sqlite3";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { suite, startServer, ROOT, OWNER_EMAIL_FOR_TESTS } from "./lib.mjs";

const { check, finish } = suite("migration");
const dirs = [];
const newDir = () => { const d = mkdtempSync(path.join(tmpdir(), "bourdain-mig-")); mkdirSync(path.join(d, "photos")); dirs.push(d); return d; };
const PH = "a".repeat(32), PH2 = "b".repeat(32), CV = "c".repeat(32);
// A database exactly as 1.10.x leaves it: no owner column, no users, no meta.
function v1Database(dir, { blocker } = {}) {
  const db = new Database(path.join(dir, "bourdain.db"));
  for (const t of ["recipes", "plan", "pantry", "shop"]) db.exec(`CREATE TABLE ${t} (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  const put = (t, id, doc) => db.prepare(`INSERT INTO ${t} (id, doc, updated_at) VALUES (?, ?, datetime())`).run(id, typeof doc === "string" ? doc : JSON.stringify(doc));
  put("recipes", "soup", { title: "Leek soup", photos: [PH], cover: CV, rating: 2, cooks: [{ date: "2026-09-20", at: "2026-09-20T19:00:00Z", mult: 1 }] });
  put("recipes", "katsu", { title: "Chicken katsu", photos: [], cooks: [] });
  put("recipes", "broken", "{not json");
  put("plan", "2026-09-28", { date: "2026-09-28", entries: [{ recipeId: "soup", servings: 2 }] });
  put("plan", "2026-09-29", { date: "2026-09-29", entries: [] });
  put("pantry", "p1", { id: "p1", item: "lemons", aisle: "produce" });
  put("shop", "2026-09-28", { week: "2026-09-28", items: [] });
  if (blocker) db.exec(`CREATE TABLE ${blocker} (x INTEGER)`); // makes the migration fail partway, like a real error would
  db.close();
}
const inspect = (dir) => {
  const db = new Database(path.join(dir, "bourdain.db"), { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  const cols = db.prepare("PRAGMA table_info(recipes)").all().map((c) => c.name);
  const version = tables.includes("meta") ? db.prepare("SELECT value FROM meta WHERE key='data_version'").get()?.value : undefined;
  const users = tables.includes("users") ? db.prepare("SELECT * FROM users").all() : null;
  const recipeCount = db.prepare("SELECT COUNT(*) AS n FROM recipes").get().n;
  const owners = cols.includes("owner") ? db.prepare("SELECT DISTINCT owner FROM recipes").all().map((r) => r.owner) : null;
  db.close();
  return { tables, cols, version, users, recipeCount, owners };
};
// Start server.js and expect it to refuse: resolves with its exit code and output.
const expectRefusal = (dir, env) => new Promise((resolve) => {
  const p = spawn("node", ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: "19699", DATA_DIR: dir, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", ...env } });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const t = setTimeout(() => { p.kill(); resolve({ code: "still running", out }); }, 10000);
  p.on("exit", (code) => { clearTimeout(t); resolve({ code, out }); });
});

let s;
try {
  // --- a 1.x database is converted, all of it to the owner
  const dir = newDir(); v1Database(dir);
  writeFileSync(path.join(dir, "photos", PH + ".jpg"), "jpeg-bytes"); writeFileSync(path.join(dir, "photos", CV + ".webp"), "webp-bytes");
  writeFileSync(path.join(dir, "photos", PH2 + ".jpg"), "not-used-by-any-recipe");
  s = await startServer({ port: 19601, dataDir: dir });
  const st = await s.state();
  check("everything from 1.x is still there", st.recipes.soup?.title === "Leek soup" && st.recipes.katsu && Object.keys(st.plan).length === 2 && st.pantry.p1 && Object.keys(st.shop).length === 1, JSON.stringify(Object.keys(st.recipes)));
  check("…including cook log and rating", st.recipes.soup.cooks.length === 1 && st.recipes.soup.rating === 2);
  check("the unreadable row is carried across too (skipped when loading, as before)", !st.recipes.broken && /skipping corrupt row recipes\/broken/.test(s.log()));
  check("the log says what it found and moved", /data migration 1 → 2: found 3 recipes, 2 plan, 1 pantry, 1 shop; giving them all to owner@example\.com/.test(s.log()) && /data migration 1 → 2: done, 3 recipes, 2 plan, 1 pantry, 1 shop now owned by owner@example\.com/.test(s.log()), s.log());
  await s.stop();
  let db = inspect(dir);
  check("tables now have an owner, and every row is the owner's", db.cols.join() === "owner,id,doc,updated_at" && db.owners.length === 1 && db.owners[0] === db.users[0].id && db.recipeCount === 3, JSON.stringify(db));
  check("one user: the owner, as admin, with OWNER_EMAIL", db.users.length === 1 && db.users[0].email === OWNER_EMAIL_FOR_TESTS && db.users[0].is_admin === 1);
  check("data version stored as 2, and no leftover _v2 tables", db.version === "2" && !db.tables.some((t) => t.endsWith("_v2")), JSON.stringify(db.tables));
  const ownerId = db.users[0].id;
  s.clearLog(); await s.restart();
  check("a second start doesn't migrate again", !/data migration/.test(s.log()) && inspect(dir).users[0].id === ownerId);
  const me = await (await fetch(s.url + "/api/me")).json();
  check("/api/me is the owner", me.id === ownerId && me.email === OWNER_EMAIL_FOR_TESTS && me.is_admin === true, JSON.stringify(me));
  const health = await (await fetch(s.url + "/api/health")).json();
  check("health and version report data version 2", health.dataVersion === 2 && (await (await fetch(s.url + "/api/version")).json()).dataVersion === 2);

  // --- writes after the update
  check("an old phone's write (no stamp) is accepted and owned", (await s.put("recipes", "fromOld", { title: "Queued before updating" })).status === 204);
  const w1 = await fetch(s.url + "/api/pantry/p2", { method: "PUT", headers: { "Content-Type": "application/json", "X-Bourdain-Data": "1" }, body: JSON.stringify({ id: "p2", item: "rice" }) });
  const w3 = await fetch(s.url + "/api/pantry/p3", { method: "PUT", headers: { "Content-Type": "application/json", "X-Bourdain-Data": "3" }, body: JSON.stringify({ id: "p3", item: "?" }) });
  check("stamped 1 accepted, stamped 3 refused (data_newer)", w1.status === 204 && w3.status === 409 && (await w3.json()).code === "data_newer");
  const st2 = await s.state();
  check("…and they land in the owner's book", st2.recipes.fromOld && st2.pantry.p2 && !st2.pantry.p3);
  const del = await fetch(s.url + "/api/recipes/fromOld", { method: "DELETE" });
  check("deletes work on the owner's rows", del.status === 204 && !(await s.state()).recipes.fromOld);

  // --- through Cloudflare before 2.3: refused, never the recipes
  const viaCf = (p) => fetch(s.url + p, { headers: { "Cf-Ray": "8c1a2b3c4d5e-LHR", "Cf-Connecting-Ip": "203.0.113.9" } });
  const cf = await viaCf("/api/state");
  check("a request through Cloudflare gets 403 cf_not_set_up, not the recipes", cf.status === 403 && (await cf.json()).code === "cf_not_set_up");
  check("…same for photos, me and export", (await viaCf(`/api/photos/${PH}`)).status === 403 && (await viaCf("/api/me")).status === 403 && (await viaCf("/api/export")).status === 403);
  check("…but health still answers (no data in it)", (await viaCf("/api/health")).ok);

  // --- Export my data
  const ex = await fetch(s.url + "/api/export");
  const zipFile = path.join(dir, "export.zip"); writeFileSync(zipFile, Buffer.from(await ex.arrayBuffer()));
  check("export downloads as bourdain-YYYY-MM-DD.zip", ex.ok && ex.headers.get("content-type") === "application/zip" && /attachment; filename="bourdain-\d{4}-\d{2}-\d{2}\.zip"/.test(ex.headers.get("content-disposition")), ex.headers.get("content-disposition"));
  let test = ""; try { test = execFileSync("unzip", ["-t", zipFile]).toString(); } catch (e) { test = String(e.stdout || e); }
  check("…and it's a valid zip", /No errors detected/.test(test), test);
  const list = execFileSync("unzip", ["-Z1", zipFile]).toString().trim().split("\n").sort();
  check("…with data.json, the recipe's photo and cover, and not unused files", JSON.stringify(list) === JSON.stringify(["bourdain/covers/" + CV + ".webp", "bourdain/data.json", "bourdain/photos/" + PH + ".jpg"]), JSON.stringify(list));
  const data = JSON.parse(execFileSync("unzip", ["-p", zipFile, "bourdain/data.json"]).toString());
  check("data.json has everything the owner has", data.user.email === OWNER_EMAIL_FOR_TESTS && data.data_version === 2 && data.recipes.soup.title === "Leek soup" && Object.keys(data.plan).length === 2 && data.pantry.p2 && data.shop, JSON.stringify(Object.keys(data)));
  check("photo bytes are intact", execFileSync("unzip", ["-p", zipFile, `bourdain/photos/${PH}.jpg`]).toString() === "jpeg-bytes");

  // --- changing OWNER_EMAIL renames the same account
  s.clearLog(); await s.restart({ OWNER_EMAIL: "Zein.New@Example.com " });
  const me2 = await (await fetch(s.url + "/api/me")).json();
  check("new OWNER_EMAIL: same account (same id, same recipes), new email", me2.id === ownerId && me2.email === "zein.new@example.com" && (await s.state()).recipes.soup && /owner email changed: owner@example\.com → zein\.new@example\.com/.test(s.log()), JSON.stringify(me2));
  await s.stop();
  check("…and still only one user", inspect(dir).users.length === 1);
  s = null;

  // --- refusing to start
  const noOwner = newDir(); v1Database(noOwner);
  const r1 = await expectRefusal(noOwner, { OWNER_EMAIL: "" });
  db = inspect(noOwner);
  check("no OWNER_EMAIL: refuses to start and says how to fix it", r1.code === 1 && /OWNER_EMAIL is not set/.test(r1.out), r1.out);
  check("…and the 1.x database is untouched", db.cols.join() === "id,doc,updated_at" && db.users === null && db.version === undefined && db.recipeCount === 3, JSON.stringify(db));

  const half = newDir(); v1Database(half, { blocker: "pantry_v2" });
  const r2 = await expectRefusal(half, { OWNER_EMAIL: OWNER_EMAIL_FOR_TESTS });
  db = inspect(half);
  check("a migration that fails partway (after recipes and plan moved) stops the server", r2.code === 1 && /Couldn't set up the database, so nothing was changed/.test(r2.out), r2.out);
  check("…and leaves every 1.x table exactly as it was (no owner column, no users, no version)", db.cols.join() === "id,doc,updated_at" && db.users === null && db.version === undefined && db.recipeCount === 3 && JSON.stringify(db.tables.sort()) === JSON.stringify(["pantry", "pantry_v2", "plan", "recipes", "shop"]), JSON.stringify(db));
  const fix = new Database(path.join(half, "bourdain.db")); fix.exec("DROP TABLE pantry_v2"); fix.close();
  s = await startServer({ port: 19602, dataDir: half });
  check("once the cause is gone, it migrates normally", (await s.state()).recipes.soup && inspect(half).version === "2");
  await s.stop(); s = null;

  const future = newDir(); v1Database(future);
  const fdb = new Database(path.join(future, "bourdain.db")); fdb.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('data_version', '3')"); fdb.close();
  const r3 = await expectRefusal(future, { OWNER_EMAIL: OWNER_EMAIL_FOR_TESTS });
  check("data from a newer version: refuses to start rather than damage it", r3.code === 1 && /data version 3, but this build only understands up to 2/.test(r3.out), r3.out);

  // --- a brand new install
  const fresh = newDir();
  s = await startServer({ port: 19603, dataDir: fresh });
  await s.put("recipes", "first", { title: "First recipe" });
  check("a new, empty install starts on data version 2 with the owner", (await s.state()).recipes.first && inspect(fresh).version === "2" && inspect(fresh).users.length === 1 && !/data migration/.test(s.log()));
  finish();
} catch (e) { finish(e); } finally { await s?.stop(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); }
