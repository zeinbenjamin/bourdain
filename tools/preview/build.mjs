// Builds the Bourdain preview: the real public/index.html with mock.js standing in for
// server.js, as a page for a Claude artifact (see README.md here).
//   node tools/preview/build.mjs <out dir> [<repo or worktree>] [--as 2.8.0] [--note "…"]…
// --as names the version the preview is heading for (else package.json's); each --note is
// a line of a "<version> (preview)" entry at the top of the version sheet's history.
// The out dir gets index.html, img/ (the demo covers) and avatars/; publish index.html
// with the rest as its files. Fails loudly if index.html has changed in a way it relies on.
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), pos = [], notes = []; let as = null;
for (let i = 0; i < args.length; i++) { if (args[i] === "--as") as = args[++i]; else if (args[i] === "--note") notes.push(args[++i]); else pos.push(args[i]); }
const OUT = path.resolve(pos[0] || "preview-out"), REPO = path.resolve(pos[1] || path.join(HERE, "../.."));
rmSync(OUT, { recursive: true, force: true }); mkdirSync(path.join(OUT, "img"), { recursive: true }); mkdirSync(path.join(OUT, "avatars"), { recursive: true });

const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
const git = (...a) => { try { return execFileSync("git", ["-C", REPO, ...a], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
const commit = (git("rev-parse", "--short", "HEAD") || "local") + (git("status", "--porcelain", "public/index.html") ? "+edits" : "");
const changelog = [];
for (const line of readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8").split("\n")) { // the same parse as server.js
  const h = line.match(/^##\s+(\S+)\s+[—-]+\s+(\d{4}-\d{2}-\d{2})/); if (h) { changelog.push({ version: h[1], date: h[2], notes: [] }); continue; }
  const b = line.match(/^-\s+(.+)/); if (b && changelog.length) changelog.at(-1).notes.push(b[1].trim());
}
const version = (as || pkg.version) + " preview";
if (notes.length) changelog.unshift({ version, date: new Date().toISOString().slice(0, 10), notes });
const VERSION = { version, commit, dataVersion: 2, changelog };

// Demo covers get fixed 32-hex ids, so photoUrl()/coverUrl() accept them as they would real ones.
const covers = {};
for (const f of readdirSync(path.join(HERE, "covers")).filter((f) => f.endsWith(".webp"))) {
  const name = f.replace(/\.webp$/, ""), id = createHash("md5").update("preview-" + name).digest("hex");
  covers[name] = id; copyFileSync(path.join(HERE, "covers", f), path.join(OUT, "img", id + ".webp"));
}
for (const f of readdirSync(path.join(REPO, "public/avatars"))) copyFileSync(path.join(REPO, "public/avatars", f), path.join(OUT, "avatars", f));

let html = readFileSync(path.join(REPO, "public/index.html"), "utf8");
const must = (re, to) => { if (!re.test(html)) throw new Error("preview build: index.html no longer has " + re + "; update tools/preview/build.mjs"); html = html.replace(re, to); };
must(/content="__APP_VERSION__"/, `content="${VERSION.version}"`);
must(/content="__APP_COMMIT__"/, `content="${commit}"`);
must(/<link rel="manifest"[^>]*>\n?/, "");
must(/navigator\.serviceWorker\?\.register\?\.\("\/sw\.js"\)[^;]*;/, "/* no service worker in the preview */");
must(/"\/api\/photos\/"\+id/, "PREVIEW.img(id)");
must(/"\/api\/covers\/"\+id/, "PREVIEW.img(id)");
html = html.replaceAll('src="/avatars/', 'src="avatars/');
// The artifact wraps the page in its own document: keep what's inside <head> and <body>.
const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"))
  .replace(/<meta charset[^>]*>\n?/, "").replace(/<meta name="viewport"[^>]*>\n?/, "").replace(/<title>[^<]*<\/title>\n?/, "");
const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
const mock = readFileSync(path.join(HERE, "mock.js"), "utf8").replace("/*COVERS*/{}", JSON.stringify(covers)).replace("/*VERSION*/{}", JSON.stringify(VERSION));
writeFileSync(path.join(OUT, "index.html"), `<title>Bourdain preview</title>\n<script>\n${mock}\n</script>\n${head}\n${body}`);
const files = [...readdirSync(path.join(OUT, "img")).map((f) => "img/" + f), ...readdirSync(path.join(OUT, "avatars")).map((f) => "avatars/" + f)];
writeFileSync(path.join(OUT, "files.json"), JSON.stringify(files.map((p) => ({ path: p }))));
console.log(`built Bourdain ${VERSION.version} (${commit}) in ${OUT}: index.html + ${files.length} files (list in files.json)`);
