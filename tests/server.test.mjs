// Server behaviour without a browser: caching, JSON errors, version stamping, every
// Claude/OpenAI failure code, the cover pipeline, placeholder keys, and the cover sweep.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import Database from "better-sqlite3";
import { suite, startServer, ROOT } from "./lib.mjs";

const { check, finish } = suite("server");
const recipe = { title: "Chicken donburi", ingredients: [{ item: "chicken thigh" }, { item: "egg" }], steps: ["Cook.", "Serve on rice."] };
let s;
try {
  s = await startServer({ port: 18101, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-test", APP_COMMIT: "abc1234def" } });
  const B = s.url;

  // --- caching: the app shell is revalidated, static assets are not
  for (const u of ["/", "/index.html", "/sw.js", "/some/deep/link"]) {
    const cc = (await fetch(B + u)).headers.get("cache-control");
    check(`${u} is served no-cache`, cc === "no-cache", cc);
  }
  check("icon keeps its 1h cache", (await fetch(B + "/icon.svg")).headers.get("cache-control") === "public, max-age=3600");

  // --- version stamping
  const html = await (await fetch(B + "/")).text();
  const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  check("index.html stamped with version and commit", html.includes(`content="${version}"`) && html.includes('content="abc1234"') && !html.includes("__APP_"));
  const v = await (await fetch(B + "/api/version")).json();
  check("/api/version: version, commit and changelog", v.version === version && v.commit === "abc1234" && v.changelog[0].version === version && v.changelog[0].notes.length > 0);

  // --- JSON errors, never HTML
  const bad = await fetch(B + "/api/recipes/x", { method: "PUT", headers: { "content-type": "application/json" }, body: "{bad" });
  check("bad JSON -> 400 bad_json", bad.status === 400 && (await bad.json()).code === "bad_json");
  const big = await fetch(B + "/api/recipes/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "a".repeat(32_000_000) }) });
  check("oversized body -> 413 too_large", big.status === 413 && (await big.json()).code === "too_large");
  const nf = await fetch(B + "/api/nope");
  check("unknown /api path -> JSON 404", nf.status === 404 && (await nf.json()).code === "not_found");
  const bc = await s.put("bogus", "x", {});
  check("unknown collection -> 404 bad_collection", bc.status === 404 && (await bc.json()).code === "bad_collection");

  // --- a corrupt row is skipped, not fatal
  await s.put("recipes", "good", { title: "Good soup" });
  const db = new Database(path.join(s.data, "bourdain.db"));
  db.prepare("INSERT INTO recipes (id, doc, updated_at) VALUES ('broken', '{not json', datetime())").run();
  db.close();
  const st = await s.state();
  check("corrupt row skipped, the rest still loads", st.recipes.good && !st.recipes.broken && /skipping corrupt row recipes\/broken/.test(s.log()));
  const db2 = new Database(path.join(s.data, "bourdain.db")); db2.prepare("DELETE FROM recipes WHERE id='broken'").run(); db2.close();

  // --- Claude failures get specific codes
  for (const [mode, code] of [["401", "bad_api_key"], ["404", "model_unavailable"], ["529", "overloaded"], ["credit", "no_credit"], ["image", "image_rejected"], ["max_tokens", "truncated"], ["refusal", "refused"]]) {
    s.setMode({ claude: mode });
    const r = await s.post("/api/claude", { prompt: "x" });
    check(`Claude ${mode} -> ${code}`, r.code === code, `${r.status} ${r.code}`);
  }
  s.setMode({}); s.clearLog();
  const ok = await s.post("/api/claude", { prompt: "x" });
  check("Claude ok -> parsed JSON", ok.json && ok.json.title === "Mock donburi");
  check("max_tokens is 16000", /MOCK_CLAUDE_REQ \{"model":"claude-sonnet-4-6","max_tokens":16000\}/.test(s.log()));

  // --- cover pipeline
  s.clearLog();
  let r = await s.post("/api/cover", { recipe });
  check("cover -> id", /^[a-f0-9]{32}$/.test(r.id || ""), JSON.stringify(r).slice(0, 120));
  const m = s.log().match(/MOCK_IMG_REQ (\S+) (\{.*\}) auth=(Bearer \S+)/) || [];
  const body = m[2] ? JSON.parse(m[2]) : {};
  check("OpenAI endpoint", m[1] === "https://api.openai.com/v1/images/generations", m[1]);
  check("OpenAI params", body.model === "gpt-image-2" && body.quality === "medium" && body.size === "1024x1024" && body.background === "transparent" && body.output_format === "png" && body.n === 1, JSON.stringify({ ...body, prompt: undefined }));
  check("OpenAI bearer auth", m[3] === "Bearer sk-");
  check("prompt = style + Claude's dish sentence", /^Make a Ghibli-inspired food icon/.test(body.prompt) && /donburi bowl\.$/.test(body.prompt));
  const img = await fetch(B + "/api/covers/" + r.id);
  const buf = Buffer.from(await img.arrayBuffer());
  const meta = await sharp(buf).metadata();
  check("cover served as immutable WebP with transparency", img.headers.get("content-type") === "image/webp" && /immutable/.test(img.headers.get("cache-control")) && meta.hasAlpha);
  const corner = await sharp(buf).extract({ left: 0, top: 0, width: 2, height: 2 }).raw().toBuffer();
  check("cover corner is fully transparent", corner[3] === 0, "alpha=" + corner[3]);

  s.clearLog(); s.setMode({ image: "no_transparent" });
  r = await s.post("/api/cover", { recipe });
  const bgs = [...s.log().matchAll(/MOCK_IMG_REQ \S+ (\{.*\}) auth/g)].map((x) => JSON.parse(x[1]).background).join(",");
  check("transparency rejected -> one opaque retry", r.id && bgs === "transparent,opaque", bgs);
  for (const [mode, code] of [["401", "bad_image_key"], ["quota", "no_image_credit"], ["moderation", "image_refused"]]) {
    s.setMode({ image: mode });
    const x = await s.post("/api/cover", { recipe });
    check(`OpenAI ${mode} -> ${code}`, x.code === code, `${x.status} ${x.code}`);
  }
  s.setMode({});
  check("cover without a title -> no_title", (await s.post("/api/cover", { recipe: {} })).code === "no_title");

  // --- the phone giving up cancels the upstream call
  s.clearLog(); s.setMode({ imageDelay: 8000 });
  const ac = new AbortController();
  const pending = fetch(B + "/api/cover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipe }), signal: ac.signal }).catch(() => {});
  await new Promise((res) => setTimeout(res, 1500)); ac.abort(); await pending; await new Promise((res) => setTimeout(res, 500));
  check("client gives up -> OpenAI call cancelled", /MOCK: upstream aborted/.test(s.log()) && /cover cancelled/.test(s.log()));
  s.setMode({});

  // --- placeholder keys count as missing
  await s.restart({ ANTHROPIC_API_KEY: "sk-ant-REPLACE-ME", OPENAI_API_KEY: "sk-REPLACE-ME" });
  check("placeholder OpenAI key -> no_image_key", (await s.post("/api/cover", { recipe })).code === "no_image_key");
  check("placeholder Anthropic key -> no_api_key", (await s.post("/api/claude", { prompt: "x" })).code === "no_api_key");
  check("health reports hasImageKey false", (await (await fetch(B + "/api/health")).json()).hasImageKey === false);
  await s.cleanup();

  // --- cover sweep: only unused covers older than 7 days go; photos are never touched
  const data = mkdtempSync(path.join(tmpdir(), "bourdain-sweep-"));
  const photos = path.join(data, "photos"); mkdirSync(photos);
  const id = (c) => c.repeat(32);
  const old = (Date.now() - 10 * 86_400_000) / 1000;
  const file = (name, age) => { const f = path.join(photos, name); writeFileSync(f, "x"); if (age === "old") utimesSync(f, old, old); return f; };
  s = await startServer({ port: 18102, dataDir: data });
  await s.put("recipes", "r1", { title: "Uses a cover", cover: id("a") });
  const used = file(id("a") + ".webp", "old"), orphan = file(id("b") + ".webp", "old"), fresh = file(id("c") + ".webp", "new"), photo = file(id("d") + ".jpg", "old");
  s.clearLog(); await s.restart(); // the sweep runs at startup
  check("sweep: cover in use is kept", existsSync(used));
  check("sweep: unused cover older than 7 days is removed", !existsSync(orphan));
  check("sweep: unused cover newer than 7 days is kept", existsSync(fresh));
  check("sweep: photos (.jpg) are never touched", existsSync(photo));
  check("sweep: logs what it did", /cover sweep: removed 1 unused cover, kept 1 newer than 7 days/.test(s.log()), s.log().split("\n").find((l) => /sweep/.test(l)));
  await s.stop();
  const orphan2 = file(id("e") + ".webp", "old");
  const db3 = new Database(path.join(data, "bourdain.db"));
  db3.prepare("INSERT INTO recipes (id, doc, updated_at) VALUES ('broken', '{oops', datetime())").run(); db3.close();
  s.clearLog(); await s.restart();
  check("sweep: skipped entirely if a recipe can't be read", existsSync(orphan2) && /cover sweep skipped: recipe broken/.test(s.log()));
  await s.cleanup();
  const empty = mkdtempSync(path.join(tmpdir(), "bourdain-sweep-"));
  mkdirSync(path.join(empty, "photos"));
  const lone = path.join(empty, "photos", id("f") + ".webp"); writeFileSync(lone, "x"); utimesSync(lone, old, old);
  s = await startServer({ port: 18103, dataDir: empty });
  check("sweep: skipped entirely if there are no recipes", existsSync(lone) && /cover sweep skipped: no recipes/.test(s.log()));
  finish();
} catch (e) { finish(e); } finally { await s?.cleanup?.(); }
