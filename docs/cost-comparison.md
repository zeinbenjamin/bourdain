# Home cost vs eating out (planned, not built)

The Archives will say roughly what each cook cost to make, against what the same
food would have cost eating out. Nobody types prices in: both sides are
estimated once per recipe. All users are assumed to be in Australia, so
everything is in AUD.

## Decided (2026-10-02)

| Question | Decision |
| --- | --- |
| What eating out is compared against | **The average of a casual and a mid-range price.** Casual means a casual eatery or takeaway counter; mid-range means a sit-down restaurant. Both are estimated, and the comparison uses their mean. |
| Leftovers and big batches | **Count fully.** Saved per cook = (eating-out price − home cost) per serve × the servings made (the recipe's servings × the batch). A 2× batch of a 6-serve recipe counts 12 servings. |

## Still open

These have suggested defaults but haven't been decided:

| Question | Suggested default |
| --- | --- |
| Delivery prices (Uber Eats runs ~25–35% higher) | Leave out; compare against eating in or picking up. |
| Weekend and card surcharges | Leave out. |
| City | Sydney/Melbourne prices for everyone (regional runs ~10–15% lower). |
| Showing casual and mid-range separately as well as the average | Average only, with both in the recipe's detail. |

## Approach

- **A new AI job, `cost`**, run once per recipe: when it's saved, and again only
  when its ingredients change, never per cook. One short text call, about
  US$0.01. It goes through `runAi` like the others, so it is metered, logged and
  limited. Which daily limit it counts against is still to decide.
- **Home cost per serve** comes from the recipe's own ingredients and quantities,
  at typical Coles/Woolworths prices. Only what's used is counted (two
  tablespoons of soy sauce costs cents, not a bottle), including things already
  in the pantry. A small table of common staples in `server.js` (chicken thigh,
  rice, eggs, olive oil…) keeps the same ingredient at the same price across
  recipes, and Claude prices the rest.
- **Eating-out price per serve** is estimated for a comparable dish, casual and
  mid-range, at the right course: starters and snacks (ceviche, crudo, devilled
  eggs) are priced against entrée or snack plates, not mains.
- **Stored on the recipe** (adding a field is safe, no migration):
  `cost: {home_per_serve, casual_per_serve, mid_per_serve, out_per_serve, course, currency: "AUD", ingredients_hash, at}`,
  where `out_per_serve` is the average. `ingredients_hash` says when it needs
  re-estimating. A copy made with Add to my recipes keeps the estimate until its
  ingredients change.
- **Shown** as estimates ("about"), never exact: per cook in the Archives
  ("8 servings · about $56 to make, about $224 eating out"), and a running total
  in the Archives stats. Live supermarket prices aren't used: Coles and
  Woolworths have no public API, and scraping them breaks their terms.

## Example figures

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
