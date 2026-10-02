// 2.1.0: other people. Profiles (name, photo, the welcome), the People row and
// Everyone / Just me in the Archives, someone else's recipe read-only, Add to my
// recipes, and search across everyone's books. Until 2.3 every request is the
// owner, so "Sam" and "Ava" are put straight into the database, the way the
// server suite inserts rows. See docs/multi-user.md.
import Database from "better-sqlite3";
import path from "node:path";
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("people");
let s, b;
const J = { "content-type": "application/json" };
try {
  s = await startServer({ port: 19901, named: false });
  const api = async (p, o = {}) => { const r = await fetch(s.url + p, o); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
  const put = (p, body) => api(p, { method: "PUT", headers: J, body: JSON.stringify(body) });
  const post = (p, body) => api(p, { method: "POST", headers: J, body: JSON.stringify(body) });
  const db = () => new Database(path.join(s.data, "bourdain.db"));
  const today = new Date();
  const ago = (n) => { const x = new Date(today); x.setDate(x.getDate() - n); x.setHours(19, 0, 0, 0); return { date: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`, at: x.toISOString(), mult: 1 }; };
  const owner = (await api("/api/me")).j.id;
  await s.put("recipes", "soup", { title: "Leek soup", rating: 2, ingredients: [{ item: "leek" }], steps: ["Soften."], photos: [], cooks: [ago(1)] });
  await s.put("recipes", "mylentil", { title: "Lentil soup (mine)", ingredients: [{ item: "lentils" }], steps: [], photos: [], cooks: [] });
  const d = db();
  d.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('sam', 'sam@example.com', NULL, datetime())").run(); // not named yet
  const ins = d.prepare("INSERT INTO recipes (owner, id, doc, updated_at) VALUES (?, ?, ?, datetime())");
  ins.run("sam", "katsu", JSON.stringify({ title: "Chicken katsu curry", rating: 3, servings: 2, tags: ["japanese"], description: "Crisp panko chicken.", ingredients: [{ item: "panko", quantity: 80, unit: "g" }, { item: "chicken thigh", quantity: 2, unit: "whole" }], steps: ["Bread the chicken.", "Fry for 6 minutes."], photos: [], cooks: [ago(0), ago(3)] }));
  ins.run("sam", "dal", JSON.stringify({ title: "Tarka dal", rating: 1, ingredients: [{ item: "red lentils" }], steps: ["Simmer."], photos: [], cooks: [ago(2)] }));
  d.close();

  // --- server: profiles
  check("people: nobody named yet, so nobody listed", JSON.stringify((await api("/api/people")).j) === "[]");
  check("name: empty refused (bad_name)", (await put("/api/me", { name: "   " })).j?.code === "bad_name");
  check("name: over 40 characters refused", (await put("/api/me", { name: "x".repeat(41) })).j?.code === "bad_name");
  check("photo: must be an uploaded photo id", (await put("/api/me", { name: "Zein", photo: "../etc" })).j?.code === "bad_photo");
  const saved = await put("/api/me", { name: "  Zein   Benjamin ", photo: null });
  check("name saved trimmed, spaces tidied", saved.status === 200 && saved.j.name === "Zein Benjamin", JSON.stringify(saved.j));
  let d2 = db(); d2.prepare("UPDATE users SET name = 'Sam' WHERE id = 'sam'").run(); d2.close();
  const ppl = (await api("/api/people")).j;
  check("people: named people with counts, me flagged, no emails", ppl.length === 2 && ppl.find((p) => p.me)?.id === owner && ppl.find((p) => p.id === "sam")?.recipes === 2 && ppl.find((p) => p.id === "sam").cooks === 3 && !JSON.stringify(ppl).includes("@"), JSON.stringify(ppl));
  const prof = await api("/api/people/sam");
  check("a profile has that person's recipes", prof.status === 200 && prof.j.recipes.katsu && prof.j.recipes.dal && !prof.j.recipes.soup && !JSON.stringify(prof.j).includes("@"));
  check("unknown or unnamed person: 404", (await api("/api/people/nobody")).status === 404);
  check("one of their recipes by id; a missing one is 404", (await api("/api/people/sam/recipes/katsu")).j?.recipe?.title === "Chicken katsu curry" && (await api("/api/people/sam/recipes/gone")).status === 404);

  // --- server: search across books
  check("search: needs 2 letters", (await api("/api/search?q=a")).j?.code === "short_query");
  const byIng = (await api("/api/search?q=panko")).j, byTag = (await api("/api/search?q=japanese")).j, byDesc = (await api("/api/search?q=crisp")).j;
  check("search: matches ingredients, tags and description", byIng[0]?.id === "katsu" && byTag[0]?.id === "katsu" && byDesc[0]?.id === "katsu" && byIng[0].name === "Sam");
  const lent = (await api("/api/search?q=lentil")).j;
  check("search: never the caller's own recipes", lent.length === 1 && lent[0].id === "dal" && lent[0].owner === "sam", JSON.stringify(lent));

  // --- server: copy
  const c1 = await post("/api/copy", { owner: "sam", id: "katsu" });
  check("copy: 201, a new recipe of mine", c1.status === 201 && c1.j.id && !c1.j.already, JSON.stringify(c1.j).slice(0, 200));
  const mineNow = (await s.state()).recipes[c1.j.id];
  check("copy: its own rating and cook log start empty, and it remembers where it came from", mineNow && mineNow.rating === undefined && mineNow.cooks.length === 0 && mineNow.copied_from.owner === "sam" && mineNow.copied_from.id === "katsu" && mineNow.copied_from.name === "Sam" && mineNow.ingredients.length === 2);
  check("copy: Sam's original is untouched", (await api("/api/people/sam/recipes/katsu")).j.recipe.rating === 3 && (await api("/api/people/sam/recipes/katsu")).j.recipe.cooks.length === 2);
  const c2 = await post("/api/copy", { owner: "sam", id: "katsu" });
  check("copy again: the same copy, not a second one", c2.status === 200 && c2.j.already && c2.j.id === c1.j.id && Object.values((await s.state()).recipes).filter((r) => r.copied_from?.id === "katsu").length === 1);
  check("copy my own: refused (own_recipe); a missing one: 404", (await post("/api/copy", { owner, id: "soup" })).j?.code === "own_recipe" && (await post("/api/copy", { owner: "sam", id: "gone" })).status === 404);
  check("search: marks what I've already copied", (await api("/api/search?q=katsu")).j[0].copied === c1.j.id);
  await fetch(`${s.url}/api/recipes/${c1.j.id}`, { method: "DELETE" }); // start the app checks without the copy

  // --- server: feed
  const f = (await api("/api/feed")).j;
  check("feed: everyone's cooks, newest first, with who", f.entries.length === 4 && f.entries[0].who.name === "Sam" && f.entries[0].title === "Chicken katsu curry" && f.entries.some((e) => e.who.me && e.recipeId === "soup"), JSON.stringify(f.entries.map((e) => [e.who.name, e.date])));
  const p1 = (await api("/api/feed?limit=2")).j, p2 = (await api("/api/feed?limit=2&before=" + encodeURIComponent(p1.next))).j;
  check("feed: pages with before/next", p1.entries.length === 2 && p1.next && p2.entries.length === 2 && p2.entries[0].date <= p1.entries[1].date, JSON.stringify([p1.next, p2.entries.map((e) => e.date)]));
  check("new routes are refused through Cloudflare too", (await api("/api/people", { headers: { "Cf-Ray": "x" } })).status === 403 && (await api("/api/feed", { headers: { "Cf-Ray": "x" } })).status === 403);

  // --- app: the welcome
  d2 = db(); d2.prepare("UPDATE users SET name = NULL WHERE id = ?").run(owner); d2.prepare("UPDATE users SET name = NULL WHERE id = 'sam'").run(); d2.close();
  b = await openBrowser();
  const { page, errors } = b;
  await openApp(page, s.url);
  await page.waitForSelector("#sheet.open #pfName");
  check("first open with no name: a welcome, name suggested from the email", /Welcome to Bourdain/.test(await page.textContent("#sheet h3")) && (await page.inputValue("#pfName")) === "Owner");
  await page.click('#sheet [data-act="later"]'); await page.click('#tabs button[data-view="plan"]'); await page.click('#tabs button[data-view="recipes"]');
  check("Later: gone for this visit", !(await page.isVisible("#sheet.open")));
  await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.waitForSelector("#sheet.open #pfName");
  check("…and back next time the app opens", /Welcome/.test(await page.textContent("#sheet h3")));
  await page.fill("#pfName", "");
  await page.click('#sheet [data-act="save"]');
  check("Save with no name: says what's needed", /Add a name first/.test(await page.textContent("#toast")) && await page.isVisible("#sheet.open"));
  await page.fill("#pfName", "Zein");
  const img = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#7a5c9e" } }).jpeg().toBuffer();
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click('#sheet [data-act="photo"]')]);
  await fc.setFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: img });
  await page.waitForSelector('#pfAv .av img:not([src^="/avatars/"])');
  await page.click('#sheet [data-act="save"]'); await sleep(400);
  const meSaved = (await api("/api/me")).j;
  check("Save: name and photo stored, 'Welcome, Zein.'", meSaved.name === "Zein" && /^[a-f0-9]{32}$/.test(meSaved.photo || "") && /Welcome, Zein\./.test(await page.textContent("#toast")), JSON.stringify(meSaved));
  await page.reload(); await page.waitForFunction(() => !store.loading); await sleep(300);
  check("no welcome once you have a name", !(await page.isVisible("#sheet.open")));

  // --- app: alone, the Archives look as before
  await page.evaluate(() => { const f = window.fetch; window.__peopleCalls = 0; window.fetch = (u, o) => { if (String(u).includes("/api/people")) window.__peopleCalls++; return f(u, o); }; });
  await page.click('#tabs button[data-view="timeline"]'); await sleep(2500);
  check("alone: no People row, no Everyone / Just me", !(await page.$(".people")) && !(await page.$(".seg")));
  const calls = await page.evaluate(() => window.__peopleCalls);
  check("…and the Archives don't keep asking the server (no render loop)", calls <= 1, `${calls} calls in 2.5s`);

  // --- app: with Sam
  d2 = db(); d2.prepare("UPDATE users SET name = 'Sam' WHERE id = 'sam'").run(); d2.close();
  await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector(".people .person"); await sleep(500);
  const row = await page.$$eval(".people .person", (bs) => bs.map((x) => x.lastElementChild.textContent.trim()));
  check("People row: You first, then Sam", JSON.stringify(row) === JSON.stringify(["You", "Sam"]), JSON.stringify(row));
  check("your own photo in the row", Boolean(await page.$('.people .person:first-child .av img')));
  d2 = db(); d2.prepare("UPDATE users SET name = 'Sam Taylor-Jones' WHERE id = 'sam'").run(); d2.close();
  await page.evaluate(() => { people.at = 0; people.list = null; }); await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector('.people .person[data-person="sam"]'); await sleep(300);
  const full = await page.$eval('.people .person[data-person="sam"]', (x) => ({ shown: x.lastElementChild.textContent.trim(), label: x.getAttribute("aria-label") }));
  check("People row: first names only, the full name still read out", full.shown === "Sam" && full.label === "Sam Taylor-Jones", JSON.stringify(full));
  d2 = db(); d2.prepare("UPDATE users SET name = 'Sam' WHERE id = 'sam'").run(); d2.close();
  await page.reload(); await page.waitForFunction(() => !store.loading);
  await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector(".people .person"); await sleep(500);
  const statsEvery = await page.$$eval(".stat b", (xs) => xs.map((x) => x.textContent));
  const feedEvery = await page.$$eval(".feed .slot", (xs) => xs.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  check("Everyone: Sam's cooks in the feed, with his name", /Everyone/.test(await page.textContent(".seg .on")) && feedEvery.filter((t) => /Chicken katsu curry.*Sam/.test(t)).length === 2 && feedEvery.some((t) => /Tarka dal.*Sam/.test(t)) && feedEvery.some((t) => /Leek soup.*You/.test(t)), JSON.stringify(feedEvery));
  check("…with the servings they made", feedEvery.some((t) => /Chicken katsu curry.*Sam.*2 servings/.test(t)), JSON.stringify(feedEvery));
  await page.click('.seg [data-who="me"]');
  const feedMe = await page.$$eval(".feed .slot", (xs) => xs.map((x) => x.textContent));
  check("Just me: only mine", feedMe.length === 1 && /Leek soup/.test(feedMe[0]) && !feedMe.some((t) => /Sam/.test(t)));
  check("the stats are yours either way", JSON.stringify(await page.$$eval(".stat b", (xs) => xs.map((x) => x.textContent))) === JSON.stringify(statsEvery), JSON.stringify(statsEvery));
  await page.reload(); await page.waitForFunction(() => !store.loading); await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector(".seg");
  check("Just me is remembered on this phone", /Just me/.test(await page.textContent(".seg .on")));
  await page.click('.seg [data-who="everyone"]'); await page.waitForSelector('.feed [data-owner="sam"]');

  // --- app: a feed entry of Sam's opens his recipe read-only
  await page.click('.feed [data-owner="sam"][data-rid="dal"]'); await page.waitForSelector("#tCopy");
  check("from the feed: Sam's recipe, Back says Archives, Archives tab lit", /Tarka dal/.test(await page.textContent("#view-theirs h2")) && (await page.textContent("#tBack")).trim() === "‹ Archives" && (await page.evaluate(() => document.querySelector("#tabs .on").dataset.view)) === "timeline");
  check("read-only: no Edit, Delete, Cook this, Add to the week, photo or cover", !(await page.$("#view-theirs #edit, #view-theirs #del, #view-theirs #cookThis, #view-theirs #addPlan, #view-theirs #addPhoto, #view-theirs #makeCover")));
  check("…shows whose it is and their stars, and the ingredients", /Sam's recipe/.test(await page.textContent("#tWho")) && (await page.locator("#tWho svg.mstar").count()) === 1 && /red lentils/.test(await page.textContent("#ingList")));
  await page.click("#tBack");

  // --- app: a profile, then Add to my recipes
  await page.click('.people .person:has-text("Sam")'); await page.waitForSelector("#view-person .profile");
  check("Sam's profile: name, counts, recent cooks and recipes", /Sam/.test(await page.textContent("#view-person h2")) && /2 recipes · 3 cooks/.test(await page.textContent("#view-person .profile")) && (await page.locator("#view-person .rcard").count()) === 2 && (await page.locator("#view-person .tl-top .slot").count()) === 3);
  await page.click('#view-person .rcard:has-text("katsu")'); await page.waitForSelector("#tCopy");
  check("from the profile, Back says Sam", (await page.textContent("#tBack")).trim() === "‹ Sam" && (await page.textContent("#tCopy")).trim() === "Add to my recipes");
  await page.click("#tCopy"); await page.waitForSelector("#view-detail #fromLine");
  const copyId = await page.evaluate(() => state.detailId);
  check("Add to my recipes: lands on my copy, with 'From Sam's recipes'", /Chicken katsu curry/.test(await page.textContent("#view-detail h2")) && /From Sam's recipes/.test(await page.textContent("#fromLine")) && /Added to your recipes/.test(await page.textContent("#toast")));
  check("…not rated, never cooked, editable, cookable", /Not rated yet.*Never cooked/.test(await page.textContent("#cookStats")) && await page.isVisible("#edit") && await page.isVisible("#cookThis"));
  check("…on the server, and in my book", Boolean((await s.state()).recipes[copyId]?.copied_from) && (await page.evaluate((id) => Boolean(state.recipes[id]), copyId)));
  await page.click("#fromLine"); await page.waitForSelector("#tCopy");
  check("from my copy back to Sam's: 'In your recipes'", (await page.textContent("#tCopy")).trim() === "In your recipes ›");
  await page.click("#tCopy");
  check("…which opens my copy", (await page.evaluate(() => state.detailId)) === copyId && await page.isVisible("#view-detail #edit"));

  // --- app: search across everyone's books
  await page.click('#tabs button[data-view="recipes"]'); await page.fill("#search", "lentil");
  await page.waitForSelector("#others .rcard");
  const oth = await page.$$eval("#others .rcard", (xs) => xs.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  check("search: my results, then 'In other people's books' with Sam's dal", /In other people's books/.test(await page.textContent("#others")) && oth.length === 1 && /Tarka dal/.test(oth[0]) && /Sam's/.test(oth[0]) && /Lentil soup \(mine\)/.test(await page.textContent("#rlist")), JSON.stringify(oth));
  await page.fill("#search", "katsu"); await page.waitForFunction(() => /In your recipes/.test(document.getElementById("others").textContent));
  check("search: one I've copied says 'In your recipes'", true);
  await page.fill("#search", "lentil"); await page.waitForSelector('#others .rcard:has-text("Tarka")');
  await page.click('#others .rcard'); await page.waitForSelector("#tCopy");
  check("tapping a result: read-only, Back says Recipes, Recipes tab lit", (await page.textContent("#tBack")).trim() === "‹ Recipes" && (await page.evaluate(() => document.querySelector("#tabs .on").dataset.view)) === "recipes");
  await page.click("#tBack");
  await page.route("**/api/search**", (r) => r.abort());
  await page.fill("#search", "dal"); await sleep(900);
  check("offline: the other-books section just isn't there", (await page.textContent("#others")).trim() === "");
  await page.unroute("**/api/search**"); await page.fill("#search", "");

  // --- app: offline profile
  await page.route("**/api/people/**", (r) => r.abort());
  await page.evaluate(() => openPerson("sam"));
  await page.waitForFunction(() => /Can't reach the server/.test(document.getElementById("view-person").textContent));
  check("offline profile: says it can't reach the server", true);
  await page.unroute("**/api/people/**");

  // --- app: Edit profile from the version sheet
  await page.click('#tabs button[data-view="recipes"]'); await page.click("#brand"); await page.click('#sheet [data-act="profile"]');
  await page.waitForSelector("#sheet.open #pfName");
  check("Edit profile: your name and photo", (await page.inputValue("#pfName")) === "Zein" && Boolean(await page.$("#pfAv .av img")) && /Your profile/.test(await page.textContent("#sheet h3")));
  await page.click('#sheet [data-act="nophoto"]'); await page.fill("#pfName", "Zein B"); await page.click('#sheet [data-act="save"]'); await sleep(300);
  check("…remove the photo and rename", (await api("/api/me")).j.name === "Zein B" && (await api("/api/me")).j.photo === null);

  // --- a default vegetable for anyone without a picture (2.5.1)
  await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector(".people .person");
  const dflt = await page.evaluate(() => ({ mine: document.querySelector(".people .person:first-child .av img")?.getAttribute("src"), want: "/avatars/" + defaultVeg(store.me.id) + ".webp",
    same: avatar({ id: "abc", name: "A" }) === avatar({ id: "abc", name: "B" }).replace(/B/g, "A"),
    spread: new Set(Array.from({ length: 40 }, (_, i) => defaultVeg("u" + i))).size, noId: avatar({ name: "Ann" }) }));
  check("no picture: a vegetable instead of the initial, the same one every time", dflt.mine === dflt.want && dflt.same, JSON.stringify(dflt));
  check("…spread across the 18, so people don't all get the same one", dflt.spread >= 8, String(dflt.spread));
  check("…nothing is stored for it", (await api("/api/me")).j.photo === null && /^<span class="av sm" aria-hidden="true">A<\/span>$/.test(dflt.noId));

  // --- vegetable pictures (2.5)
  await page.click("#brand"); await page.click('#sheet [data-act="profile"]'); await page.waitForSelector("#sheet.open .vegpick");
  check("the profile sheet offers 18 vegetable pictures, each easy to tap", (await page.locator("#sheet .vegpick").count()) === 18 && (await page.$$eval("#sheet .vegpick", (bs) => bs.every((b) => b.getBoundingClientRect().height >= 44))));
  await page.click('#sheet .vegpick[data-v="tomato"]');
  check("…picking one shows it straight away, marked as chosen", (await page.getAttribute("#pfAv .av img", "src")) === "/avatars/tomato.webp" && (await page.locator('#sheet .vegpick.on[data-v="tomato"]').count()) === 1);
  await page.click('#sheet [data-act="save"]'); await sleep(300);
  check("…and saves as veg:tomato", (await api("/api/me")).j.photo === "veg:tomato");
  const pic = await fetch(s.url + "/avatars/tomato.webp");
  check("…including spinach and red onion (2.5.2)", (await Promise.all(["spinach", "red-onion"].map(async (v) => { const r = await fetch(s.url + `/avatars/${v}.webp`); return r.ok && r.headers.get("content-type") === "image/webp"; }))).every(Boolean) && (await put("/api/me", { name: "Zein B", photo: "veg:red-onion" })).j?.photo === "veg:red-onion");
  await put("/api/me", { name: "Zein B", photo: "veg:tomato" });
  check("…served as a small WebP", pic.ok && pic.headers.get("content-type") === "image/webp" && (await pic.arrayBuffer()).byteLength < 40000);
  const badVeg = [await put("/api/me", { name: "Zein B", photo: "veg:dragonfruit" }), await put("/api/me", { name: "Zein B", photo: "veg:../../etc" }), await put("/api/me", { name: "Zein B", photo: "tomato" })];
  check("…only the 18 pictures are accepted", badVeg.every((r) => r.j?.code === "bad_photo"), JSON.stringify(badVeg.map((r) => r.status)));
  await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector(".people .person");
  check("…and it's what others see in the People row", (await page.getAttribute(".people .person:first-child .av img", "src")) === "/avatars/tomato.webp");
  await page.evaluate(() => { const fake = { name: "X", photo: 'veg:tomato" onerror="window.__p=1' }; document.body.insertAdjacentHTML("beforeend", avatar(fake)); });
  check("…and a made-up picture name never becomes an image", !(await page.evaluate(() => [...document.querySelectorAll("img")].some((i) => /onerror|veg:/.test(i.getAttribute("src") || "")))));

  // --- layout
  await page.click('#tabs button[data-view="timeline"]'); await page.waitForSelector(".people .person");
  const sz = await page.evaluate(() => ({ person: [...document.querySelectorAll(".people .person")].map((x) => Math.round(x.getBoundingClientRect().height)), seg: Math.round(document.querySelector(".seg").getBoundingClientRect().height), over: document.documentElement.scrollWidth - innerWidth }));
  check("layout: people and the switch are easy to tap, no sideways scroll", sz.person.every((h) => h >= 44) && sz.seg >= 44 && sz.over <= 0, JSON.stringify(sz));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
