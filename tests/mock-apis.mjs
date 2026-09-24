// Test-only stand-ins for api.anthropic.com and api.openai.com, loaded into the server
// with `node --import tests/mock-apis.mjs`. The mode is read from MOCK_FILE on every call
// ({"claude": "...", "image": "...", "scan": "...", "claudeDelay": ms, "imageDelay": ms}), so one
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
    console.log("MOCK_CLAUDE_REQ", JSON.stringify({ model: body.model, max_tokens: body.max_tokens }));
    switch (m.claude) {
      case "401": return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      case "404": return json(404, { type: "error", error: { type: "not_found_error", message: "model: claude-nope" } });
      case "529": return json(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
      case "credit": return json(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } });
      case "image": return json(400, { type: "error", error: { type: "invalid_request_error", message: "messages.0.content.0.image.source.base64: image exceeds 5 MB maximum" } });
      case "max_tokens": return json(200, { content: [{ type: "text", text: '{"title":"Half a' }], stop_reason: "max_tokens" });
      case "refusal": return json(200, { content: [], stop_reason: "refusal" });
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
      return json(200, { content: [{ type: "text", text: "Here you go:\n" + JSON.stringify({ items }) }], stop_reason: "end_turn" });
    }
    const text = /Describe what this finished dish/.test(prompt)
      ? "Glazed chicken pieces over soft scrambled egg and rice, topped with shredded nori, in a blue-and-white donburi bowl."
      : '{"title":"Mock donburi","servings":2,"ingredients":[{"raw_text":"2 chicken thighs","quantity":2,"unit":"whole","item":"chicken thigh","aisle":"meat & seafood"}],"steps":["Cook it."],"tags":["japanese"]}';
    return json(200, { content: [{ type: "text", text }], stop_reason: "end_turn" });
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
