# Home cost vs eating out (built in 2.5.0)

The Archives will say roughly what each cook cost to make, against what the same
food would have cost eating out. Nobody types prices in: both sides are
estimated once per recipe. All users are assumed to be in Australia, so
everything is in AUD.

## Decided (2026-10-02)

| Question | Decision |
| --- | --- |
| What eating out is compared against | **A casual price** (a casual eatery or takeaway counter). Changed in 2.5.2 from the average of casual and mid-range; mid-range is no longer estimated or shown. |
| Leftovers and big batches | **Count fully.** Saved per cook = (eating-out price − home cost) per serve × the servings made (the recipe's servings × the batch). A 2× batch of a 6-serve recipe counts 12 servings. |

## Defaults applied (2026-10-02)

Zein accepted the suggested defaults:

| Question | Applied |
| --- | --- |
| Delivery prices (Uber Eats runs ~25–35% higher) | Leave out; compare against eating in or picking up. |
| Weekend and card surcharges | Leave out. |
| City | Sydney/Melbourne prices for everyone (regional runs ~10–15% lower). |

## Approach

- **A new AI job, `cost`**, run once per recipe: when it's saved, and again only
  when its ingredients change, never per cook. One short text call, about
  US$0.01. It goes through `runAi` like the others, so it is metered and limited, under
  its own daily limit `cost` (40). It isn't in the activity log, and doesn't
  wait for another AI job to finish: the phone runs it in the background.
- **Home cost per serve** comes from the recipe's own ingredients and quantities,
  at typical Coles/Woolworths prices. Only what's used is counted (two
  tablespoons of soy sauce costs cents, not a bottle), including things already
  in the pantry. A small table of common staples in `server.js` (chicken thigh,
  rice, eggs, olive oil…) keeps the same ingredient at the same price across
  recipes, and Claude prices the rest.
- **Eating-out price per serve** is estimated for a comparable dish at a
  casual place, at the right course: starters and snacks (ceviche, crudo, devilled
  eggs) are priced against entrée or snack plates, not mains.
- **Stored on the recipe** (adding a field is safe, no migration):
  `cost: {home_per_serve, casual_per_serve, out_per_serve, course, currency: "AUD", hash, at}`,
  where `out_per_serve` is the casual price. Estimates made by 2.5.0–2.5.1 also
  carry `mid_per_serve` and an averaged `out_per_serve`; the app reads their
  `casual_per_serve` instead, so they don't need estimating again. `hash` (servings and ingredients) says when it needs
  re-estimating. A copy made with Add to my recipes keeps the estimate until its
  ingredients change.
- **Shown** as estimates ("about"), never exact: per cook in the Archives
  ("8 servings · about $120 saved"), a total for the month and year in the
  Archives, and "About $7 a serve to make · about $22 eating out" on the recipe
  page. Live supermarket prices aren't used: Coles and
  Woolworths have no public API, and scraping them breaks their terms.

## Example figures

From before 2.5.2, when the comparison was the average; it now uses the Casual
column.

Estimated on 2026-10-02 from typical versions of eight of Zein's recipes (their
titles and servings, not their actual ingredient lists), at approximate
2025–26 Sydney/Melbourne prices. Illustrative only.

| Recipe (serves) | Home / serve | Casual | Mid-range | Average | Saved per cook |
| --- | ---: | ---: | ---: | ---: | ---: |
| Beef Rendang (6) | $7 | $22 | $34 | $28 | $126 |
| High Protein Honey Butter Chicken Alfredo (5) | $4 | $24 | $32 | $28 | $120 |
| Shrimp Ceviche (6) | $8 | $20 | $30 | $25 | $102 |
| Kingfish Crudo (4) | $6 | $22 | $29 | $25.50 | $78 |
| Scallion Oil Poached Chicken (4) | $4 | $18 | $30 | $24 | $80 |
| Mille Feuille Nabe (2, assumed) | $9 | $25 | $40 | $32.50 | $47 |
| Teriyaki & Soy Devilled Eggs (2) | $3 | $12 | $18 | $15 | $24 |
| Gyudon (2) | $7 | $14 | $24 | $19 | $24 |
| **All eight, once each** | | | | | **~$600** |

What these show: cheap takeaway dishes (gyudon) save the least; recipes for a
group (rendang for six) save the most; expensive ingredients (sashimi-grade
kingfish) narrow the gap but rarely close it.
