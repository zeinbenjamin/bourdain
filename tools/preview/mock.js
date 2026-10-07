/* Bourdain preview: a stand-in for server.js that runs in the page, so the real
   front end can be tried inside a Claude artifact. Everything is kept on this
   device (localStorage). AI jobs, link fetches and covers give canned answers.
   Injected by build.mjs before the app's own script; COVERS and VERSION are filled in there. */
(() => {
  const COVERS = /*COVERS*/{}, VERSION = /*VERSION*/{}, ADMIN = /*ADMIN*/{}, ME = "me";
  const KEY = "bourdain.preview.db", PKEY = "bourdain.preview.photos";
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  if (location.hash === "#reset") { try { Object.keys(localStorage).filter((k) => k.startsWith("bourdain")).forEach((k) => localStorage.removeItem(k)); } catch {} history.replaceState(null, "", location.pathname); }

  // ---------- demo data ----------
  const day = (n) => { const x = new Date(); x.setDate(x.getDate() - n); x.setHours(19, 0, 0, 0); return x; };
  const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const cook = (n, mult = 1) => ({ date: ymd(day(n)), at: day(n).toISOString(), mult });
  const I = (quantity, unit, item, prep = "", aisle = "produce") => ({ raw_text: [quantity, unit, item].filter((v) => v != null && v !== "").join(" ") + (prep ? ", " + prep : ""), quantity, unit, item, prep, section: "", aisle, optional: false });
  const cost = (home, out, comparable) => ({ home_per_serve: home, casual_per_serve: out, out_per_serve: out, course: "main", currency: "AUD", comparable, at: new Date().toISOString(), hash: "" });
  const R = (title, o) => ({ title, description: "", servings: 4, prep_min: 15, cook_min: 25, source_type: "instagram", source_url: "", tags: [], photos: [], cooks: [], steps: [], ingredients: [], created_at: day(o.ago || 1).toISOString(), updated_at: day(o.ago || 1).toISOString(), ...o,
    cooks: [...(o.cooks || [])].sort((a, b) => (a.date + a.at).localeCompare(b.date + b.at)) }); // date order, as the app keeps them
  function seed() {
    const mine = {
      rendang: R("Beef Rendang", { ago: 1, cover: COVERS.rendang, servings: 6, prep_min: 30, cook_min: 170, source_type: "web", source_url: "https://example.com/beef-rendang", tags: ["indonesian", "beef", "curry"],
        description: "Slow-cooked until the sauce is dark, dry and clinging to the beef.",
        ingredients: [I(1.2, "kg", "beef chuck", "cut into 4cm pieces", "meat & seafood"), I(400, "ml", "coconut milk", "", "pantry"), I(2, "stalk", "lemongrass", "bruised"), I(6, "whole", "kaffir lime leaves", "torn"),
          I(10, "whole", "dried chillies", "soaked", "pantry"), I(6, "whole", "shallot", "peeled"), I(4, "clove", "garlic"), I(3, "tbsp", "kerisik", "toasted coconut", "pantry"), I(1, "tbsp", "palm sugar", "", "pantry")],
        steps: ["Blend the chillies, shallots and garlic into a smooth paste.", "Fry the paste in a little oil for 8 minutes, until it's fragrant and the oil splits.", "Add the beef, lemongrass and lime leaves and stir to coat.", "Pour in the coconut milk and simmer gently for 2 hours, stirring now and then.", "Stir through the kerisik and palm sugar and cook until the sauce is thick and dark."],
        cost: cost(7, 22, "Beef rendang with rice"), cooks: [cook(16)] }),
      velvet: R("Chinese Velvet Chicken Breast", { ago: 2, cover: COVERS["velvet-chicken"], servings: 4, rating: 3, tags: ["chinese", "chicken"],
        ingredients: [I(500, "g", "chicken breast", "sliced thin", "meat & seafood"), I(1, "tsp", "bicarb soda", "", "pantry"), I(1, "tbsp", "cornflour", "", "pantry"), I(2, "tbsp", "soy sauce", "", "pantry"), I(2, "whole", "capsicum", "sliced"), I(3, "clove", "garlic", "minced")],
        steps: ["Toss the chicken with the bicarb and leave for 20 minutes, then rinse.", "Coat with cornflour and a little soy sauce.", "Stir-fry the chicken for 3-4 minutes and set aside.", "Fry the garlic and capsicum for 2 minutes, return the chicken, add the rest of the soy and toss."],
        cost: cost(4.5, 21, "Velvet chicken stir-fry"), cooks: [cook(1), cook(8), cook(20)] }),
      curry: R("Japanese Ground Beef Curry", { ago: 3, cover: COVERS.curry, rating: 2, tags: ["japanese", "beef", "curry"],
        ingredients: [I(500, "g", "beef mince", "", "meat & seafood"), I(1, "whole", "onion", "diced"), I(1, "whole", "carrot", "diced"), I(4, "cube", "japanese curry roux", "", "pantry"), I(500, "ml", "water", "", "other")],
        steps: ["Brown the mince with the onion and carrot for 6 minutes.", "Add the water and simmer for 10 minutes.", "Stir in the roux until thick, about 5 minutes."], cost: cost(4, 17, "Keema curry"), cooks: [cook(0), cook(15)] }),
      mapo: R("Mapo Tofu with Ground Beef", { ago: 4, cover: COVERS.mapo, servings: 2, rating: 1, tags: ["chinese", "tofu"],
        ingredients: [I(300, "g", "silken tofu", "cubed", "dairy & eggs"), I(150, "g", "beef mince", "", "meat & seafood"), I(1.5, "tbsp", "doubanjiang", "", "pantry"), I(1, "tsp", "sichuan pepper", "ground", "spices"), I(2, "clove", "garlic")],
        steps: ["Fry the mince until crisp, about 5 minutes.", "Add the doubanjiang and garlic for 1 minute.", "Add 200ml water and the tofu and simmer for 4 minutes.", "Finish with sichuan pepper."], cost: cost(4, 18, "Mapo tofu"), cooks: [cook(9)] }),
      gyudon: R("One Pot Rice Cooker Japanese Gyudon", { ago: 5, cover: COVERS.gyudon, servings: 2, tags: ["japanese", "beef"],
        ingredients: [I(300, "g", "beef", "thinly sliced", "meat & seafood"), I(1, "whole", "onion", "sliced"), I(2, "cup", "rice", "", "pantry"), I(3, "tbsp", "soy sauce", "", "pantry"), I(2, "tbsp", "mirin", "", "pantry")],
        steps: ["Rinse the rice and add water to the line.", "Lay the onion and beef on top with the soy and mirin.", "Cook on the normal setting, then rest for 10 minutes."], cost: cost(7, 14, "Gyudon"), cooks: [cook(5)] }),
      teritama: R("Teritama Don", { ago: 6, cover: COVERS.teritama, servings: 1, rating: 2, tags: ["japanese", "chicken"],
        ingredients: [I(1, "whole", "chicken thigh", "", "meat & seafood"), I(2, "whole", "egg", "", "dairy & eggs"), I(1, "cup", "rice", "cooked", "pantry"), I(1, "tbsp", "soy sauce", "", "pantry")],
        steps: ["Pan-fry the chicken skin-side down for 8 minutes.", "Glaze with soy and mirin.", "Softly scramble the eggs and serve over rice."], cost: cost(5, 16, "Teritama don"), cooks: [cook(2), cook(11)] }),
      ceviche: R("Shrimp Ceviche", { ago: 7, cover: COVERS.ceviche, servings: 6, prep_min: 23, cook_min: 0, source_type: "web", tags: ["seafood"],
        ingredients: [I(500, "g", "prawns", "peeled", "meat & seafood"), I(4, "whole", "lime", "juiced"), I(1, "whole", "red onion", "diced"), I(1, "bunch", "coriander")], steps: ["Dice the prawns and cover with lime juice for 20 minutes.", "Fold through onion and coriander."], cost: cost(8, 20, "Prawn ceviche") }),
      kebab: R("Kebab with Tzatziki and Spiced Sweet Potato", { ago: 8, cover: COVERS.kebab, rating: 1, tags: ["turkish"],
        ingredients: [I(500, "g", "lamb mince", "", "meat & seafood"), I(1, "whole", "sweet potato", "cubed"), I(200, "g", "greek yoghurt", "", "dairy & eggs"), I(1, "whole", "cucumber", "grated")], steps: ["Roast the sweet potato for 30 minutes.", "Grill the kebabs for 10 minutes.", "Mix the yoghurt and cucumber."], cost: cost(6, 24, "Kebab plate") }),
    };
    const sam = {
      s1: R("Crispy Pork Belly (Siu Yuk)", { ago: 3, cover: COVERS["pork-belly"], source_type: "youtube", tags: ["chinese", "pork"], ingredients: [I(1, "kg", "pork belly", "", "meat & seafood"), I(1, "tbsp", "five spice", "", "spices")], steps: ["Score and salt the skin.", "Roast for 85 minutes."], cooks: [cook(1), cook(12)], rating: 3 }),
      s2: R("Hainanese Chicken and Rice", { ago: 4, cover: COVERS.hainanese, source_type: "manual", tags: ["chicken"], ingredients: [I(1, "whole", "chicken", "", "meat & seafood"), I(2, "cup", "jasmine rice", "", "pantry")], steps: ["Poach the chicken for 40 minutes.", "Cook the rice in the stock."], cooks: [cook(3)] }),
      s3: R("Turkish Manti", { ago: 6, cover: COVERS.manti, source_type: "photo", tags: ["turkish"], ingredients: [I(250, "g", "lamb mince", "", "meat & seafood")], steps: ["Fill and fold.", "Boil for 8 minutes."] }),
    };
    const alex = {
      a1: R("Chicken Rice with Ginger Scallion Sauce", { ago: 2, cover: COVERS["chicken-rice"], tags: ["chicken"], ingredients: [I(2, "whole", "chicken thigh", "", "meat & seafood"), I(1, "bunch", "spring onion")], steps: ["Poach the chicken for 25 minutes.", "Pour hot oil over the ginger and scallion."], cooks: [cook(0), cook(6)], rating: 2 }),
      a2: R("Kingfish Crudo with Mandarin and Jalapeño", { ago: 5, cover: COVERS.crudo, source_type: "web", tags: ["seafood"], ingredients: [I(300, "g", "kingfish", "sashimi grade", "meat & seafood")], steps: ["Slice thinly and dress."], cooks: [cook(4)] }),
      a3: R("Crunchwrap Supreme", { ago: 9, cover: COVERS.crunchwrap, tags: ["tex-mex"], ingredients: [I(4, "whole", "tortilla", "", "bakery")], steps: ["Fold and toast for 3 minutes each side."] }),
    };
    const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const plan = {}; for (const [off, rid, sv] of [[0, "gyudon", 2], [1, "velvet", 4], [3, "mapo", 2], [5, "teritama", 1]]) { const x = new Date(mon); x.setDate(x.getDate() + off); plan[ymd(x)] = { date: ymd(x), entries: [{ recipeId: rid, servings: sv }] }; }
    const pantry = {}; [["jasmine rice", "pantry"], ["garlic", "produce"], ["soy sauce", "pantry"], ["coconut milk", "pantry"], ["brown onions", "produce"]].forEach(([item, aisle], i) => (pantry["p" + i] = { id: "p" + i, item, aisle, added: new Date().toISOString() }));
    return {
      users: { me: { id: ME, name: "Zein", photo: "veg:tomato", email: "you@example.com" }, sam: { id: "sam", name: "Sam Lee", photo: "veg:broccoli" }, alex: { id: "alex", name: "Alex Tran", photo: "veg:lemon" } },
      data: { me: { recipes: mine, plan, pantry, shop: {} }, sam: { recipes: sam, plan: {}, pantry: {}, shop: {} }, alex: { recipes: alex, plan: {}, pantry: {}, shop: {} } },
    };
  }
  let db = get(KEY); if (!db || !db.users) { db = seed(); put(KEY, db); }
  const save = () => { if (!put(KEY, db)) console.warn("preview: this device's storage is full"); };
  const photos = get(PKEY) || {};

  // Pictures: the demo covers are files published with the page; ones added here are kept as data URLs.
  window.PREVIEW = { img: (id) => photos[id] || (Object.values(COVERS).includes(id) ? `img/${id}.webp` : ""), version: VERSION };

  // ---------- the routes the app calls ----------
  const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const json = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const err = (status, code, error) => json(status, { error, code });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const person = (u) => ({ id: u.id, name: u.name, photo: u.photo || null, me: u.id === ME });
  const named = () => Object.values(db.users).filter((u) => u.name);
  const recipesOf = (id) => (db.data[id] && db.data[id].recipes) || {};
  const me = () => ({ id: ME, email: db.users.me.email, name: db.users.me.name, photo: db.users.me.photo, is_admin: true, ai: true, allowance: { exempt: true } });
  // The owner's view: the server's own answers (admin.json, from capture-admin.mjs) with the
  // demo people swapped in. Visitors per day are made up: Zein alone, then the pilot.
  const visitors = () => { const out = [], pilot = [4, 8, 9, 7, 6];
    for (let i = 29; i >= 0; i--) { const day = ymd(day_(i)), p = i < pilot.length ? pilot[pilot.length - 1 - i] : (i % 6 === 3 ? 0 : 1); out.push({ day, people: p, others: Math.max(0, p - 1) }); }
    return out; };
  const day_ = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x; };
  function summary() {
    const sum = JSON.parse(JSON.stringify(ADMIN.summary || {})), tmpl = (sum.people || [])[0] || {};
    sum.day = ymd(new Date());
    sum.people = Object.values(db.users).map((u, i) => { const rs = Object.values(recipesOf(u.id));
      return { ...tmpl, id: u.id, email: u.email || u.id + "@example.com", name: u.name, photo: u.photo, is_admin: u.id === ME, last_seen: day_(i).toISOString(), created_at: day_(30 + i).toISOString(),
        recipes: rs.length, cooks: rs.reduce((n, r) => n + (r.cooks || []).filter((c) => !c.added).length, 0), cooks_added: rs.reduce((n, r) => n + (r.cooks || []).filter((c) => c.added).length, 0), copies: rs.filter((r) => r.copied_from).length }; });
    Object.assign(sum.totals || (sum.totals = {}), { users: sum.people.length, recipes: sum.people.reduce((n, p) => n + p.recipes, 0), active_today: 1 });
    sum.visitors = visitors();
    if (sum.system) sum.system.version = VERSION.version;
    return sum; }
  const activity = () => Object.values(db.users).flatMap((u, k) => Object.entries(recipesOf(u.id)).slice(0, 3).map(([, r], j) => ({ id: 100 - k * 10 - j, user: u.id, name: u.name, at: day_(k + j).toISOString(), action: "recipe_added", target: r.title || "" })))
    .sort((a, b) => b.at.localeCompare(a.at));
  const feedEntry = (u, id, r, c) => ({ who: person(u), owner: u.id, recipeId: id, title: r.title || "", cover: r.cover || null, firstPhoto: (r.photos || [])[0] || null, rating: Number.isInteger(r.rating) ? r.rating : null,
    servings: Number(r.servings) || null, cost: r.cost ? { home_per_serve: r.cost.home_per_serve, out_per_serve: r.cost.casual_per_serve ?? r.cost.out_per_serve } : null, date: c.date, at: c.at || c.date, mult: Number(c.mult) || 1 });
  const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (r) => [r.title, r.description, ...(r.tags || []), ...(r.ingredients || []).map((i) => i && (i.item || i.raw_text))].join(" ").toLowerCase();
  const copies = () => { const m = new Map(); for (const [id, r] of Object.entries(recipesOf(ME))) if (r && r.copied_from) m.set(`${r.copied_from.owner}/${r.copied_from.id}`, id); return m; };
  const AI = {
    import: () => ({ title: "Beef Pepper Rice", description: "The hot-plate favourite, made in one pan.", servings: 2, prep_min: 10, cook_min: 10, tags: ["japanese", "beef"],
      ingredients: [I(300, "g", "beef", "thinly sliced", "meat & seafood"), I(2, "cup", "cooked rice", "", "pantry"), I(1, "tbsp", "butter", "", "dairy & eggs"), I(2, "tbsp", "soy sauce", "", "pantry"), I(1, "cup", "corn kernels", "", "frozen"), I(1, "tsp", "black pepper", "cracked", "spices")],
      steps: ["Heat a heavy pan until very hot.", "Pile the rice in the middle and arrange the beef around it.", "Top with corn, butter and pepper, pour over the soy, and mix at the table after 2 minutes."] }),
    dish: () => ({ title: "Afghan Mantu", description: "Dumplings with yoghurt and spiced tomato.", servings: 2, prep_min: 40, cook_min: 20, tags: ["afghan"],
      ingredients: [I(250, "g", "beef mince", "", "meat & seafood"), I(1, "packet", "wonton wrappers", "", "other"), I(200, "g", "greek yoghurt", "", "dairy & eggs"), I(null, "drizzle", "chilli oil", "", "pantry")],
      steps: ["Fill and fold the dumplings.", "Steam for 15 minutes.", "Serve on yoghurt with the tomato sauce."], notes: "Guessed from a photo.",
      guess: { dish: "Afghan mantu", cuisine: "Afghan", confidence: 62, alternatives: ["Turkish manti", "Shish barak"], basis: "Folded dumplings under yoghurt and a red sauce." } }),
    scan: () => ({ items: [{ item: "egg", qty: 6, unit: "", aisle: "dairy & eggs", sure: true }, { item: "greek yoghurt", qty: null, unit: "", aisle: "dairy & eggs", sure: true }, { item: "lemon", qty: 3, unit: "", aisle: "produce", sure: true }, { item: "leftover curry", qty: null, unit: "", aisle: "other", sure: false }] }),
    ideas: () => [{ title: "Lemon rice", why: "Bright and quick.", missing: [] }, { title: "Egg fried rice", why: "Uses the eggs.", missing: ["spring onion"] }, { title: "Shakshuka", why: "Eggs in sauce.", missing: ["tinned tomato"] }],
    write: (m) => ({ title: m.title || "Egg fried rice", servings: 2, prep_min: 5, cook_min: 10, tags: [], ingredients: [I(2, "cup", "cooked rice", "", "pantry"), I(2, "whole", "egg", "", "dairy & eggs"), I(1, "tbsp", "soy sauce", "", "pantry")], steps: ["Scramble the eggs.", "Fry the rice for 4 minutes.", "Toss together with the soy."] }),
    cost: (m) => { const n = (m.ingredients || []).length || 3, serves = Number(m.servings) > 0 ? Number(m.servings) : 2, home = Math.round(n * 3.2 * 100) / 100;
      return { currency: "AUD", course: "main", comparable: m.title || "A comparable dish", basis: "Preview estimate.", serves, home_total: home, home_per_serve: Math.round(home / serves * 100) / 100, casual_per_serve: 19, out_per_serve: 19 }; },
  };
  async function route(method, path, q, body) {
    const p = path.split("/").filter(Boolean).slice(1).map(decodeURIComponent); // after "api"
    if (p[0] === "version") return json(200, VERSION);
    if (p[0] === "health") return json(200, { ok: true });
    if (p[0] === "me" && method === "GET") return json(200, me());
    if (p[0] === "me" && method === "PUT") { const b = JSON.parse(body || "{}"), name = String(b.name || "").trim(); if (!name || name.length > 40) return err(400, "bad_name", "a name is 1 to 40 characters"); Object.assign(db.users.me, { name, photo: b.photo ?? null }); save(); return json(200, me()); }
    if (p[0] === "state") { const d = db.data.me; return json(200, { recipes: d.recipes, plan: d.plan, pantry: d.pantry, shop: d.shop }); }
    if (["recipes", "plan", "pantry", "shop"].includes(p[0]) && p[1]) {
      if (method === "PUT") db.data.me[p[0]][p[1]] = JSON.parse(body); else if (method === "DELETE") delete db.data.me[p[0]][p[1]]; else return err(405, "not_found", "no such route");
      save(); return json(204);
    }
    if (p[0] === "photos" && method === "POST") {
      const f = body && body.get && body.get("photo"); if (!f) return err(400, "no_photo", "no photo");
      const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      const id = hex(); photos[id] = url; if (!put(PKEY, photos)) { delete photos[id]; return err(413, "storage_full", "this device's storage for the preview is full"); }
      return json(201, { id });
    }
    if (p[0] === "people" && !p[1]) return json(200, named().map((u) => { const rs = Object.values(recipesOf(u.id)); return { ...person(u), recipes: rs.length, cooks: rs.reduce((n, r) => n + (r.cooks || []).length, 0) }; }));
    if (p[0] === "people" && p[1] && !p[2]) { const u = db.users[p[1]]; return u ? json(200, { person: person(u), recipes: recipesOf(u.id) }) : err(404, "not_found", "no such person"); }
    if (p[0] === "people" && p[2] === "recipes") { const u = db.users[p[1]], r = u && recipesOf(u.id)[p[3]]; return r ? json(200, { person: person(u), id: p[3], recipe: r }) : err(404, "not_found", "that recipe isn't there any more"); }
    if (p[0] === "copy") { const { owner, id } = JSON.parse(body || "{}"), u = db.users[owner], src = u && recipesOf(owner)[id];
      if (owner === ME) return err(400, "own_recipe", "that's already your recipe"); if (!src) return err(404, "not_found", "that recipe isn't there any more");
      const ex = copies().get(`${owner}/${id}`); if (ex) return json(200, { id: ex, recipe: recipesOf(ME)[ex], already: true });
      const now = new Date().toISOString(), copy = { ...src, copied_from: { owner, id, name: u.name, title: src.title }, cooks: [], created_at: now, updated_at: now }; delete copy.rating; delete copy.covers;
      const nid = hex().slice(0, 12); db.data.me.recipes[nid] = copy; save(); return json(201, { id: nid, recipe: copy, already: false }); }
    if (p[0] === "search") { const w = words(q.get("q") || ""); if (w.join("").length < 2) return err(400, "short_query", "type at least 2 letters"); const cp = copies(), hits = [];
      for (const u of named()) if (u.id !== ME) for (const [id, r] of Object.entries(recipesOf(u.id))) if (w.every((x) => hay(r).includes(x)))
        hits.push({ owner: u.id, name: u.name, photo: u.photo, id, title: r.title, cover: r.cover || null, firstPhoto: (r.photos || [])[0] || null, rating: Number.isInteger(r.rating) ? r.rating : null, prep_min: r.prep_min || 0, cook_min: r.cook_min || 0, servings: r.servings || null, copied: cp.get(`${u.id}/${id}`) || null });
      return json(200, hits); }
    if (p[0] === "feed") { const out = []; for (const u of named()) for (const [id, r] of Object.entries(recipesOf(u.id))) for (const c of r.cooks || []) if (c && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) out.push(feedEntry(u, id, r, c));
      out.sort((a, b) => `${b.date}|${b.at}`.localeCompare(`${a.date}|${a.at}`)); return json(200, { entries: out, next: null }); }
    if (p[0] === "fetch") { await sleep(700); const u = JSON.parse(body || "{}").url || "";
      if (/instagram\.com\/(?!(p|reels?|tv)\/)[^/]+\/?($|\?)/.test(u)) return json(422, { error: "that Instagram link isn't a post", code: "fetch_failed", source: "instagram", notPost: true });
      return json(200, { text: "Beef pepper rice. 300g thinly sliced beef, 2 cups cooked rice, 1 tbsp butter, 2 tbsp soy sauce, 1 cup corn, cracked black pepper. Pile the rice in a hot pan, beef around it, butter and pepper on top, soy over, mix after 2 minutes.", recipeJson: null, source: /instagram/.test(u) ? "instagram" : /tiktok/.test(u) ? "tiktok" : /youtu/.test(u) ? "youtube" : "web" }); }
    if (p[0] === "ai") { const b = JSON.parse(body || "{}"); if (!AI[b.kind]) return err(400, "bad_kind", "unknown AI job"); await sleep(b.kind === "cost" ? 300 : 1800); return json(200, { json: AI[b.kind](b.material || {}), allowance: { exempt: true } }); }
    if (p[0] === "cover") { await sleep(2500); const pool = Object.values(COVERS); return json(200, { id: pool[Math.floor(Math.random() * pool.length)], allowance: { exempt: true } }); }
    if (p[0] === "export") return err(404, "not_found", "Export isn't in the preview");
    if (p[0] === "admin") {
      if (p[1] === "summary") return json(200, summary());
      if (p[1] === "activity") return json(200, activity());
      if (p[1] === "audit") return json(200, ADMIN.audit || []);
      if (p[1] === "errors") return json(200, ADMIN.errors || []);
      if (method === "PUT") return json(200, { ok: true });
    }
    return err(404, "not_found", "not in the preview");
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.includes("/api/")) return realFetch(input, opts);
    if (opts.signal && opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
    await sleep(120);
    const path = url.pathname.slice(url.pathname.indexOf("/api/"));
    const stop = new Promise((_, rej) => opts.signal && opts.signal.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError"))));
    return Promise.race([route((opts.method || "GET").toUpperCase(), path, url.searchParams, opts.body), stop]);
  };
})();
