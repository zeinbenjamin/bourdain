// Renders the welcome page's link-preview picture (tools/welcome/og.html) to public/welcome/og.png,
// 1200 x 630, and the square logo for Cloudflare's sign-in page to public/welcome/logo.png.
// Run after changing og.html: node tools/welcome/render.mjs (uses the Playwright dev dependency).
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), out = path.join(here, "../../public/welcome");
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined; // the fonts come from Google
const browser = await chromium.launch({ proxy });
let page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto("file://" + path.join(here, "og.html"));
await page.evaluate(() => document.fonts.ready);
const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
if (!loaded.some((f) => /Source Serif/.test(f))) { console.error("The fonts didn't load (no network to Google Fonts?), so the picture would be in fallback fonts. Nothing written."); await browser.close(); process.exit(1); }
await page.screenshot({ path: path.join(out, "og.png") });
page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.goto("file://" + path.join(here, "../../public/icon.svg"));
await page.screenshot({ path: path.join(out, "logo.png") });
await browser.close();
console.log("wrote public/welcome/og.png and logo.png");
