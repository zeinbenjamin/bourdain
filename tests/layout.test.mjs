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
  // tapping the dates goes back to this week (1.10.3)
  const thisRange = await page.evaluate(() => weekLabel(mondayOf(new Date())));
  await page.click("#nextWeek"); await page.click("#nextWeek");
  check("plan: three weeks ahead, not this week", (await page.textContent("#weekTitle")) !== thisRange);
  await page.click("#thisWeek");
  const back = await page.evaluate(() => ({ t: document.getElementById("weekTitle").textContent, cur: document.querySelector("#view-plan .weeknav").classList.contains("current"), today: Boolean(document.querySelector("#days .day.today")) }));
  check("plan: tapping the dates jumps back to this week", back.t === thisRange && back.cur && back.today, JSON.stringify(back));
  for (let i = 0; i < 5; i++) await page.click("#prevWeek");
  await page.click("#thisWeek");
  check("plan: …from past weeks too", (await page.textContent("#weekTitle")) === thisRange);
  await page.click("#thisWeek");
  check("plan: tapping it on this week changes nothing", (await page.textContent("#weekTitle")) === thisRange);
  const wk = await page.evaluate(() => { const b = document.getElementById("thisWeek"), r = b.getBoundingClientRect(), t = getComputedStyle(document.getElementById("weekTitle")); return { tag: b.tagName, label: b.getAttribute("aria-label"), h: Math.round(r.height), size: t.fontSize, family: t.fontFamily }; });
  check("plan: the dates are a real 44px button, still styled as the heading", wk.tag === "BUTTON" && wk.label === "Back to this week" && wk.h >= 44 && wk.size === "22px" && /Source Serif|Georgia/.test(wk.family), JSON.stringify(wk));
  await page.click("#nextWeek");
  await page.click("#prevWeek");
  const day = await box("#days .day"), addBtn = await box("#days .day .addslot");
  check("plan: '+' sits at the right edge of the day row", Math.abs(addBtn.right - day.right) <= 1 && addBtn.top - day.top <= 14, JSON.stringify({ day, addBtn }));
  // planned meals: mini picture and titles that wrap instead of "…" (1.7.6)
  await page.evaluate(() => {
    // Not today: a later check gives today a meal of its own, which on a Monday would replace these.
    const d = new Date(state.week); if (iso(d) === iso(new Date())) d.setDate(d.getDate() + 1);
    const k = iso(d);
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
  // this week in red: arrows, today's meals, and a filled + when today is empty (1.10.2)
  const FLAME = "rgb(211, 7, 43)", WHITE = "rgb(255, 255, 255)";
  const planLook = () => page.evaluate(() => {
    const cs = (e) => e && getComputedStyle(e);
    const today = document.querySelector("#days .day.today"), other = [...document.querySelectorAll("#days .day:not(.today)")];
    const add = (d) => { const c = cs(d.querySelector(".addslot")); return { bg: c.backgroundColor, ink: c.color, line: c.borderTopColor }; };
    return {
      arrows: ["#prevWeek", "#nextWeek"].map((q) => ({ ink: cs(document.querySelector(q)).color, line: cs(document.querySelector(q)).borderTopColor })),
      todaySlots: today ? [...today.querySelectorAll(".slot")].map((x) => cs(x).borderTopColor) : null,
      otherSlots: other.flatMap((d) => [...d.querySelectorAll(".slot")].map((x) => cs(x).borderTopColor)),
      todayAdd: today && add(today), otherAdds: other.map(add),
    };
  });
  const k0 = await page.evaluate(() => iso(new Date()));
  await page.evaluate((k) => { const o = Object.keys(state.plan).find((x) => x !== k && state.plan[x].entries.length); state.plan[k] = { date: k, entries: [{ recipeId: "a", servings: 2 }] }; renderPlan(); }, k0);
  let look = await planLook();
  check("plan (this week): ‹ and › are red, circle and arrow", look.arrows.every((a) => a.ink === FLAME && a.line === FLAME), JSON.stringify(look.arrows));
  // 1.10.4: no outline on any planned meal, today's included
  const borders = await page.evaluate(() => [...document.querySelectorAll("#days .slot")].map((x) => getComputedStyle(x).borderTopWidth + " " + getComputedStyle(x).borderTopStyle));
  check("plan: planned meals have no outline box, today's included", look.todaySlots.length === 1 && borders.length > 1 && borders.every((b) => b.startsWith("0px") || b.endsWith("none")), JSON.stringify(borders));
  check("plan: today with a meal keeps the plain + circle", look.todayAdd.bg !== FLAME, JSON.stringify(look.todayAdd));
  await page.evaluate((k) => { state.plan[k] = { date: k, entries: [] }; renderPlan(); }, k0);
  look = await planLook();
  check("plan: nothing planned today → a filled red + with a white +", look.todayAdd.bg === FLAME && look.todayAdd.line === FLAME && look.todayAdd.ink === WHITE, JSON.stringify(look.todayAdd));
  // 1.10.4: days with nothing planned line up with the rest (they used to pick up the .empty message style)
  const rows = await page.evaluate(() => [...document.querySelectorAll("#days .day")].map((d) => { const n = d.querySelector(".dn").getBoundingClientRect(), cs = getComputedStyle(d); return { left: Math.round(n.left), padTop: cs.paddingTop, align: cs.textAlign, line: cs.borderTopColor, meals: d.querySelectorAll(".slot").length, cls: d.className }; }));
  const withMeal = rows.filter((r) => r.meals), without = rows.filter((r) => !r.meals);
  check("plan: empty days line up with days that have meals (same indent, padding and rule)", withMeal.length && without.length && rows.every((r) => r.left === rows[0].left && r.padTop === rows[0].padTop && r.align === rows[0].align && r.line === rows[0].line) && !rows.some((r) => /\bempty\b/.test(r.cls)), JSON.stringify(rows));
  check("plan: other empty days keep the plain + circle", look.otherAdds.every((a) => a.bg !== FLAME && a.ink === FLAME), JSON.stringify(look.otherAdds));
  await page.click("#nextWeek");
  look = await planLook();
  check("plan (another week): arrows back to black, nothing red-filled", look.arrows.every((a) => a.ink !== FLAME && a.line !== FLAME) && look.todayAdd === null && look.otherAdds.every((a) => a.bg !== FLAME), JSON.stringify(look.arrows));
  await page.click("#prevWeek");
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
  const src = await page.evaluate(() => { const link = document.querySelector("#srcUrl").getBoundingClientRect(), ul = document.querySelector(".srcicons");
    return { names: [...ul.querySelectorAll("li")].map((l) => l.textContent.trim()), icons: [...ul.querySelectorAll("li svg")].map((g) => Math.round(g.getBoundingClientRect().width)),
      gap: Math.round(ul.getBoundingClientRect().top - link.bottom), right: Math.round(ul.getBoundingClientRect().right), vw: document.documentElement.clientWidth,
      rows: new Set([...ul.querySelectorAll("li")].map((l) => Math.round(l.getBoundingClientRect().top))).size, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  check("import: under the link box, where links can come from, with an icon each", src.names.join() === "Recipe sites,Instagram,TikTok,YouTube" && src.icons.every((w) => w === 20) && src.gap >= 2 && src.gap <= 12, JSON.stringify(src));
  check("…on one line at phone width, no sideways scroll", src.rows === 1 && src.right <= src.vw && src.over <= 0, JSON.stringify(src));
  // --- 2.6.0: the recipe list as a list, measured at phone width
  await page.evaluate(() => { state.view = "recipes"; show("recipes"); });
  await page.click('#viewTog[data-as="list"]');
  const lv = await page.evaluate(() => {
    const ctl = document.querySelector(".listctl").getBoundingClientRect();
    return { toggles: [document.getElementById("viewTog")].map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
      selects: [...document.querySelectorAll(".listctl select")].map((x) => Math.round(x.getBoundingClientRect().width)), ctlRight: Math.round(ctl.right), vw: document.documentElement.clientWidth,
      rows: [...document.querySelectorAll("#rlist .rcard")].map((c) => { const r = c.getBoundingClientRect(), t = c.querySelector(".thumb").getBoundingClientRect(), h = c.querySelector("h3").getBoundingClientRect();
        return { h: Math.round(r.height), w: Math.round(r.width), thumb: [Math.round(t.width), Math.round(t.height)], gap: Math.round(h.left - t.right) }; }),
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check("list view: the grid/list switch is two 44px buttons, beside sort and filter on one line", lv.toggles.every(([w, h]) => w >= 44 && h >= 44) && lv.selects.every((w) => w >= 110) && lv.ctlRight <= lv.vw, JSON.stringify(lv));
  check("list view: rows are full width, at least 56px tall, with a 56px picture and 12px before the title", lv.rows.length > 0 && lv.rows.every((r) => r.h >= 56 && r.w >= lv.vw - 40 && r.thumb[0] === 56 && r.thumb[1] === 56 && r.gap === 12), JSON.stringify(lv.rows));
  check("list view: no sideways scroll", lv.over <= 0, String(lv.over));
  await page.click('#viewTog[data-as="grid"]');
  // --- 2.6.5: the page never scrolls; <main> does and fills the screen under the
  // header, so the tab bar and header can't drift with a swipe (2.6.2 scrolled the
  // page, and on some iPhones they did), and a swipe can't land on the page (2.6.1)
  await page.evaluate(() => { for (let i = 0; i < 14; i++) state.recipes["many" + i] = { title: "Long list recipe " + i, ingredients: [], steps: [], photos: [], tags: [] }; state.view = "recipes"; show("recipes"); });
  const sc = await page.evaluate(async () => {
    const main = document.getElementById("main"), cs = getComputedStyle(main), html = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
    const box = () => ({ tabs: Math.round(document.getElementById("tabs").getBoundingClientRect().top), header: Math.round(document.querySelector(".top").getBoundingClientRect().top) });
    const before = box(); window.scrollTo(0, 2000); const pageY = scrollY;
    main.scrollTop = main.scrollHeight; await new Promise((r) => setTimeout(r, 100)); const after = box();
    const m = main.getBoundingClientRect(), hdr = document.querySelector(".top").getBoundingClientRect(), last = [...document.querySelectorAll("#rlist .rcard")].at(-1).getBoundingClientRect();
    return { overflow: cs.overflowY, pageLocked: html.overflowY === "hidden" && body.overflowY === "hidden", overscroll: html.overscrollBehaviorY, pageY, scrolled: main.scrollTop > 0,
      fills: Math.abs(m.top - hdr.bottom) <= 1 && Math.abs(m.bottom - innerHeight) <= 1, before, after, lastBottom: Math.round(last.bottom) };
  });
  check("scrolling: the page itself never scrolls; the content area does, from under the header to the bottom of the screen", sc.overflow === "auto" && sc.pageLocked && sc.overscroll === "none" && sc.pageY === 0 && sc.scrolled && sc.fills, JSON.stringify(sc));
  const pin = await page.evaluate(() => { const cs = getComputedStyle(document.body), r = document.body.getBoundingClientRect();
    return { position: cs.position, top: cs.top, bottom: cs.bottom, left: cs.left, right: cs.right, h: Math.round(r.height), vh: innerHeight }; });
  check("2.7.1: the page is pinned to all four edges of the screen (on an iPhone home-screen app, height:100% stopped short of the home bar and cut the page off under the tab bar)",
    pin.position === "fixed" && [pin.top, pin.bottom, pin.left, pin.right].every((v) => v === "0px") && pin.h === pin.vh, JSON.stringify(pin));
  check("…the header and tab bar don't move while it scrolls, and the last recipe clears the tab bar", sc.before.tabs === sc.after.tabs && sc.before.header === sc.after.header && sc.after.header === 0 && sc.lastBottom <= sc.after.tabs, JSON.stringify(sc));
  await page.click("#btnManual"); await page.waitForSelector("#sheet.open");
  const locked = await page.evaluate(() => getComputedStyle(document.getElementById("main")).overflowY);
  await page.evaluate(() => closeSheet());
  check("…a sheet holds the content still behind it, and lets go when closed", locked === "hidden" && (await page.evaluate(() => getComputedStyle(document.getElementById("main")).overflowY)) === "auto", locked);
  await page.click('.rcard:has-text("Long list recipe 0")'); await page.waitForSelector("#view-detail.active");
  check("…a new screen starts at the top", await page.evaluate(() => document.getElementById("main").scrollTop) === 0);
  await page.evaluate(() => { for (let i = 0; i < 14; i++) delete state.recipes["many" + i]; show("recipes"); });

  // --- 2.6.3: nothing that makes iPhone Safari zoom, room for the home bar, lazy pictures
  const fields = async () => page.evaluate(() => [...document.querySelectorAll(".view.active input:not([type=checkbox]):not([type=file]), .view.active select, .view.active textarea, .top input, .top select")]
    .filter((e) => e.offsetParent).map((e) => ({ id: e.id || e.className || e.tagName, px: parseFloat(getComputedStyle(e).fontSize) })));
  await page.evaluate(() => { state.view = "recipes"; show("recipes"); });
  let small = (await fields()).filter((f) => f.px < 16);
  await page.click('.rcard:has-text("Leek soup")'); await page.click("#edit"); await page.waitForSelector(".ingrow");
  small = small.concat((await fields()).filter((f) => f.px < 16));
  check("no field under 16px (Recipes, the edit form): iPhone Safari zooms in on those", small.length === 0, JSON.stringify(small));
  const ta = await page.evaluate(() => [...document.querySelectorAll("button, .ck, .rcard")].filter((e) => e.offsetParent).map((e) => getComputedStyle(e).touchAction));
  check("…a quick double tap on a button is a tap, not a zoom", ta.length > 0 && ta.every((t) => t === "manipulation"), [...new Set(ta)].join());
  await page.evaluate(() => { state.draft = null; state.editingId = null; state.view = "recipes"; show("recipes"); });
  const pad = await page.evaluate(() => { const rules = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } });
    return (rules.find((r) => r.selectorText === "main")?.cssText || "") + " | " + (rules.find((r) => r.selectorText === ":root" && /--tabgap/.test(r.cssText))?.cssText.match(/--tabgap:[^;]+/)?.[0] || ""); });
  check("…the space under a page follows the tab bar, which allows for the iPhone's home bar", /var\(--tabgap\)/.test(pad) && /--tabgap: ?max\(10px, ?calc\(env\(safe-area-inset-bottom/.test(pad), pad);
  // 2.6.4: lazy only below the first screen, so cards already on screen never flash blank
  const lazy = await page.evaluate(() => { const r = { cover: "c".repeat(32), photos: ["d".repeat(32)] };
    return { below: [cardHtml(r, "", "", true), cardHtml({ photos: ["d".repeat(32)] }, "", "", true)].every((h) => /loading="lazy"/.test(h)),
      eager: [cardHtml(r, ""), miniThumb(r), miniThumb({ photos: ["d".repeat(32)] }), photosHtml(["d".repeat(32)], false)].every((h) => !/loading="lazy"/.test(h)),
      noAsync: !/decoding=/.test(cardHtml(r, "", "", true)) };
  });
  check("…pictures below the first screen load as you scroll; those on it, thumbnails and photo strips load at once", lazy.below && lazy.eager && lazy.noAsync, JSON.stringify(lazy));
  await page.evaluate(() => { for (let i = 0; i < 9; i++) state.recipes["lz" + i] = { title: "Lazy " + i, photos: ["e".repeat(32)], ingredients: [], steps: [], tags: [], created_at: "2026-10-0" + (i + 1) }; renderRecipes(); });
  const lz = await page.evaluate(() => [...document.querySelectorAll("#rlist .rcard img")].map((i) => i.loading === "lazy"));
  check("…in the list, the first 6 cards load at once and the rest lazily", lz.slice(0, 6).every((x) => !x) && lz.slice(6).every((x) => x) && lz.length > 6, JSON.stringify(lz));

  // --- 2.6.4: tapping the tab you're on doesn't redraw it, so pictures don't flash
  const same = async (tab, sel) => {
    await page.click(`#tabs button[data-view="${tab}"]`); await page.waitForTimeout(150);
    const before = await page.evaluateHandle((q) => [...document.querySelectorAll(q)], sel);
    await page.click(`#tabs button[data-view="${tab}"]`); await page.waitForTimeout(150);
    return page.evaluate(([b, q]) => { const now = [...document.querySelectorAll(q)]; return now.length > 0 && now.length === b.length && now.every((e, i) => e === b[i]); }, [before, sel]);
  };
  await page.evaluate(() => { const k = iso(new Date()); state.plan[k] = { date: k, entries: [{ recipeId: "lz0", servings: 2 }] }; state.recipes.lz0.cooks = [{ date: iso(new Date()), at: new Date().toISOString(), mult: 1 }]; });
  const kept = { recipes: await same("recipes", "#rlist img"), plan: await same("plan", "#days img"), archives: await same("timeline", "#view-timeline .slot") };
  check("tapping the tab you're on keeps its pictures (Recipes, Plan, Archives): nothing flashes", kept.recipes && kept.plan && kept.archives, JSON.stringify(kept));
  await page.click('#tabs button[data-view="recipes"]');
  const changed = await page.evaluate(() => { const first = document.querySelector("#rlist .rcard"); state.recipes.lzNew = { title: "Brand new", photos: [], ingredients: [], steps: [], tags: [], created_at: "2026-12-31" }; renderRecipes(); return document.querySelector("#rlist .rcard") !== first && /Brand new/.test(document.querySelector("#rlist").textContent); });
  check("…but a real change still shows straight away", changed);
  await page.evaluate(() => { for (const k of Object.keys(state.recipes)) if (/^lz/.test(k)) delete state.recipes[k]; renderRecipes(); });

  // --- 2.6.5: a meal is on a day once; serves are changed on the meal itself
  const kd = await page.evaluate(() => { const k = iso(new Date()); state.recipes.dup = { title: "Baked mac and cheese", servings: 6, ingredients: [], steps: [], photos: [], tags: [] };
    state.plan[k] = { date: k, entries: [{ recipeId: "dup", servings: 2 }, { recipeId: "a", servings: 4 }, { recipeId: "dup", servings: 6 }, { recipeId: "dup", servings: 4 }] };
    state.week = mondayOf(new Date()); state.view = "plan"; show("plan"); return k; });
  await page.waitForTimeout(600);
  const merged = await page.evaluate((k) => state.plan[k].entries, kd);
  const onServer = ((await s.state()).plan[kd] || {}).entries || [];
  check("plan: a meal added to a day more than once (before 2.6.5) shows once, keeping the larger serves, and the server has it merged",
    merged.length === 2 && merged.filter((e) => e.recipeId === "dup").length === 1 && merged.find((e) => e.recipeId === "dup").servings === 6 && onServer.length === 2, JSON.stringify({ merged, onServer }));
  await page.evaluate((k) => pickRecipe(k), kd); await page.waitForSelector("#sheet.open #pickList");
  check("…the picker marks it 'Already on this day'", /Already on this day/.test(await page.textContent('#sheet [data-id="dup"]')));
  await page.click('#sheet [data-id="dup"]'); await page.waitForTimeout(300);
  check("…and picking it again doesn't add it twice; it says how to change the serves", (await page.evaluate((k) => state.plan[k].entries.length, kd)) === 2 && /Already on .*change the serves/.test(await page.textContent("#toast")), await page.textContent("#toast"));
  await page.evaluate(() => { state.detailId = "dup"; show("detail"); }); await page.click("#addPlan"); await page.waitForSelector("#sheet.open");
  await page.click(`#sheet [data-k="${kd}"]`); await page.waitForTimeout(300);
  check("…nor from the recipe's 'Add to the week'", (await page.evaluate((k) => state.plan[k].entries.length, kd)) === 2 && /Already on/.test(await page.textContent("#toast")));

  // --- 2.7.0: the tab bar floats: a pill 14px in from each side, 10px above the bottom,
  // the page blurred behind it; capped at 500px and centred on an iPad
  const pill = () => page.evaluate(() => { const t = document.getElementById("tabs"), r = t.getBoundingClientRect(), cs = getComputedStyle(t);
    return { left: Math.round(r.left), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), vw: innerWidth,
      blur: /blur/.test(cs.backdropFilter || cs.webkitBackdropFilter || ""), round: parseFloat(cs.borderTopLeftRadius) >= r.height / 2,
      buttons: [...t.querySelectorAll("button")].map((b) => { const x = b.getBoundingClientRect(); return { v: b.dataset.view, w: Math.round(x.width), h: Math.round(x.height), fits: b.scrollWidth <= b.clientWidth, label: b.textContent.trim() }; }) }; });
  await page.evaluate(() => { state.view = "recipes"; show("recipes"); });
  let tb = await pill();
  check("tab bar: a rounded pill floating 14px in from each side and 10px above the bottom, the page blurred behind it", tb.left === 14 && tb.right === 14 && tb.bottom === 10 && tb.blur && tb.round, JSON.stringify(tb));
  check("…five 44px+ tap targets, every label in full", tb.buttons.length === 5 && tb.buttons.every((x) => x.w >= 44 && x.h >= 44 && x.fits && x.label), JSON.stringify(tb.buttons));
  // 2.7.2: at the end of a page there's a small gap above the tab bar, not a big empty band
  const gaps = {};
  await page.setViewportSize({ width: 390, height: 420 }); // short, so every one of these scrolls
  for (const [tab, sel] of [["recipes", "#rlist .rcard"], ["plan", "#planHint"], ["pantry", "#pantryList > *, #view-pantry .actions"], ["shop", "#view-shop .shopacts"]]) {
    await page.click(`#tabs button[data-view="${tab}"]`); await page.waitForTimeout(150);
    gaps[tab] = await page.evaluate(async (q) => { const m = document.getElementById("main"); m.scrollTop = m.scrollHeight; await new Promise((r) => setTimeout(r, 100));
      const last = [...document.querySelectorAll(q)].filter((e) => e.offsetParent).at(-1).getBoundingClientRect(), t = document.getElementById("tabs").getBoundingClientRect();
      return m.scrollHeight > m.clientHeight ? Math.round(t.top - last.bottom) : "no scroll"; }, sel);
  }
  check("2.7.2: scrolled to the end, the last thing sits 8–28px above the tab bar (Recipes, Plan, Pantry, Shop)", Object.values(gaps).every((g) => typeof g === "number" && g >= 8 && g <= 28), JSON.stringify(gaps));
  await page.click('#tabs button[data-view="recipes"]'); await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 320, height: 568 }); await page.waitForTimeout(100);
  tb = await pill();
  check("…labels still fit on a 320px phone", tb.buttons.every((x) => x.fits && x.w >= 44), JSON.stringify(tb.buttons));
  for (const [w, h, name] of [[1024, 768, "landscape"], [768, 1024, "portrait"]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(100);
    tb = await pill();
    check(`…on an iPad (${name}) it stays 500px wide, centred under the content`, tb.w === 500 && Math.abs(tb.left - tb.right) <= 1 && tb.bottom === 10, JSON.stringify(tb));
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
  // The Shop tab: its add box is 16px like every other field, and its buttons are 44px
  await page.click('#tabs button[data-view="shop"]');
  const shopF = await page.evaluate(() => ({ px: parseFloat(getComputedStyle(document.getElementById("manualItem")).fontSize), btns: [...document.querySelectorAll("#view-shop .shopacts .btn, #view-shop .weeknav .btn")].map((b) => Math.round(b.getBoundingClientRect().height)) }));
  check("Shop: the add box is 16px (no iPhone zoom) and its buttons are 44px tall", shopF.px >= 16 && shopF.btns.length === 4 && shopF.btns.every((h) => h >= 44), JSON.stringify(shopF));
  await page.click('#tabs button[data-view="recipes"]');

  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
