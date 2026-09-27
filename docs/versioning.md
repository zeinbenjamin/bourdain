# Versioning kit (from Bourdain)

A small, self-contained way to give a self-hosted web app:

- **one version number** you bump on every release,
- **a changelog written for the person using the app**, shown inside the app,
- **the exact build (git commit)** a device is running, and
- **"your phone is behind the server"** detection, so you never have to SSH in to
  check whether a deploy landed.

Everything below is lifted from Bourdain (Node + Express, plain-JS single-page
front end, Docker image built by GitHub Actions, run on TrueNAS). The ideas are
stack-neutral; the code is the real, working version. Adapt names and paths.

---

## 1. The rules

**Version format:** `MAJOR.MINOR.PATCH` (semver), always three numbers: `1.13.0`,
never `1.13`. Pre-releases, if you ever need them, get a suffix: `1.14.0-alpha`.

**Every change that ships to the app gets a new version. Docs-only changes don't.**

| Bump | When | Example |
|---|---|---|
| **Patch** `1.3.0 → 1.3.1` | Fixes only, no new behaviour | a crash fix, a clearer error message |
| **Minor** `1.3.0 → 1.4.0` | New features or changed behaviour | a new button, offline support |
| **Major** `1.x → 2.0.0` | A change to **stored data** that old data doesn't fit, so it needs a migration | pantry items gain required amounts; adding user accounts |

The major rule is deliberately about **data, not size**. A big redesign or a new
screen that only *adds* fields stays 1.x, because old data still works as it is.
If you want "2.0" as a milestone for a redesign instead, change this rule on
purpose and write the new rule down.

**Changelog entries are written for the user, not a developer:** what's different
when using the app. "Tapping Save twice no longer saves the recipe twice", not
"added re-entrancy guard to save()".

---

## 2. How the pieces fit

```
package.json "version"  ─┐
CHANGELOG.md             ├─► server reads both at startup
APP_COMMIT (build arg)  ─┘        │
                                  ├─► stamps version + commit into index.html <meta> tags
                                  ├─► GET /api/version  → { version, commit, changelog[] }
                                  └─► logs "App 1.6.1 (a208106)" on startup

phone loads index.html → knows the version it is RUNNING (from its own meta tags)
phone calls /api/version → knows the version the server HAS
different? → "Version X is ready. Close and reopen the app to update."
```

The trick that makes it work: **the front end's version is baked into the HTML
it was served**, so a phone running a cached old copy reports the old version,
and comparing it with the live server tells you the phone is behind.

---

## 3. The single source of truth: `package.json`

```json
{ "name": "myapp", "version": "1.0.0" }
```

Bump it with npm, which updates `package-lock.json` at the same time:

```bash
npm version 1.4.0 --no-git-tag-version
```

`--no-git-tag-version` stops npm from committing and tagging for you, so the
bump goes into your normal release commit. If you build with `npm ci` (you
should), a `package.json` edited by hand without the lockfile makes the build fail.

---

## 4. `CHANGELOG.md`: a strict format the server parses

```markdown
# Changelog

What changed in each version, newest first. The app shows this list
when you tap the title.

Format: each version is a `## <version> — <YYYY-MM-DD>` heading followed by
`- ` bullet lines. The app parses exactly that, so keep to it.

## 1.4.0 — 2026-09-24
- New: tap Make cover on a recipe to get an illustrated cover.
- Messages stay on screen long enough to read.

## 1.3.1 — 2026-09-24
- Fixed a crash in the Plan picker when a recipe had no title.
```

Rules: newest at the top; the heading is `## ` + version + space + an em dash
(or hyphens) + space + ISO date; the notes are `- ` bullets, one line each.
Anything else in the file (the intro) is ignored.

Backfill honestly when you adopt this: start at `1.0.0` for "the app as it was",
then one entry per release you've already shipped.

---

## 5. Build: pass the commit into the image

**GitHub Actions** (`docker/build-push-action`), add one build arg:

```yaml
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            APP_COMMIT=${{ github.sha }}
```

(`docker/metadata-action`'s labels also stamp `org.opencontainers.image.revision`
into the image, which gives you the server-side check in section 9 for free.)

**Dockerfile**: copy the version files into the final image, and turn the build
arg into an environment variable. Put the `ARG` **late**, because it changes on
every commit and anything after it can't be cached:

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json CHANGELOG.md server.js ./
COPY public ./public
# The commit this image was built from, shown in the app's version sheet.
ARG APP_COMMIT=dev
ENV APP_COMMIT=$APP_COMMIT
CMD ["node", "server.js"]
```

Local runs have no `APP_COMMIT`, so they report `dev`, which is handled below.

---

## 6. Server (Node/Express)

```js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* package.json holds the version; the build passes the commit in as APP_COMMIT.
   CHANGELOG.md is parsed once at startup for the in-app version history. */
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

// The served index.html carries its own version, so a device can tell which build it's running.
const INDEX_HTML = readFileSync(path.join(__dirname, "public", "index.html"), "utf8")
  .replace('content="__APP_VERSION__"', `content="${VERSION}"`)
  .replace('content="__APP_COMMIT__"', `content="${COMMIT}"`);

app.get("/api/health", (_req, res) => res.json({ ok: true, version: VERSION, commit: COMMIT }));
app.get("/api/version", (_req, res) => res.json({ version: VERSION, commit: COMMIT, changelog: CHANGELOG }));

/* The app shell must be revalidated on every load, or a phone keeps the old app
   after a redeploy. no-cache still allows a cheap 304 via the ETag. */
const revalidate = (res) => res.set("Cache-Control", "no-cache");
const sendIndex = (_req, res) => { revalidate(res); res.type("html").send(INDEX_HTML); }; // Express adds an ETag
app.get(["/", "/index.html"], sendIndex);          // BEFORE express.static, or the unstamped file wins
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  setHeaders: (res, file) => { if (/\.html$|[\\/]sw\.js$/.test(file)) revalidate(res); },
}));
app.get(/.*/, sendIndex);                           // SPA fallback, also stamped

app.listen(PORT, () => console.log(`MyApp ${VERSION} (${COMMIT}) on :${PORT}`));
```

---

## 7. Front end

**In `<head>`**: placeholders the server fills in:

```html
<!-- Filled in by the server when it serves this file, so the app knows which build it is. -->
<meta name="app-version" content="__APP_VERSION__">
<meta name="app-commit" content="__APP_COMMIT__">
```

**A visible version** next to the title, tappable to open the history:

```html
<h1><button id="brand" aria-label="Version and update history">MyApp<span id="verLabel"></span></button></h1>
```

**The logic** (plain JS; swap the sheet/toast helpers for your own):

```js
// "__…" means the file wasn't served through sendIndex (e.g. opened raw): call it "dev".
const metaOf = n => { const v = document.querySelector(`meta[name="${n}"]`)?.content || ""; return v.startsWith("__") ? "dev" : v; };
const APP = { version: metaOf("app-version"), commit: metaOf("app-commit") };
document.getElementById("verLabel").textContent = "v" + APP.version;

// Behind if the version differs, or the same version was rebuilt from a different
// commit (you forgot to bump). "dev" builds are never compared by commit.
const isStale = info => info && (info.version !== APP.version ||
  (info.commit !== "dev" && APP.commit !== "dev" && info.commit !== APP.commit));

// On startup, once online: nudge the user if this device is behind.
async function checkForUpdate() {
  try {
    const info = await fetch("/api/version", { signal: AbortSignal.timeout(10000) }).then(r => r.json());
    if (isStale(info)) toast(`Version ${info.version} is ready. Close and reopen the app to update.`);
  } catch { /* offline: nothing to compare against */ }
}

// Tapping the title: version, build, up-to-date check, and the full history.
async function openVersion() {
  // Show: `${APP.version}`, `Build ${APP.commit}`, then fetch /api/version and render
  //   - isStale(info) ? "The server has X (build Y), but this device is still running Z.
  //                      Close the app fully and reopen it to update."
  //                   : "Up to date with the server."
  //   - info.changelog as a list, newest first, marking r.version === APP.version as "this device".
  //   - offline: "Couldn't reach the server, so I can't check for a newer version."
  // Escape every changelog string before inserting it as HTML.
}
document.getElementById("brand").onclick = openVersion;
```

(Bourdain's full `openVersion` renders into its bottom-sheet component; the
comments above are the whole behaviour.)

---

## 8. If the app has a service worker

A service worker is where "I deployed but my phone still shows the old app"
comes from. Three rules:

1. **Name the cache with a version and bump it on every front-end change**
   (`const CACHE = "myapp-v9"` → `"myapp-v10"`). The byte change makes the phone
   install the new worker, and its `activate` step deletes the old caches.
2. **Serve `index.html` and `sw.js` with `Cache-Control: no-cache`** (section 6).
   A long `maxAge` on either one means the phone keeps the old app for that long,
   even after a cache bump.
3. **Network-first for the app shell**, with a short fallback to the cache (Bourdain
   uses 3s) so slow Wi-Fi doesn't give a white screen. Accept that on a slow
   connection a new deploy can take one extra open to appear; the version toast
   covers that.

---

## 9. Checking a deploy without the app

If the app won't even load, the image itself knows its commit:

```bash
sudo docker inspect <container> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

---

## 10. Gotchas we actually hit

- **Redeploy didn't pull the new image.** Docker only pulls when the image is
  missing locally. In the compose/TrueNAS YAML set `pull_policy: always`, or the
  "new" deploy silently restarts the old image.
- **The phone kept the old app for up to an hour.** `express.static` had
  `maxAge: "1h"` on `index.html`. Fixed by rule 2 in section 8.
- **Placeholders reached the phone unfilled.** Only happens if `index.html` is
  served as a plain static file. Register `sendIndex` for `/` and `/index.html`
  *before* `express.static`, and use it as the SPA fallback.
- **Same version, different build.** Forgetting to bump still shows up, because
  `isStale` also compares commits (except for `dev`).
- **Lockfile drift.** Always bump with `npm version`, never by hand, when the
  build uses `npm ci`.
- **Merged but not deployed.** A release only exists once it's merged to the
  branch that builds the image. The in-app version tells you immediately if a
  merge was missed.

---

## 11. Adoption checklist

- [ ] `package.json` has a `version`; bump with `npm version x.y.z --no-git-tag-version`
- [ ] `CHANGELOG.md` in the exact format, backfilled from `1.0.0`
- [ ] Build passes `APP_COMMIT`; Dockerfile copies `package.json` + `CHANGELOG.md`, sets `ENV APP_COMMIT`
- [ ] Server: `VERSION`, `COMMIT`, `readChangelog`, stamped `INDEX_HTML`, `/api/version`, `sendIndex` before static, `no-cache` on the shell
- [ ] `index.html`: the two meta placeholders, a visible `v…` label, a tap target for the history
- [ ] Client: `APP`, `isStale`, `checkForUpdate()` on startup, the version sheet
- [ ] Service worker (if any): versioned cache name, bumped on every front-end change
- [ ] Compose/YAML: `pull_policy: always`
- [ ] Tests: `/api/version` returns the `package.json` version and the top changelog entry; the served HTML has no `__APP_` left in it

---

## 12. Paste into the other repo's CLAUDE.md

```markdown
## Releases

Every change that ships to the app gets a new version. Docs-only changes don't.

1. Bump the version with `npm version <x.y.z> --no-git-tag-version`. This
   updates `package.json` and `package-lock.json` together.
   - **Patch** (1.3.0 → 1.3.1): fixes, no new behaviour.
   - **Minor** (1.3.0 → 1.4.0): new features or changed behaviour.
   - **Major** (1.x → 2.0.0): a change to stored data that needs a migration.
2. Add an entry at the top of `CHANGELOG.md`: `## x.y.z — YYYY-MM-DD` followed by
   `- ` bullets. The server parses exactly that format for the in-app history.
   Write the bullets for the user, not for a developer: what's different when
   using the app.
3. Bump the service worker cache if the front end changed.

How the version reaches the device: the server reads the version from
`package.json`, the commit from `APP_COMMIT` (set by the Actions build), and
stamps both into the `app-version` / `app-commit` meta tags as it serves
`index.html`. The app compares its own tags with `/api/version`. On startup it
toasts when the server has a newer build, and tapping the title shows the same.
Serve `index.html` only through `sendIndex`, never as a plain static file, or
the placeholders reach the device unfilled. `index.html` and `sw.js` must stay
`Cache-Control: no-cache`.
```
