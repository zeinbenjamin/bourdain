// Pilot gates and snapshots in the owner's view (2.9.0). Imports by source over 30 days (a
// "no recipe found" answer and a failed link fetch count as failed), which of the last six
// weeks each person cooked in, AI cost per active person; and the Backups health row read
// from the ZFS snapshot folders the datasets show (names only: the container can't open them).
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("gates");
let s, b;
try {
  s = await startServer({ port: 20721, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test" } });
  const db = () => new Database(path.join(s.data, "bourdain.db"));
  const get = async (p) => (await fetch(s.url + p)).json();
  const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const daysAgo = (n) => { const x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - n); return x; };
  const mon = (w) => { const x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7) - 7 * w); return x; }; // Monday, w weeks ago

  // --- imports, each kind of source
  const imp = (material, images = []) => s.post("/api/ai", { kind: "import", material, images });
  const shot = { media_type: "image/jpeg", data: "aGVsbG8=" };
  await imp({ url: "https://www.instagram.com/reel/ABC123/", text: "2 chicken thighs" });
  await imp({ url: "https://www.taste.com.au/recipes/x/abc", text: "2 chicken thighs" });
  await imp({ text: "" }, [shot]);
  await imp({ text: "2 chicken thighs, cook them" });
  s.setMode({ import: "norecipe" });
  const none = await imp({ url: "https://www.recipetineats.com/x/", text: "a blog post with no recipe" });
  s.setMode({});
  check("an import Claude finds no recipe in still answers as before ('no recipe found')", none.status === 200 && none.json?.error === "no recipe found", JSON.stringify(none));
  await s.post("/api/ai", { kind: "dish", material: {}, images: [shot] });
  const prof = await s.post("/api/fetch", { url: "https://www.instagram.com/somebody/" });
  check("(a link to an Instagram profile is refused, and logged)", prof.status === 422 && prof.notPost === true, JSON.stringify(prof));
  { const d = db(); d.prepare("INSERT INTO ai_usage (user, at, day, kind, grp, model, outcome) VALUES ((SELECT id FROM users WHERE is_admin = 1), ?, ?, 'import', 'import', 'm', 'ok')").run(new Date().toISOString(), ymd(new Date())); d.close(); } // a call from before 2.9.0: no source
  { const d = db(); const rows = d.prepare("SELECT kind, source, outcome FROM ai_usage WHERE kind IN ('import','dish') ORDER BY id").all(); d.close();
    check("each import is kept with its kind of source, never the link", rows.slice(0, 6).map((r) => r.source).join("|") === "Instagram|Recipe sites|Screenshots and recordings|Pasted text|Recipe sites|Guess from a photo" && rows[4].outcome === "no_recipe", JSON.stringify(rows)); }
  const health0 = (await get("/api/admin/summary")).health.ai;
  check("…a 'no recipe found' answer doesn't make the AI look broken", health0.status === "ok", JSON.stringify(health0));

  // --- people and their cooks over six weeks
  { const d = db(), ins = d.prepare("INSERT INTO recipes (owner, id, doc, updated_at) VALUES (?, ?, ?, datetime())");
    d.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('ana', 'ana@example.com', 'Ana', datetime()), ('ben', 'ben@example.com', 'Ben', datetime()), ('nob', 'nob@example.com', NULL, datetime())").run();
    const c = (x, added) => ({ date: ymd(x), at: x.toISOString(), mult: 1, ...(added ? { added: true } : {}) });
    ins.run("ana", "a1", JSON.stringify({ title: "Pho", cooks: [c(mon(0)), c(mon(1)), c(mon(3)), c(mon(4)), c(mon(4)), c(mon(5), true)] }));
    ins.run("ben", "b1", JSON.stringify({ title: "Toast", cooks: [c(mon(2))] }));
    ins.run("nob", "n1", JSON.stringify({ title: "Tea", cooks: [c(mon(0))] }));
    const owner = d.prepare("SELECT id FROM users WHERE is_admin = 1").get().id;
    ins.run(owner, "o1", JSON.stringify({ title: "Mine", cooks: [c(mon(0))] })); d.close(); }

  const g = (await get("/api/admin/summary")).gates;
  const row = (src) => g.imports.find((x) => x.source === src) || {};
  check("imports, last 30 days, by source: a link that worked and a profile link that didn't (Instagram 1 of 2)", row("Instagram").ok === 1 && row("Instagram").total === 2, JSON.stringify(g.imports));
  check("…recipe sites: one read, one with no recipe in it (1 of 2)", row("Recipe sites").ok === 1 && row("Recipe sites").total === 2, JSON.stringify(row("Recipe sites")));
  check("…screenshots, pasted text, a photo guess: 1 of 1 each; TikTok and YouTube none yet", ["Screenshots and recordings", "Pasted text", "Guess from a photo"].every((x) => row(x).ok === 1 && row(x).total === 1) && row("TikTok").total === 0 && row("YouTube").total === 0, JSON.stringify(g.imports));
  check("…and a call from before 2.9.0 is counted on its own", row("Before 2.9.0 (source not kept)").total === 1, JSON.stringify(g.imports));
  const ana = g.cooking.find((p) => p.id === "ana"), ben = g.cooking.find((p) => p.id === "ben");
  check("cooking, last 6 weeks (oldest first): Ana cooked in 4, the added past cook not counted", ana && ana.weeks.join() === "false,true,true,false,true,true", JSON.stringify(ana));
  check("…Ben in 1; you and anyone without a name aren't listed", ben && ben.weeks.filter(Boolean).length === 1 && g.cooking.length === 2, JSON.stringify(g.cooking));
  check("…and how many people opened Bourdain this month, for AI cost per person", g.active === 1, String(g.active));

  // --- the owner's view: Admin → Pilot gates
  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  await page.evaluate(() => openAdmin()); await page.waitForSelector('.adm-a[data-go="gates"]');
  const btn = await page.textContent('.adm-a[data-go="gates"] small');
  check("Admin → Pilot gates says how the tests stand", /^Imports 75% · 1 of 2 cooking 4 of 6 weeks$/.test(btn), btn);
  await page.click('.adm-a[data-go="gates"]'); await page.waitForSelector(".gweeks");
  const txt = (await page.textContent("#view-admin")).replace(/\s+/g, " ");
  check("…its page: all sources against 90%, each source, Instagram under target in red", /All sources\s?6 of 8 · 75% · target 90%/.test(txt) && /Instagram\s?1 of 2 · 50%/.test(txt) && (await page.locator(".adm-row:has-text('Instagram') .gbad").count()) === 1, txt.slice(0, 400));
  const sq = await page.$$eval(".gcook", (rs) => rs.map((r) => r.textContent.replace(/\s+/g, " ").trim() + ":" + [...r.querySelectorAll(".gweeks i")].map((i) => (i.classList.contains("on") ? 1 : 0)).join("")));
  check("…six squares a person, filled for weeks with a cook, '4 of 6'", sq.some((x) => /Ana.*4 of 6:011011/.test(x)) && sq.some((x) => /Ben.*1 of 6/.test(x)), JSON.stringify(sq));
  check("…and the test, in words", /1 of 2 people besides you cooked in 4 or more of the last 6 weeks\. The test: 5 people outside your household\./.test(txt));
  check("…back says ‹ Admin", (await page.textContent("#aBack")).trim() === "‹ Admin");

  // --- Backups: the snapshot folders
  const health = async () => (await get("/api/admin/summary")).health.backups;
  let h = await health();
  check("no snapshot folders (not ZFS): Backups 'Not monitored', never green", h.status === "unknown" && h.text === "Not monitored", JSON.stringify(h));
  const snaps = (dir, names) => { const p = path.join(dir, ".zfs", "snapshot"); rmSync(p, { recursive: true, force: true }); mkdirSync(p, { recursive: true }); for (const n of names) mkdirSync(path.join(p, n)); };
  const name = (n) => `auto-${ymd(daysAgo(n))}_00-00`;
  const fresh = [name(2), name(1), `auto-${ymd(new Date())}_00-00`];
  snaps(s.data, fresh); snaps(path.join(s.data, "photos"), fresh);
  h = await health();
  check("daily snapshots of both datasets: Backups green, 'Snapshots daily', both listed with how many are kept", h.status === "ok" && h.text === "Snapshots daily" && /Database today, .* \(3 kept\) · Photos today, .* \(3 kept\)/.test(h.detail) && /off-site copy isn't checked/.test(h.detail), JSON.stringify(h));
  snaps(path.join(s.data, "photos"), [name(3), name(2)]);
  h = await health();
  let sum = await get("/api/admin/summary");
  check("photos' newest snapshot 2 days old: a problem, said under Needs attention", h.status === "problem" && h.text === "No recent snapshot" && /Photos 2 days ago/.test(h.detail) && sum.attention.some((a) => /^Backups: no recent snapshot/.test(a)), JSON.stringify([h, sum.attention]));
  snaps(path.join(s.data, "photos"), []);
  h = await health();
  check("no photo snapshots at all: 'No snapshots found'", h.status === "problem" && h.text === "No snapshots found" && /Photos none found \(0 kept\)/.test(h.detail), JSON.stringify(h));
  const late = new Date(Date.now() - 30 * 3600e3), lateName = `auto-${ymd(late)}_${String(late.getHours()).padStart(2, "0")}-${String(late.getMinutes()).padStart(2, "0")}`;
  snaps(path.join(s.data, "photos"), [lateName]);
  h = await health();
  check("a snapshot 30 hours old: a warning, 'Snapshot overdue'", h.status === "warn" && h.text === "Snapshot overdue", JSON.stringify(h));
  snaps(path.join(s.data, "photos"), [...fresh, "manual-before-upgrade"]);
  h = await health();
  check("a snapshot with another kind of name is left out, not misread", h.status === "ok" && /Photos today, .* \(3 kept\)/.test(h.detail), JSON.stringify(h));
  await page.evaluate(() => { state.admin = null; state.adminScreen = "home"; renderAdmin(); }); await page.waitForSelector(".adm-h");
  check("the owner's view shows it: Backups · Snapshots daily", /Backups[\s\S]*Snapshots daily/.test(await page.textContent("#view-admin")));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
