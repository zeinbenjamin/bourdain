# Bourdain

A self-hosted cooking app: import recipes from links, screenshots or screen recordings, plan the week with a shopping list, and keep track of what's in the pantry.

Runs as a single container on your own server. Your recipes and photos are stored only there. Each person who signs in has their own recipes, plan and pantry, and can browse and copy everyone else's.

---

## What's in the box

| Piece | What it does |
|---|---|
| `public/index.html` | The whole front end, one file, no build step |
| `public/sw.js` | Service worker: the app opens offline, photos are cached |
| `server.js` | Express: serves the app, stores data, runs the AI jobs, fetches links |
| `/data/bourdain.db` | SQLite: everyone's recipes, plans, pantries and shopping lists, plus people, AI usage and the owner's activity log |
| `/data/photos` | Recipe photos (JPEG) and cover illustrations (WebP) |
| `tests/` | End-to-end tests, run with `npm test` |
| `tools/preview/` | Builds the front end on demo data, to try a change before it's built properly |
| `docs/` | The plan for more than one person, the backlog, the strategy and the cost figures |

**Outbound traffic, all of it:**

- `api.anthropic.com` whenever Claude reads something: an import (a recipe's text, screenshots or a recording's frames), a fridge scan, a dish guess from a photo, recipe ideas and "Cook from what I have", the description of a cover, and the cost and nutrition estimate each recipe gets in the background.
- `api.openai.com` only when you tap **Make cover**: a short description of the dish goes there to be painted.
- The recipe site itself when you fetch a link. For TikTok, its caption service. For YouTube, the video's title and description. For Instagram, the post's public preview and caption.
- `<your-team>.cloudflareaccess.com`, for the keys that check sign-ins, once Cloudflare sign-in is set up.
- In your browser: Google Fonts for the two typefaces, and Cloudflare Web Analytics if it's switched on for your domain (Cloudflare adds it on the way through).

Nothing else phones home. Photos you upload are only ever sent to Claude, during an import, a fridge scan or a dish guess.

---

## Deploying on TrueNAS SCALE

TrueNAS can't build an image from source, so GitHub Actions builds it and TrueNAS pulls the result.

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Bourdain"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/bourdain.git
git push -u origin main
```

The workflow in `.github/workflows/publish.yml` runs on push and publishes to `ghcr.io/YOUR-USERNAME/bourdain:latest`. No secrets to configure: it uses the token GitHub provides. Its actions are pinned to exact commits, and Dependabot (`.github/dependabot.yml`) proposes updates to them once a week as pull requests.

### 2. Make the package pullable

By default GHCR packages are private. On GitHub go to your profile → **Packages** → **bourdain** → **Package settings**. Either set visibility to **Public**, or keep it private and log TrueNAS in:

```bash
# SSH into TrueNAS, using a GitHub token with read:packages
docker login ghcr.io -u YOUR-USERNAME
```

### 3. Create the datasets

In the TrueNAS UI, **Datasets → Add Dataset**:

```
YOUR-POOL/apps/bourdain/data
YOUR-POOL/apps/bourdain/photos
```

Keeping them as datasets rather than plain folders means snapshots and replication work on your recipes. Set up a daily snapshot task for both: the owner's view reads the snapshot names and shows whether backups are up to date.

### 4. Install the app

**Apps → Discover → ⋮ (top right) → Install via YAML**, then paste `docker-compose.yml` from this repo with these edits:

- `YOUR-POOL` → your pool name (and the dataset paths, if yours are laid out differently)
- `you@example.com` → your own email (`OWNER_EMAIL`). The app won't start without it.
- `sk-ant-REPLACE-ME` → your key from [console.anthropic.com](https://console.anthropic.com)
- `sk-REPLACE-ME` → your OpenAI key, only if you want covers
- `Australia/Sydney` → your time zone (`TZ`), so daily AI limits reset at your midnight

Keep `TZ` and the other variables inside `environment:`. Placed beside `image:`, TrueNAS refuses the whole YAML (see Troubleshooting).

Name the app `bourdain` (lowercase, no spaces) and install. It'll be on `http://YOUR-NAS-IP:8080`.

The YAML runs the container as `568:568`, on the host's network, and locked down: a read-only root filesystem, `/tmp` in memory, no privilege escalation and no Linux capabilities. The app only writes to the two datasets.

### 5. Updating later

Push to `main`, wait for the Action to finish, then in TrueNAS: **Apps → bourdain → ⋮ → Redeploy**. It re-pulls `latest`. Your data is on the mounted datasets and isn't touched. Tap the **Bourdain** title in the app to see which version you're running and whether a newer one is on the server.

---

## HTTPS and signing in

On plain `http://` the browser blocks **Add to Home Screen** and **camera access**, so photos and the installed-app feel won't work. You need a certificate. There are two routes, and neither needs a port opened on your router.

**Cloudflare Tunnel with Cloudflare Access** (how Bourdain is meant to run for more than one person): your own domain, reachable from anywhere, and Cloudflare asks each person to sign in before anything reaches the NAS. Set `CF_ACCESS_TEAM` and `CF_ACCESS_AUD` in the YAML once the Access application exists. Then `TRUSTED_NETS` (for example `192.168.1.0/24`) lists the networks where you're let in as the owner without signing in, when you open the NAS address directly. The steps, in order, are in `docs/multi-user.md` under "Setup Zein does". Turn on HSTS in Cloudflare (SSL/TLS → Edge Certificates) once everything is on HTTPS.

**Sharing the link.** A chat app making a link preview can't sign in, so for the main address it shows Cloudflare. Share `https://<your-domain>/welcome` instead: a public page with Bourdain's picture and an **Open Bourdain** button. In Cloudflare, add a second self-hosted Access application for the same hostname with path `welcome` and one **Bypass / Everyone** policy, and no private hostnames (each destination belongs to one application). To brand Cloudflare's sign-in page, Zero Trust → Settings → Custom Pages → Login page; the logo is at `https://<your-domain>/welcome/logo.png`.

**Tailscale** (just you, on your own devices):

1. Install the Tailscale app from the TrueNAS catalogue and sign in.
2. In the [Tailscale admin console](https://login.tailscale.com/admin/dns), enable **MagicDNS** and then **HTTPS Certificates**.
3. Put Tailscale in front of the app:
   ```bash
   tailscale serve --bg --https 443 http://127.0.0.1:8080
   ```
4. Install Tailscale on your phone and visit `https://your-nas.your-tailnet.ts.net`.

Without Cloudflare sign-in set up, everyone who reaches Bourdain is the owner, but only from this machine, a home network's private addresses or Tailscale. Anything else is refused.

**Don't port-forward 8080 to the internet.** The way in from outside is through Cloudflare, which signs people in first.

---

## Running it locally first

```bash
npm install
DATA_DIR=./data OWNER_EMAIL=you@example.com ANTHROPIC_API_KEY=sk-ant-... npm start
# http://localhost:8080
# add OPENAI_API_KEY=sk-... to the same line for covers
```

`localhost` counts as a secure context, so everything works there without a certificate.

---

## How importing works

Tap **+** and choose **Import a recipe**. Paste a link (or tap **Paste**), add screenshots or a screen recording, or paste the recipe's text. In order of how reliable they are:

1. **A recipe website link.** The server looks for schema.org `Recipe` data embedded in the page; most recipe sites publish it. That gives the exact title, times, ingredient lines and method, which then go to the model only to be structured into quantities and units.
2. **A TikTok, Instagram or YouTube link.** The server reads the caption (TikTok's caption service, Instagram's public preview of the post) or the video's description (YouTube). This works when the recipe is written there.
3. **Screenshots.** Sent to the model as images. Photos in a format Claude can't read, such as an iPhone's HEIC, are turned into JPEG first.
4. **A screen recording.** The browser samples frames, drops near-identical ones, and tiles the rest into contact sheets before sending. Turn captions on before recording: the model reads on-screen text, it can't hear audio.

When a recipe is only said or shown in a video, use screenshots or a screen recording.

**Guess from a photo** (also under **+**) takes up to three photos of a plated dish: Claude names it, says how sure it is, and writes a likely recipe.

Every import and guess lands on a review screen before it's saved, because the model will occasionally misread a quantity.

---

## Recipe covers

Tap **Make cover** on a recipe to get an illustrated cover. Claude describes the finished dish, then OpenAI's image model paints it on a transparent background. This needs an OpenAI API key: set `OPENAI_API_KEY` in the app YAML and redeploy. `IMAGE_MODEL` (default `gpt-image-2`) and `IMAGE_QUALITY` (`low`, `medium` or `high`, default `medium`) are optional. Each cover is billed to your OpenAI account; check its pricing page for current rates.

---

## AI limits and cost

Every AI job is billed to your own Anthropic key (covers to your OpenAI key). Besides imports, scans, guesses and ideas, each recipe gets a cost and nutrition estimate in the background, once, and again only when its ingredients or servings change.

Each person gets a daily allowance of imports, fridge scans, recipe ideas and covers, and an estimated monthly spend; the app tells them when they're past half of it. The owner isn't held to the limits by default.

**The owner's view** shows the estimated spend by person and by feature, alongside the limits, people, activity, errors and system health. Tap the **Bourdain** title, then press and hold the heading of that sheet. The estimates come from token counts. Your real bills are in the Anthropic and OpenAI consoles.

---

## Security

- **Signing in:** Cloudflare Access names each person; the server checks Cloudflare's signature on every request and never trusts a plain header. Without it, only home networks get in.
- **Everyone's data is their own:** anyone signed in can read and copy other people's recipes, but can only change their own. Pausing someone in the owner's view shuts them out.
- **What the page may run:** no other site may show Bourdain in a frame. A content policy lists exactly which scripts may run. For now it reports anything else to Errors in the owner's view rather than blocking it.
- **Uploads:** only JPEG, PNG and WebP photos are accepted, judged by the file itself, and never anything that would unpack to an enormous image.
- **Updates:** Dependabot alerts (GitHub → Settings → Code security) email you when a package the app uses has a known vulnerability.

---

## Tests

```bash
npm test                  # every suite, about 6 minutes
npm test -- scan          # the suites whose names start with "scan"
node tests/scan.test.mjs  # one suite
```

The tests start the real server with a throwaway database and drive the app in headless Chromium, with fake stand-ins for Claude, OpenAI and Cloudflare. They need no API keys and cost nothing. On a new machine, run `npx playwright install chromium` once first.

---

## Troubleshooting

**The header says "Offline"**: the app couldn't reach the server. It keeps working from the phone's own copy, and changes wait on the phone ("N changes not synced") until the server answers again. Check the container is running.

**A red "Signed out. Tap to sign in again" bar**: the Cloudflare sign-in expired. Tap it. Nothing waiting on the phone is lost. If the bar shows an address instead, you opened the NAS address from a network that isn't in `TRUSTED_NETS`; add it, or use the Cloudflare address.

**TrueNAS says "Failed 'down' action for 'bourdain' app"**: the YAML didn't pass TrueNAS's check. The reason is in the shell: `sudo tail -n 40 /var/log/app_lifecycle.log`. "Additional property TZ is not allowed" means `TZ` (or another variable) is beside `image:` instead of inside `environment:`.

**Changes made offline on one address don't show on the other.** The HTTPS address and `http://YOUR-NAS-IP:8080` are separate apps to your phone. Each has its own offline copy and its own queue of unsynced changes and photos, and that queue only sends when you next open *that* address. Only the HTTPS one can open without a connection. Use the HTTPS address for your home-screen icon and everyday use.

**The app won't start and the log says "OWNER_EMAIL is not set"**: since 2.0.0 the app needs `OWNER_EMAIL` (your email) in the YAML. Add it and redeploy. Nothing was changed while it refused to start.

**"Couldn't set up the database, so nothing was changed"**: the 2.0 migration failed and rolled itself back; your data is exactly as it was. The log line says why.

**"No Anthropic API key is set on the server"**: `ANTHROPIC_API_KEY` is missing or wrong in the YAML. Edit the app YAML and redeploy.

**Photos won't upload on a phone**: almost always the HTTPS problem above.

**Container restarts in a loop**: check the YAML has `user: "568:568"`, the dataset paths exist, and the `apps` user can write to them: `ls -la /mnt/YOUR-POOL/apps/bourdain/`. A "read-only file system" error in the log means something tried to write outside the datasets, which the locked-down container doesn't allow.

**Redeploy didn't pick up the new version**: the YAML needs `pull_policy: always`, otherwise Redeploy restarts the image already on the NAS. Check which commit is running with `sudo docker inspect bourdain --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`.
