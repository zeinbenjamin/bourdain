// Runs every tests/*.test.mjs in turn (each starts its own server on its own port)
// and exits non-zero if any fail. Run one on its own with: node tests/<name>.test.mjs
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs") && (!only.length || only.some((o) => f.startsWith(o)))).sort();
const failed = [];
const t0 = Date.now();
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit", timeout: 300_000 });
  if (r.status !== 0) failed.push(f);
}
console.log(`\n${files.length - failed.length}/${files.length} suites passed in ${Math.round((Date.now() - t0) / 1000)}s${failed.length ? "  — failed: " + failed.join(", ") : ""}`);
process.exit(failed.length ? 1 : 0);
