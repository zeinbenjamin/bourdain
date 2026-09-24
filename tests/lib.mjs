// Shared test helpers: start the real server (optionally with fake Claude/OpenAI),
// a slow proxy in front of it, a browser, and a PASS/FAIL collector.
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PASS/FAIL collector. finish() prints and exits non-zero on any failure.
export function suite(name) {
  const results = [];
  const check = (label, ok, detail = "") => results.push({ label, ok: !!ok, detail });
  const finish = (err) => {
    if (err) results.push({ label: "test crashed: " + String(err.message || err).split("\n")[0], ok: false });
    console.log(`\n${name}`);
    for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.detail && !r.ok ? "  — " + r.detail : ""}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`  ${results.length - failed}/${results.length} passed`);
    process.exitCode = failed ? 1 : 0;
  };
  return { check, finish };
}

// Starts server.js on `port` with a fresh data dir. mock: true loads tests/mock-apis.mjs
// in place of api.anthropic.com / api.openai.com; setMode() drives its behaviour.
export async function startServer({ port, env = {}, mock = false, dataDir } = {}) {
  const data = dataDir || mkdtempSync(path.join(tmpdir(), "bourdain-test-"));
  const modeFile = path.join(data, "mock-mode.json");
  writeFileSync(modeFile, "{}");
  let log = "";
  let proc;
  const url = `http://localhost:${port}`;
  const launch = async (extraEnv = {}) => {
    proc = spawn("node", [...(mock ? ["--import", path.join(ROOT, "tests/mock-apis.mjs")] : []), "server.js"], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), DATA_DIR: data, MOCK_FILE: modeFile, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", ...env, ...extraEnv },
    });
    proc.stdout.on("data", (d) => (log += d));
    proc.stderr.on("data", (d) => (log += d));
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(url + "/api/health")).ok) return; } catch {}
      await sleep(100);
    }
    throw new Error("server did not start:\n" + log);
  };
  await launch();
  const s = {
    url, data,
    log: () => log,
    clearLog: () => { log = ""; },
    setMode: (m) => writeFileSync(modeFile, JSON.stringify(m)),
    async stop() { if (proc.exitCode === null && proc.signalCode === null) { proc.kill(); await new Promise((r) => proc.once("exit", r)); } },
    async restart(extraEnv) { await s.stop(); await launch(extraEnv); },
    async cleanup() { await s.stop(); if (!dataDir) rmSync(data, { recursive: true, force: true }); },
    state: async () => (await fetch(url + "/api/state")).json(),
    put: (col, id, doc) => fetch(`${url}/api/${col}/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) }),
    post: async (p, body) => { const r = await fetch(url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; },
  };
  return s;
}

// A proxy in front of the server whose delays can be changed mid-test, to fake slow Wi-Fi.
// It passes client disconnects through, as a real proxy does.
export function slowProxy({ port, target }) {
  const delays = { shell: 0, state: 0, write: 0 };
  const server = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    const wait = p === "/" || p === "/index.html" ? delays.shell : p === "/api/state" ? delays.state
      : (req.method === "PUT" || req.method === "DELETE") ? delays.write : 0;
    setTimeout(() => {
      const up = http.request({ port: target, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on("error", () => res.destroy());
      res.on("close", () => { if (!res.writableFinished) up.destroy(); });
      req.pipe(up);
    }, wait);
  }).listen(port);
  return { url: `http://localhost:${port}`, delays, close: () => server.close() };
}

// Phone-sized browser. Google Fonts are blocked so tests never depend on the internet.
export async function openBrowser({ fonts = "abort" } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => (fonts === "hang" ? undefined : r.abort()));
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { browser, ctx, page, errors };
}

// Opens the app and waits for the first load from the server to finish.
export async function openApp(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !store.loading);
}

export const swCacheName = async () => (await import("node:fs")).readFileSync(path.join(ROOT, "public/sw.js"), "utf8").match(/const CACHE = "([^"]+)"/)[1];
