// Captures the owner's view from a real (test) server.js as tools/preview/admin.json, so
// the preview's owner's view has the server's own shapes. mock.js swaps in the demo
// people and fills in what depends on them. Re-run when the owner's view changes:
//   node tools/preview/capture-admin.mjs
import path from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "../../tests/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const s = await startServer({ port: 20951 });
try {
  await s.put("recipes", "r1", { title: "Beef Rendang", servings: 6, ingredients: [], steps: [], photos: [], tags: [], created_at: new Date().toISOString() });
  const get = async (p) => (await fetch(s.url + p)).json();
  const out = { summary: await get("/api/admin/summary"), activity: await get("/api/admin/activity?cat=nosignin&limit=50"), audit: await get("/api/admin/audit"), errors: await get("/api/admin/errors") };
  writeFileSync(path.join(HERE, "admin.json"), JSON.stringify(out, null, 1) + "\n");
  console.log("captured", Object.keys(out.summary).join(", "));
} finally { await s.cleanup(); }
