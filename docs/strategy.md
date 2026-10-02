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
