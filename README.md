# Bourdain

A self-hosted cooking app: import recipes from links, screenshots or screen recordings, plan the week, and keep track of what's in the pantry.

Runs as a single container on your own server. Your recipes never leave it.

---

## What's in the box

| Piece | What it does |
|---|---|
| `public/index.html` | The whole front end, one file, no build step |
| `server.js` | Express: serves the app, stores data, proxies Claude, fetches links |
| `/data/bourdain.db` | SQLite — recipes, plan, pantry |
| `/data/photos` | Recipe photos as JPEGs |

**The only outbound traffic** is to `api.anthropic.com` when reading a recipe, and to a recipe site when you fetch a link. Nothing else phones home.

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

The workflow in `.github/workflows/publish.yml` runs on push and publishes to `ghcr.io/YOUR-USERNAME/bourdain:latest`. No secrets to configure — it uses the token GitHub provides.

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

Keeping them as datasets rather than plain folders means snapshots and replication work on your recipes.

### 4. Install the app

**Apps → Discover → ⋮ (top right) → Install via YAML**, then paste `docker-compose.yml` from this repo with two edits:

- `YOUR-POOL` → your pool name (and the dataset paths, if yours are laid out differently)
- `sk-ant-REPLACE-ME` → your key from [console.anthropic.com](https://console.anthropic.com)

Name the app `bourdain` (lowercase, no spaces) and install. It'll be on `http://YOUR-NAS-IP:8080`.

### 5. Updating later

Push to `main`, wait for the Action to finish, then in TrueNAS: **Apps → bourdain → ⋮ → Redeploy**. It re-pulls `latest`. Your data is on the mounted datasets and isn't touched.

---

## HTTPS: do this before using it on your phone

On plain `http://` the browser blocks **Add to Home Screen** and **camera access**, so photos and the installed-app feel won't work. You need a certificate.

**Tailscale is the least painful route**, and it means the app works from anywhere without opening a port on your router:

1. Install the Tailscale app from the TrueNAS catalogue and sign in.
2. In the [Tailscale admin console](https://login.tailscale.com/admin/dns), enable **MagicDNS** and then **HTTPS Certificates**.
3. Put Tailscale in front of the app:
   ```bash
   tailscale serve --bg --https 443 http://127.0.0.1:8080
   ```
4. Install Tailscale on your phone and visit `https://your-nas.your-tailnet.ts.net`.

Now Add to Home Screen works and you get a proper app icon.

**Cloudflare Tunnel** is the alternative if you want a real domain or to let other people in. It also avoids port forwarding, but it does expose the app publicly — put authentication in front of it (Cloudflare Access is free for small numbers of users).

**Don't port-forward 8080 to the internet.** There's no login on this app; anyone who finds it can read and edit everything, and burn your API credit.

---

## Running it locally first

```bash
npm install
cp .env.example .env        # add your key
DATA_DIR=./data ANTHROPIC_API_KEY=sk-ant-... npm start
# http://localhost:8080
```

`localhost` counts as a secure context, so everything works there without a certificate.

---

## How importing works

Four routes in, in order of how reliable they are:

1. **A recipe website link.** The server looks for schema.org `Recipe` data embedded in the page — most recipe sites publish it. That gives exact title, times, ingredient lines and method, which then go to the model only to be structured into quantities and units.
2. **A TikTok link.** The server also hits TikTok's public oEmbed endpoint, which returns the caption the page itself hides.
3. **Screenshots.** Sent to the model as images.
4. **A screen recording.** The browser samples frames, drops near-identical ones, and tiles the rest into contact sheets before sending. Turn captions on before recording: the model reads on-screen text, it can't hear audio.

Instagram usually refuses both link routes. Screenshots or a recording are the way in there.

Every import lands on a review screen before it's saved, because the model will occasionally misread a quantity.

---

## Cost

About one to two cents per recipe import, billed to your own Anthropic key. Nothing else costs anything.

---

## If you ever want other people using it

Right now there's no login and no separation between users — it assumes one household on a private network. Adding multi-user support means:

- a `user_id` column on each table and filtering every query by it
- session auth (or put Cloudflare Access / Authelia in front and read the header)
- a per-user photo directory

That's real work, not a config flag. Fine to leave alone if it's just for you.

---

## Troubleshooting

**"Server unreachable — working offline"** — the app couldn't reach `/api/state`. It falls back to browser storage so you can keep cooking, but changes won't sync until the server's back. Check the container is running.

**"No Anthropic API key is set"** — `ANTHROPIC_API_KEY` is missing or wrong in the compose file. Edit the app YAML and redeploy.

**Photos won't upload on a phone** — almost always the HTTPS problem above.

**Container restarts in a loop** — check the YAML has `user: "568:568"`, the dataset paths exist, and the `apps` user can write to them: `ls -la /mnt/YOUR-POOL/apps/bourdain/`.

**Redeploy didn't pick up the new version** — the YAML needs `pull_policy: always`, otherwise Redeploy restarts the image already on the NAS. Check which commit is running with `sudo docker inspect bourdain --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`.
