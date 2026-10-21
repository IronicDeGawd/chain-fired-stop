// Builds the static site in site/: the board in replay mode (no server, no
// keys) with the write-up, a featured run, the share card and the clip.
//   node scripts/build-site.mjs runs/<run>.json   (board server must be running for og.png)
import { chromium } from "playwright";
import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";

const run = process.argv[2];
if (!run) throw new Error("usage: node scripts/build-site.mjs runs/<run>.json");
const SITE_URL = process.env.SITE_URL || "https://chain-stop.ironyaditya.xyz";
const PORT = process.env.PORT || 8810;

await mkdir("site/runs", { recursive: true });
await copyFile(run, "site/runs/featured.json");
await copyFile("public/favicon.svg", "site/favicon.svg");

const meta = `
<meta name="description" content="My bot held the stop-loss and went offline. The chain sold by itself. A live comparison on Somnia Tokyo testnet.">
<meta property="og:type" content="article">
<meta property="og:title" content="Who closed the position?">
<meta property="og:description" content="My bot held the stop-loss and went offline. The chain sold by itself, with nobody signing.">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Who closed the position?">
<meta name="twitter:description" content="My bot held the stop-loss and went offline. The chain sold by itself.">
<meta name="twitter:image" content="${SITE_URL}/og.png">
<script>window.REPLAY = "runs/featured.json";</script>`;
const html = (await readFile("public/index.html", "utf8")).replace("</title>", `</title>${meta}`);
await writeFile("site/index.html", html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`http://localhost:${PORT}/og.html`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "site/og.png" });
await browser.close();

try { await access("out/card/card-alpha.webm"); await copyFile("out/card/card.mp4", "site/clip.mp4"); } catch {}
console.log("site/ built: index.html, runs/featured.json, og.png, favicon.svg" + " (+ clip.mp4 if rendered)");
