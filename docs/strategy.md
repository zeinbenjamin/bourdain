# Strategy

Written 2026-10-02, after 2.5.2. Revisit at the end of the pilot.

## Where Bourdain is

It began as Zein's own cooking app. Since 2.0 it has accounts, an admin
overview, AI cost tracking and limits, pausing and an audit log: the machinery
of a product. It still runs on the NAS, on Zein's API keys, with people invited
by hand through Cloudflare Access. That is right for a pilot and wrong for
anything much bigger, so the plan is: **stay a small-circle app through the
pilot, then decide deliberately** whether it becomes a product.

## What makes it different

Recipe apps are crowded (Paprika, Mela, Crouton, Samsung Food). Three things
here are not:

1. **Importing from where recipes are found now**: Instagram, TikTok and
   YouTube links, screenshots, screen recordings, and a photo of a dish.
2. **Cooking with friends in view**: their cooks in the Archives, their books,
   Add to my recipes. It works because the group is small and trusted.
3. **What cooking at home saved**, against eating out.

New work should strengthen one of these, or the core loop: **import → plan →
cook → look back**. Anything else waits.

## The pilot

**Who.** 8–12 active people across 4–6 households, not counting Zein's own.
Most should be people who cook at least twice a week, and at least a few
should not be close family, so their use isn't politeness.

Why that size:

- The social features need density. With fewer than about 5 named people,
  the People row and Everyone view feel empty and can't be judged.
- Patterns need more than a handful. With 3 people, one keen cook decides
  every conclusion.
- It stays supportable by one person: Zein invites, answers questions and
  fixes things by hand.
- AI cost stays small: roughly US$10–50 a month at the current limits.
- It stays well inside what Cloudflare Access handles for free.

Invite in two waves (about 5, then the rest two or three weeks later) so the
first wave's problems are fixed before the second arrives.

**How long.** 6–8 weeks after the second wave joins. Cooking habits are
weekly, so anything shorter mostly measures novelty.

**What to watch** (the activity log and the admin overview have all of it):

- Who cooks from it in a given week (a finished cook in the Archives).
- Which import routes are used, and which fail.
- Whether Plan and Pantry are opened at all.
- AI cost per active person per month.
- What people ask for unprompted, kept in `docs/backlog.md`.

## Until the gate

1. **Reliability before features.** It's other people's data now. Scheduled
   ZFS snapshots of both datasets, an off-site copy, and one test restore.
   The admin overview says backups are "Not monitored"; fix the backups, not
   the label.
2. **Fewer, bigger releases.** About one a week, so people get a stable app
   to form habits on.
3. **Polish the loop.** Import reliability (social platforms change often),
   cook mode, how the savings read. Hide what nobody uses, as the shopping
   list was.
4. **Pantry amounts that go down when you cook** stays pinned. It needs a data
   migration, and is only worth it if the pilot shows the pantry is used.

## The gate: end of the pilot

- [ ] At least 5 people outside Zein's household finished a cook in 4 of the
      last 6 weeks.
- [ ] Some of them asked to invite someone, unprompted.
- [ ] Imports work often enough that nobody has stopped using them.
- [ ] AI cost per active person is known, from the admin overview.
- [ ] Nothing was lost, and a restore has been tested.

**Mostly no:** a good outcome. Bourdain stays a personal and family app. Stop
adding features, keep it reliable, and the current setup runs for years.

**Mostly yes:** going public is a different project. Roughly in order:

1. **Hosting** off the NAS, with real backups and uptime. A home connection
   and one box aren't a promise to strangers.
2. **Accounts**: self-service sign-up and account deletion, instead of
   Cloudflare Access invites.
3. **Paying for AI**: a subscription, a free tier with tighter limits, or
   people's own keys. Decide before growth, not after.
4. **Privacy policy, terms, and moderation** once strangers can see each
   other's recipes.
5. **An App Store shell** for timer alerts on a locked phone and storage the
   phone won't clear.
6. **Splitting the one-file front end**, and moving recipe blobs to real
   columns, once more than one person works on it.

## If it goes public: what changes in the code

Written 2026-10-15, after 2.9.6. Neither is needed for the pilot; this is what
"Hosting" and "An App Store shell" above would mean for the codebase.

**An App Store app.** Wrap the existing front end with Capacitor (a native shell
around `index.html`, with plugins for native features) rather than rewrite it.

- **Sign-in.** Cloudflare Access is a browser sign-in and doesn't suit an app.
  Use our own: email codes or passkeys through a provider (Cognito, Auth0), the
  token kept in the Keychain. `verifyCfToken` already checks a signed token, so
  the server mostly changes which issuer it trusts. Offering Google sign-in
  means offering Sign in with Apple too.
- **Same-origin no longer.** The app calls the server from
  `capacitor://localhost`, so the server must allow that origin by name, and the
  `cross_site` write check must let it through without opening it to web pages.
- **Updates.** The front end is bundled into the app: changes go through App
  Store review (or a live-update service), the version sheet's "the server has
  a newer build" goes away, the service worker isn't needed, and there is a
  build step.
- **Storage.** iOS can clear a web view's localStorage; move the outbox and the
  offline copy to native SQLite.
- **What it buys.** A share extension ("Share → Bourdain" from Instagram,
  TikTok or Safari, the biggest win for importing), push notifications for timers
  on a locked phone, haptics.
- **Apple's rules.** A website in a wrapper can be refused (guideline 4.2), so
  the native features matter; in-app account deletion; a privacy label covering
  photos and AI; charging for it means in-app purchase.

**Hosting on AWS.** Start small; scale only when the numbers need it.

- **First step:** one EC2 or Lightsail server with a disk, SQLite kept,
  Litestream streaming the database to S3 in place of ZFS snapshots. Never
  SQLite on EFS (network file locking).
- **Photos and covers** to S3 behind CloudFront. `photoUrl()`/`coverUrl()` stay
  the same; the server signs or proxies the links.
- **The home-network owner goes.** `TRUSTED_NETS`/`HOME_NETS` (owner by
  address) means nothing on AWS and would be a way in: everyone signs in,
  Zein included.
- **Secrets** in Secrets Manager or Parameter Store, not the compose YAML.
  Claude could come through Bedrock (AWS permissions, no API key); OpenAI stays
  as it is.
- **Health.** `systemHealth()` reads RDS or AWS Backup instead of
  `.zfs/snapshot`; the free-space check doesn't apply to S3. `TZ` still matters
  for the daily limits.
- **More than one server, only when needed.** `aiPending`, `inImageSlot`,
  `visitedOn` and the daily sweep live in one process's memory; they move to
  Redis or the database, and the sweep to an EventBridge schedule. SQLite gives
  way to Postgres (the (owner, id) JSON documents fit JSONB), which is the
  costly part: `better-sqlite3` is synchronous, so every database call in
  `server.js` becomes async.
- **Deploys.** GitHub Actions to ECR, then App Runner or ECS, with the setup in
  CDK or Terraform, instead of ghcr and a TrueNAS redeploy.
