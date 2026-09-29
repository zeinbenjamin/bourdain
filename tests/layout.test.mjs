// Spacing and tap-target checks measured in the real layout (phone width), so
// fixes like the Pantry gaps in 1.7.3 can't quietly regress.
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("layout");
let s, b;
try {
  s = await startServer({ port: 19201 });
  b = await openBrowser();
  const { page, errors } = b;
  await s.put("recipes", "a", { title: "Leek soup", description: "Silky and peppery.", rating: 2, servings: 4, prep_min: 10, cook_min: 25, tags: ["soup"], cooks: [{ date: "2026-09-20", at: "x" }],
    ingredients: [{ item: "leek", quantity: 3, unit: "whole" }], steps: ["Soften for 8 minutes."], photos: [], created_at: "2026-09-01" });
  for (const [id, item] of [["p1", "lemons"], ["p2", "rice"]]) await s.put("pantry", id, { id, item, aisle: id === "p1" ? "produce" : "pantry" });
  await openApp(page, s.url);
  const box = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; }, sel);

  check("header date shows on first open", /\w{3} \d{1,2} \w{3}/.test(await page.textContent("#topSub")), await page.textContent("#topSub"));
  const plus = await box("#btnManual");
  check("'+' next to search is a 46px circle", Math.round(plus.w) === 46 && Math.round(plus.h) === 46, JSON.stringify(plus));

  // --- pantry
  await page.click('#tabs button[data-view="pantry"]');
  const actions = await box("#view-pantry .actions"), firstAisle = await box("#pantryList .aisle h3");
  check("pantry: at least 16px between the buttons and the list", firstAisle.top - actions.bottom >= 16, `${Math.round(firstAisle.top - actions.bottom)}px`);
  const add = await box("#pantryAddBtn"), input = await box("#pantryAdd");
  check("pantry: Add button same height as the box, not squashed", Math.abs(add.h - input.h) <= 1 && add.w >= 72, JSON.stringify({ add, input }));
  check("pantry: hint fits the box", await page.evaluate(() => { const i = document.getElementById("pantryAdd"); const c = document.createElement("canvas").getContext("2d"); const cs = getComputedStyle(i); c.font = `${cs.fontSize} ${cs.fontFamily}`; return c.measureText(i.placeholder).width <= i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); }));
  const x = await box("#pantryList .x");
  check("pantry: × remove buttons are 44px", Math.round(x.w) >= 44 && Math.round(x.h) >= 44, JSON.stringify(x));
  const row = await box("#pantryList .item");
  check("pantry: × tap area stays on screen, × lined up with the row's edge", x.right <= 390 - 4 && Math.abs((x.left + x.right) / 2 - (row.right - 10)) <= 6, JSON.stringify({ x, rowRight: row.right }));
  await page.evaluate(() => { state.ideas = [{ title: "Lemon rice", why: "Bright and quick.", missing: [] }]; renderIdeas(); });
  const ideas = await box("#ideas"), aisle2 = await box("#pantryList .aisle h3");
  check("pantry: gap between the ideas and the list", aisle2.top - ideas.bottom >= 16, `${Math.round(aisle2.top - ideas.bottom)}px`);
  const [ih, ah] = await page.evaluate(() => [".ideas-head h3", ".aisle h3"].map((q) => { const cs = getComputedStyle(document.querySelector(q)); return `${cs.fontSize}/${cs.letterSpacing}/${cs.fontWeight}`; }));
  check("pantry: 'Tonight's options' styled like the other headings", ih === ah, `${ih} vs ${ah}`);
  await page.evaluate(() => { state.pantry = {}; state.ideas = null; renderPantry(); });
  const empty = await box("#pantryList .empty"), acts = await box("#view-pantry .actions");
  check("pantry: empty message sits 16-30px under the buttons", empty.top - acts.bottom >= 16 && empty.top - acts.bottom <= 30, `${Math.round(empty.top - acts.bottom)}px`);
  await page.reload(); await page.waitForFunction(() => !store.loading);

  // --- plan (1.7.4)
  await page.click('#tabs button[data-view="plan"]');
  const pl = await page.evaluate(() => {
    const t = document.getElementById("weekTitle"), n = document.getElementById("weekNote");
    const flame = getComputedStyle(document.documentElement).getPropertyValue("--flame").trim();
    const probe = document.createElement("i"); probe.style.color = flame; document.body.append(probe); const fc = getComputedStyle(probe).color; probe.remove();
    return { fc, title: getComputedStyle(t).color, note: n.textContent, noteVis: getComputedStyle(n).visibility, adds: [...document.querySelectorAll("[data-add]")].map((b) => ({ t: b.textContent.trim(), label: b.getAttribute("aria-label"), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })) };
  });
  check("plan: one '+' per day, no 'Add a meal' text", pl.adds.length === 7 && pl.adds.every((a) => a.t === "+"), JSON.stringify(pl.adds[0]));
  check("plan: '+' buttons are 44px and say which day", pl.adds.every((a) => Math.round(a.w) >= 44 && Math.round(a.h) >= 44 && /^Add a meal to \w{3} \d{1,2}$/.test(a.label)), JSON.stringify(pl.adds[0]));
  check("plan: this week shows '(this week)' and the range in the accent colour", pl.noteVis === "visible" && pl.note === "(this week)" && pl.title === pl.fc, JSON.stringify(pl));
  const navBefore = await box("#view-plan .weeknav"), prevBtn = await box("#prevWeek");
  check("plan: week arrows are 44px", Math.round(prevBtn.w) >= 44 && Math.round(prevBtn.h) >= 44, JSON.stringify(prevBtn));
  const todaySub = await page.textContent("#topSub");
  check("plan: header shows today's date, not the week", /^\w{3} \d{1,2} \w{3}$/.test(todaySub), todaySub);
  await page.click("#nextWeek");
  check("plan: header date stays on today after changing week", (await page.textContent("#topSub")) === todaySub, await page.textContent("#topSub"));
  const other = await page.evaluate(() => ({ vis: getComputedStyle(document.getElementById("weekNote")).visibility, title: getComputedStyle(document.getElementById("weekTitle")).color }));
  const navAfter = await box("#view-plan .weeknav");
  check("plan: next week has no note and plain ink", other.vis === "hidden" && other.title !== pl.fc, JSON.stringify(other));
  check("plan: changing week doesn't move the days", Math.abs(navAfter.h - navBefore.h) < 1, `${navBefore.h} → ${navAfter.h}`);
  await page.click("#prevWeek");
  const day = await box("#days .day"), addBtn = await box("#days .day .addslot");
  check("plan: '+' sits at the right edge of the day row", Math.abs(addBtn.right - day.right) <= 1 && addBtn.top - day.top <= 14, JSON.stringify({ day, addBtn }));
  // planned meals: mini picture and titles that wrap instead of "…" (1.7.6)
  await page.evaluate(() => {
    const k = iso(state.week);
    state.recipes.long = { title: "Grandma's slow-roasted lamb shoulder with anchovy, rosemary and white beans", servings: 6, photos: [] };
    state.recipes.cov = { title: "Leek soup", cover: "c".repeat(32), photos: ["d".repeat(32)] };
    state.plan[k] = { date: k, entries: [{ recipeId: "long", servings: 6 }, { recipeId: "cov", servings: 2 }, { recipeId: "a", servings: 4 }, { recipeId: "gone", servings: 2 }] };
    renderPlan();
  });
  const slots = await page.evaluate(() => [...document.querySelectorAll("#days .slot")].map((b) => {
    const t = b.querySelector(".t"), m = b.querySelector(".mini"), cs = getComputedStyle(t);
    return { text: t.textContent, lines: Math.round(t.getBoundingClientRect().height / parseFloat(cs.lineHeight)), clipped: t.scrollWidth > t.clientWidth || cs.textOverflow === "ellipsis",
      mini: m && { cover: m.classList.contains("cover"), img: m.querySelector("img")?.getAttribute("src") || null, letter: m.textContent, w: m.getBoundingClientRect().width, fit: m.querySelector("img") ? getComputedStyle(m.querySelector("img")).objectFit : null } };
  }));
  check("plan: long meal names wrap in full, no '…'", slots[0].lines >= 2 && !slots[0].clipped && slots[0].text.endsWith("white beans"), JSON.stringify(slots[0]));
  check("plan: meals don't show the serves count", await page.evaluate(() => [...document.querySelectorAll("#days .slot")].every((b) => !/serves/i.test(b.textContent))), await page.textContent("#days .slot"));
  const titleMid = await page.evaluate(() => { const b = document.querySelector("#days .slot:nth-child(2)"), t = b.querySelector(".t").getBoundingClientRect(), m = b.querySelector(".mini").getBoundingClientRect(); return Math.abs((t.top + t.bottom) / 2 - (m.top + m.bottom) / 2); });
  check("plan: one-line name is centred on its picture", titleMid <= 2, `${titleMid}px off`);
  check("plan: every meal has a mini picture", slots.every((x) => x.mini && Math.round(x.mini.w) === 40), JSON.stringify(slots.map((x) => x.mini)));
  check("plan: cover shown whole, on white", slots[1].mini.cover && slots[1].mini.img === "/api/covers/" + "c".repeat(32) && slots[1].mini.fit === "contain", JSON.stringify(slots[1].mini));
  check("plan: no cover or photo → first letter", slots[0].mini.letter === "G" && !slots[0].mini.img && slots[3].mini.letter === "?", JSON.stringify([slots[0].mini, slots[3].mini]));
  await page.evaluate(() => { state.recipes.a.photos = ["d".repeat(32)]; renderPlan(); });
  const ph = await page.evaluate(() => { const i = document.querySelectorAll("#days .slot .mini")[2].querySelector("img"); return { src: i?.getAttribute("src"), fit: i && getComputedStyle(i).objectFit }; });
  check("plan: photo when there's no cover, cropped to the square", ph.src === "/api/photos/" + "d".repeat(32) && ph.fit === "cover", JSON.stringify(ph));
  await page.click("#days .day .addslot");
  await page.waitForSelector(".sheet-bg.open");
  check("plan: '+' opens the recipe picker", await page.isVisible(".sheet-bg.open"));
  await page.reload(); await page.waitForFunction(() => !store.loading);

  // --- recipe page
  await page.click('#tabs button[data-view="recipes"]'); await page.click(".rcard");
  const stats = await box("#cookStats"), desc = await box("#view-detail p.muted");
  check("recipe page: no big gap between the stars line and the description", desc.top - stats.bottom <= 12, `${Math.round(desc.top - stats.bottom)}px`);

  // --- edit form
  // tidy-ups (1.10.0): action buttons in a 2x2 grid, header buttons one size
  const quad = await page.$$eval("#view-detail .actions.quad .btn", (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }));
  check("recipe page: four action buttons in two even rows, none left on its own", quad.length === 4 && new Set(quad.map((a) => a.t)).size === 2 && new Set(quad.map((a) => a.w)).size === 1 && quad.every((a) => a.h >= 44), JSON.stringify(quad));
  const hdr = async (sel) => page.$$eval(sel, (bs) => bs.map((b) => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b); return { h: Math.round(r.height), f: cs.fontSize }; }));
  const dh = await hdr("#view-detail .detail-head .btn");
  check("recipe page: Back, Edit and Delete the same height, at least 44px", dh.length === 3 && dh.every((b) => b.h >= 44 && b.h === dh[0].h && b.f === dh[0].f), JSON.stringify(dh));
  await page.click("#edit");
  const rh = await hdr("#review .detail-head .btn");
  check("edit form: '‹ Cancel' and 'Save changes' the same height and text size", rh.length === 2 && rh[0].h === rh[1].h && rh[0].h >= 44 && rh[0].f === rh[1].f, JSON.stringify(rh));
  const handle = await box(".ingrow .h");
  check("edit form: drag handle on one line", handle.h < 30, JSON.stringify(handle));
  // ingredient rows read as separate cards (1.8.0)
  await page.click("#addIng"); await page.fill(".ingrow:nth-child(2) [data-f=item]", "butter");
  const ing = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".ingrow")], r = rows.map((x) => x.getBoundingClientRect()), cs = getComputedStyle(rows[0]);
    const bodyBg = getComputedStyle(document.body).backgroundColor, x = rows[0].querySelector(".x").getBoundingClientRect();
    const sel = rows[0].querySelector("[data-f=unit]"), scs = getComputedStyle(sel), c = document.createElement("canvas").getContext("2d"); c.font = `${scs.fontSize} ${scs.fontFamily}`;
    return { gap: r[1].top - r[0].bottom, bg: cs.backgroundColor, bodyBg, border: cs.borderTopWidth + " " + cs.borderTopStyle, x: { w: x.width, h: x.height, right: x.right, rowRight: r[0].right },
      unitFits: c.measureText("whole").width <= sel.clientWidth - parseFloat(scs.paddingLeft) - parseFloat(scs.paddingRight) - 20, inputBg: getComputedStyle(rows[0].querySelector("[data-f=item]")).backgroundColor };
  });
  check("edit form: ingredients are grey cards with a border", ing.bg !== ing.bodyBg && ing.border === "1px solid" && ing.inputBg === ing.bodyBg, JSON.stringify(ing));
  check("edit form: at least 8px between ingredient cards", ing.gap >= 8, `${ing.gap}px`);
  check("edit form: ingredient × is 44px and stays inside its card", Math.round(ing.x.w) >= 44 && Math.round(ing.x.h) >= 44 && ing.x.right <= ing.x.rowRight + 0.5, JSON.stringify(ing.x));
  check("edit form: unit box fits 'whole'", ing.unitFits);
  const qtyFits = await page.evaluate(() => { const q = document.querySelector(".ingrow [data-f=quantity]"), old = q.value; q.value = "1000"; const ok = q.scrollWidth <= q.clientWidth; q.value = old; return ok; });
  check("edit form: quantity box fits '1000'", qtyFits);
  // photo × buttons get a 44px tap area (1.10.0)
  const xBox = async (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((b) => { const r = b.getBoundingClientRect(), c = b.querySelector("span").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), dot: Math.round(c.width) }; }), sel);
  await page.evaluate(() => { state.draft = state.reviewCollect(); state.draft.photos = ["d".repeat(32)]; renderReview(); });
  const px = await xBox("#revPhotos [data-rmp]");
  check("edit form: photo × is a 44px tap area with the small dark circle", px.length === 1 && px[0].w >= 44 && px[0].h >= 44 && px[0].dot <= 26, JSON.stringify(px));
  await page.evaluate(() => { state.draft = null; state.editingId = null; show("import"); state.images = [new Blob(["x"], { type: "image/png" })]; renderThumbs(); });
  const tx = await xBox("#thumbs [data-rmi]");
  check("import: screenshot × is a 44px tap area too", tx.length === 1 && tx[0].w >= 44 && tx[0].h >= 44, JSON.stringify(tx));
  await page.evaluate(() => { state.images = []; renderThumbs(); });
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
