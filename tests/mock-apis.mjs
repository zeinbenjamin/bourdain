// Test-only stand-ins for api.anthropic.com and api.openai.com, loaded into the server
// with `node --import tests/mock-apis.mjs`. The mode is read from MOCK_FILE on every call
// ({"claude": "...", "image": "...", "scan": "...", "claudeDelay": ms, "imageDelay": ms, "cfCerts": "down", "cost": "junk"|"long", "dish": "nofood"|"unsure", "youtube": "nodesc", "instagram": "nocaption"|"json"|"json2"|"escaped"|"blocked-embed"|"preview-only"|"403"}), so one
// server can be driven through every failure. Requests are logged as MOCK_CLAUDE_REQ,
// MOCK_SCAN and MOCK_IMG_REQ so tests can check exactly what was sent.
import { readFileSync } from "node:fs";
import sharp from "sharp";
const real = globalThis.fetch;
const mode = () => { try { return JSON.parse(readFileSync(process.env.MOCK_FILE, "utf8")); } catch { return {}; } };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const wait = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); console.log("MOCK: upstream aborted"); rej(new DOMException("aborted", "AbortError")); }); });
const png = async (transparent) => (await sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${transparent ? "" : '<rect width="1024" height="1024" fill="#ffffff"/>'}<ellipse cx="512" cy="600" rx="380" ry="260" fill="#326891"/><ellipse cx="512" cy="470" rx="330" ry="120" fill="#e0a040"/></svg>`
)).png().toBuffer()).toString("base64");
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = mode();
  if (u.startsWith("https://api.anthropic.com")) {
    await wait(m.claudeDelay || 200, opts.signal);
    const body = JSON.parse(opts.body); const prompt = body.messages[0].content.at(-1).text;
    console.log("MOCK_CLAUDE_REQ", JSON.stringify({ model: body.model, max_tokens: body.max_tokens, images: body.messages[0].content.filter((c) => c.type === "image").length }));
    console.log("MOCK_CLAUDE_PROMPT " + JSON.stringify(prompt.slice(0, 80)) + " … " + JSON.stringify(prompt.slice(-160)));
    const usage = { input_tokens: 1000, output_tokens: 500 }; // like the real API; the server estimates cost from it
    switch (m.claude) {
      case "401": return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      case "404": return json(404, { type: "error", error: { type: "not_found_error", message: "model: claude-nope" } });
      case "529": return json(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
      case "credit": return json(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } });
      case "image": return json(400, { type: "error", error: { type: "invalid_request_error", message: "messages.0.content.0.image.source.base64: image exceeds 5 MB maximum" } });
      case "max_tokens": return json(200, { content: [{ type: "text", text: '{"title":"Half a' }], stop_reason: "max_tokens", usage });
      case "refusal": return json(200, { content: [], stop_reason: "refusal", usage });
    }
    if (/home fridge, freezer or pantry/.test(prompt)) {
      console.log("MOCK_SCAN images=" + body.messages[0].content.filter(c => c.type === "image").length);
      const items = m.scan === "empty" ? [] : [
        { item: "egg", qty: 6, unit: "", aisle: "dairy & eggs", sure: true },
        { item: "Greek Yoghurt", qty: null, unit: "", aisle: "dairy & eggs", sure: true },
        { item: "soy sauce", qty: null, unit: "", aisle: "condiments", sure: true },
        { item: "lemon", qty: 3, unit: "", aisle: "produce", sure: true },
        { item: "leftover curry", qty: null, unit: "", aisle: "other", sure: false },
        { item: "eggs", qty: 6, unit: "", aisle: "dairy & eggs", sure: true },
      ];
      return json(200, { content: [{ type: "text", text: "Here you go:\n" + JSON.stringify({ items }) }], stop_reason: "end_turn", usage });
    }
    if (/You estimate food costs/.test(prompt)) { // 2.5
      console.log("MOCK_COST " + JSON.stringify(prompt.slice(prompt.indexOf("RECIPE:"), prompt.indexOf("RECIPE:") + 60)));
      if (m.cost === "junk") return json(200, { content: [{ type: "text", text: '{"course":"main","home_total":"cheap"}' }], stop_reason: "end_turn", usage });
      // 2.7.10: a wordier model's estimate needs ~900 tokens; under a lower max_tokens it's cut off, as Claude does
      if (m.cost === "long" && body.max_tokens < 900) return json(200, { content: [{ type: "text", text: '{"course":"main","comparable":"Beef rendang with rice","home_total":42,"casual_per_serve":22,"basis":"Mostly the beef, which at' }], stop_reason: "max_tokens", usage: { input_tokens: 1000, output_tokens: body.max_tokens } });
      return json(200, { content: [{ type: "text", text: JSON.stringify({ course: "main", comparable: "Beef rendang with rice", home_total: 42, casual_per_serve: 22, basis: "Mostly the beef." }) }], stop_reason: "end_turn", usage });
    }
    if (/photo of a finished dish/.test(prompt)) { // 2.5
      console.log("MOCK_DISH images=" + body.messages[0].content.filter((c) => c.type === "image").length);
      if (m.dish === "nofood") return json(200, { content: [{ type: "text", text: '{"error":"no dish"}' }], stop_reason: "end_turn", usage });
      return json(200, { content: [{ type: "text", text: JSON.stringify({ title: "Afghan mantu", description: "Dumplings with yoghurt and spiced tomato.", servings: 2, prep_min: 40, cook_min: 20,
        ingredients: [{ raw_text: "250 g beef mince", quantity: 250, unit: "g", item: "beef mince", prep: "", section: "", aisle: "meat & seafood", optional: false }, { raw_text: "a drizzle of chilli oil", quantity: null, unit: "drizzle", item: "chilli oil", prep: "", section: "", aisle: "condiments", optional: false }],
        steps: ["Fill and fold the dumplings.", "Steam for 15 minutes."], tags: ["afghan"], notes: "Guessed from a photo.",
        guess: { dish: "Afghan mantu", cuisine: "Afghan", confidence: m.dish === "unsure" ? 30 : 62, alternatives: ["Turkish manti", "Shish barak"], basis: "Folded dumplings under yoghurt and a red sauce." } }) }], stop_reason: "end_turn", usage });
    }
    if (/Suggest 3 different dishes/.test(prompt)) {
      return json(200, { content: [{ type: "text", text: JSON.stringify([{ title: "Lemon rice", why: "Bright and quick.", missing: [] }, { title: "Egg fried rice", why: "Uses the eggs.", missing: ["spring onion"] }, { title: "Shakshuka", why: "Eggs in sauce.", missing: ["tinned tomato"] }]) }], stop_reason: "end_turn", usage });
    }
    const text = /Describe what this finished dish/.test(prompt)
      ? "Glazed chicken pieces over soft scrambled egg and rice, topped with shredded nori, in a blue-and-white donburi bowl."
      : '{"title":"Mock donburi","servings":2,"ingredients":[{"raw_text":"2 chicken thighs","quantity":2,"unit":"whole","item":"chicken thigh","aisle":"meat & seafood"}],"steps":["Cook it."],"tags":["japanese"]}';
    return json(200, { content: [{ type: "text", text }], stop_reason: "end_turn", usage });
  }
  if (/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\/cdn-cgi\/access\/certs$/.test(u)) { // the team's signing keys (2.3)
    console.log("MOCK_CF_CERTS " + u);
    if (m.cfCerts === "down") return json(503, { error: "unavailable" });
    return new Response(process.env.MOCK_CF_JWKS || '{"keys":[]}', { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.startsWith("https://www.youtube.com/")) { // 2.5: oEmbed and the watch page
    console.log("MOCK_YOUTUBE " + u.slice(0, 90));
    if (u.includes("/oembed")) return json(200, { title: "Easy beef rendang", author_name: "Kitchen Channel" });
    const desc = m.youtube === "nodesc" ? "" : "Beef rendang\n\n1kg beef chuck\n400ml coconut milk\n2 stalks lemongrass\n\nBrown the beef, add the paste and coconut milk, simmer 2 hours.";
    return new Response(`<html><head><meta name="description" content="Short meta &#x1f957; it&rsquo;s &quot;quick&quot;"></head><body><script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abcdefghijk","shortDescription":${JSON.stringify(desc)}}};</script></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (u.startsWith("https://www.instagram.com/")) { // 2.7.4: a post's embed page, shaped like the real one
    console.log("MOCK_INSTAGRAM " + (opts.method || "GET") + " " + u.slice(0, 90));
    // 2.7.7: what the NAS was sent: Instagram's error page instead of the embed; then the post query and the link preview
    const errorPage = () => new Response(`<html><head><title>Instagram</title></head><body><script type="application/json">{"canonicalRouteName":"comet.igweb.PolarisErrorRoute","url":"\\/p\\/x\\/embed\\/captioned\\/"}</script></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    if (u.includes("/graphql/")) {
      if (m.instagram === "blocked-embed") return json(200, { data: { xdt_shortcode_media: { owner: { username: "iramsfoodstory" }, edge_media_to_caption: { edges: [{ node: { text: "Crispy chipotle beef tacos \u{1f32e}\n\n2 lb ground beef\n1 tbsp taco seasoning" } }] } } } });
      return json(401, { message: "Please wait a few minutes before you try again.", status: "fail" });
    }
    if (!u.includes("/embed/")) { // the post's own page
      if (m.instagram === "preview-cut" && /facebookexternalhit/.test(opts.headers?.["user-agent"] || ""))
        return new Response(`<html><head><meta property="og:description" content="12 likes - iramsfoodstory on September 12, 2026: &quot;Crispy chipotle beef tacos&#10;&#10;2 lb ground beef&#10;1 tbsp taco…&quot;. " /></head></html>`, { status: 200, headers: { "content-type": "text/html" } });
      if (m.instagram === "preview-only" && /facebookexternalhit/.test(opts.headers?.["user-agent"] || ""))
        return new Response(`<html><head><meta property="og:description" content="1,619,905 likes, 1,399 comments - iramsfoodstory on September 12, 2026: &quot;Crispy chipotle beef tacos chipotle lime crema &#x1f32e;&#10;&#10;2 lb ground beef&#10;1 tbsp taco seasoning&quot;. " /></head><body></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
      return errorPage();
    }
    if (["blocked-embed", "preview-only", "preview-cut"].includes(m.instagram)) return errorPage();
    if (m.instagram === "reel404" && u.includes("/reel/")) return new Response("Not found", { status: 404 });
    if (m.instagram === "escaped") { // 2.7.6: the caption block as a string inside a script, drawn by the page's own JS (as Instagram sent for Dct0lIPyvQJ)
      const block = '<div class="Caption"><span>iramsfoodstory</span><br/><br/>Crispy chipotle beef tacos chipotle lime crema \u{1f32e} <br/><br/>Ingredients <br/><br/>For the taco seasoning:<br/><br/>1 tbsp red chili powder <br/>2 tbsp garlic powder <br/><br/>Method:<br/>Mix it all.<div class="CaptionComments"><a href="#">View all 1,399 comments</a></div></div>';
      return new Response(`<html><body><div class="EmbedFrame"></div><script>__d("EmbedCaption",[],function(){return {"html":${JSON.stringify(block).replace(/</g, "\\u003C").replace(/\//g, "\\/")}};});</script></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (m.instagram === "json2") { // the caption only in the post's data, as a JSON string inside a script's JSON string
      const ctx = JSON.stringify({ context: { media: { owner: { username: "iramsfoodstory" }, edge_media_to_caption: { edges: [{ node: { text: "Crispy chipotle beef tacos \u{1f32e}\n\n2 lb ground beef\n1 tbsp taco seasoning" } }] } } } });
      return new Response(`<html><body><div class="Embed"></div><script>requireLazy(["EmbedSDK"],function(e){e.init(${JSON.stringify(JSON.stringify({ contextJSON: ctx }))})});</script></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (m.instagram === "403") return new Response("<html>Please wait a few minutes</html>", { status: 403, headers: { "content-type": "text/html" } });
    const head = `<html><body><div class="Header"><span class="UsernameText">iramsfoodstory</span></div>`;
    if (m.instagram === "nocaption") return new Response(head + `<div class="Embed">View this post on Instagram</div></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    if (m.instagram === "json") return new Response(head + `<script>window.__additionalDataLoaded("extra",{"shortcode_media":{"owner":{"id":"1","username":"iramsfoodstory"},"edge_media_to_caption":{"edges":[{"node":{"text":"Garlic rolls \\ud83c\\udf2f\\n\\n2 lb chicken breast\\n1 tbsp butter"}}]}}});</script></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    return new Response(head + `<div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/iramsfoodstory/" target="_blank">iramsfoodstory</a><br/><br/>Crispy garlic parmesan chicken rolls &#x1f32f; <br/><br/>Ingredients <br/><br/>2 lb boneless chicken breast<br/>1 tbsp butter<br/>1 1/2 cup heavy cream<br/><br/>Method:<br/>Cook the chicken. Make the sauce &amp; roll.<br/><br/><a href="/explore/tags/recipe/">#recipe</a><div class="CaptionComments"><a class="CaptionCommentsExpand" href="#">View all 883 comments</a></div></div></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (u.startsWith("https://api.openai.com")) {
    const body = JSON.parse(opts.body);
    console.log("MOCK_IMG_REQ " + u + " " + JSON.stringify({ ...body, prompt: body.prompt.slice(0, 60) + "…" + body.prompt.slice(-50) }) + " auth=" + (opts.headers.authorization || "").slice(0, 10));
    await wait(m.imageDelay || 200, opts.signal);
    switch (m.image) {
      case "401": return json(401, { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } });
      case "quota": return json(429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } });
      case "moderation": return json(400, { error: { message: "Your request was rejected by the safety system.", type: "image_generation_user_error", code: "moderation_blocked" } });
      case "no_transparent": if (body.background === "transparent") return json(400, { error: { message: "Transparent background is not supported for this model.", type: "invalid_request_error", param: "background" } });
    }
    return json(200, { created: 1, background: body.background, output_format: "png", data: [{ b64_json: await png(body.background === "transparent") }] });
  }
  return real(url, opts);
};
