// "Scan fridge or pantry": a deliberately messy Claude reply (duplicates, capitals,
// an unknown aisle, a not-sure item, something already listed) must become a clean
// review list, and only ticked items are added.
import sharp from "sharp";
import { suite, startServer, openBrowser, openApp, sleep } from "./lib.mjs";

const { check, finish } = suite("pantry scan");
let s, b;
try {
  s = await startServer({ port: 18501, mock: true, env: { ANTHROPIC_API_KEY: "sk-ant-test" } });
  b = await openBrowser();
  const { page, errors } = b;
  const photo = async (c, name = "fridge.jpg") => ({ name, mimeType: "image/jpeg", buffer: await sharp({ create: { width: 3024, height: 4032, channels: 3, background: c } }).jpeg({ quality: 95 }).toBuffer() });
  const scan = async (files) => { const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#pantryScan")]); await fc.setFiles(files); };
  const pantry = async () => Object.values((await s.state()).pantry).map((p) => p.item).sort();
  await s.put("pantry", "p1", { id: "p1", item: "lemons", qty: 2, unit: "", aisle: "produce" });
  await openApp(page, s.url);
  await page.click('#tabs button[data-view="pantry"]');
  check("Pantry shows 'Scan fridge or pantry'", await page.locator("#pantryScan").isVisible());

  s.setMode({ claudeDelay: 800 }); s.clearLog();
  await scan([await photo("#ddd"), await photo("#ccc")]);
  check("scanning sheet with Stop", /Looking for food in 2 photos/.test(await page.textContent("#sheet")) && await page.locator('#sheet [data-act="stop"]').isVisible());
  await page.waitForSelector("#sheet .scanlist");
  check("both photos sent", /MOCK_SCAN images=2/.test(s.log()));
  const rows = await page.$$eval("#sheet .scanlist label.item", (ls) => ls.map((l) => ({ t: l.querySelector(".lbl").innerText.replace(/\s+/g, " ").trim(), on: l.querySelector("input").checked })));
  const get = (n) => rows.find((r) => r.t.includes(n));
  check("'Found 4 items' (duplicate and already-listed removed)", /Found 4 items/.test(await page.textContent("#sheet h3")));
  check("egg listed once with count 6, ticked", rows.filter((r) => /^(\d+ )?eggs? /.test(r.t)).length === 1 && get("egg").on && /^6 egg/.test(get("egg").t));
  check("'Greek Yoghurt' tidied to 'greek yoghurt', ticked", get("greek yoghurt") && get("greek yoghurt").on);
  check("unknown aisle replaced (soy sauce -> pantry)", get("soy sauce") && /pantry/.test(get("soy sauce").t));
  check("'not sure' item starts unticked", get("leftover curry") && !get("leftover curry").on && /not sure/.test(get("leftover curry").t));
  check("already listed (lemon vs lemons) shown, not offered", /Already on your list: lemon/.test(await page.textContent("#sheet")) && !get("lemon"));
  check("button counts ticked items", (await page.textContent('#sheet [data-act="add"]')) === "Add 3 items");
  await page.click('#sheet label.item:has-text("soy sauce")');
  check("unticking updates the count", (await page.textContent('#sheet [data-act="add"]')) === "Add 2 items");
  await page.click('#sheet label.item:has-text("leftover curry")');
  check("ticking a not-sure item updates the count", (await page.textContent('#sheet [data-act="add"]')) === "Add 3 items");
  await page.click('#sheet [data-act="add"]'); await sleep(500);
  check("adds exactly the ticked items, keeps existing", JSON.stringify(await pantry()) === JSON.stringify(["egg", "greek yoghurt", "leftover curry", "lemons"]), JSON.stringify(await pantry()));
  check("confirms how many were added", /Added 3 items to the pantry/.test(await page.textContent("#toast")));

  await scan([await photo("#eee")]); await page.waitForSelector("#sheet .scanlist");
  const again = await page.$$eval("#sheet .scanlist label.item .lbl", (ls) => ls.map((l) => l.innerText.split("\n")[0].trim()));
  check("rescan offers only what isn't listed yet (soy sauce)", JSON.stringify(again) === '["soy sauce"]', JSON.stringify(again));
  await page.click('#sheet [data-act="cancel"]');

  s.setMode({ scan: "empty" }); await scan([await photo("#eee")]); await page.waitForSelector("#scanStatus.err");
  check("no food found: helpful message", /Couldn't spot any food/.test(await page.textContent("#scanStatus")));
  await page.click('#sheet [data-act="stop"]');
  s.setMode({ claude: "529" }); await scan([await photo("#eee")]); await page.waitForSelector("#scanStatus.err");
  check("Claude overloaded: specific message", /overloaded/.test(await page.textContent("#scanStatus")));
  await page.click('#sheet [data-act="stop"]');

  s.setMode({ claudeDelay: 8000 }); s.clearLog(); const before = await pantry();
  await scan([await photo("#eee")]); await sleep(1200); await page.click('#sheet [data-act="stop"]'); await sleep(600);
  check("Stop: nothing added, Claude call cancelled", JSON.stringify(await pantry()) === JSON.stringify(before) && /MOCK: upstream aborted/.test(s.log()) && /Stopped\. Nothing was added/.test(await page.textContent("#toast")));

  s.setMode({}); s.clearLog(); const many = []; for (let i = 0; i < 8; i++) many.push(await photo("#eee", `p${i}.jpg`));
  await scan(many); await page.waitForSelector("#sheet .scanlist, #scanStatus.err");
  check("8 photos -> only the first 6 sent", /MOCK_SCAN images=6/.test(s.log()));
  await page.click('#sheet [data-act="cancel"], #sheet [data-act="stop"]');

  await page.evaluate(() => { store.online = false; }); await page.click("#pantryScan");
  check("offline: explains it needs the server", /Scanning needs the server/.test(await page.textContent("#toast")));
  check("no page errors", errors.length === 0, errors.join(" | "));
  finish();
} catch (e) { finish(e); } finally { await b?.browser.close(); await s?.cleanup(); }
