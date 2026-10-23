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

const PUBLISHED = process.env.PUBLISHED || "2026-10-23";
const DESC = "My bot held the stop-loss and went offline. The chain sold by itself. A live comparison on Somnia Tokyo testnet.";
const CARD_ALT = "Who closed the position? A bot's stop and a chain-held stop side by side: the bot went 162 s unprotected, the chain closed the position.";
const ld = {
  "@context": "https://schema.org", "@type": "Article",
  headline: "Who closed the position?", description: DESC, image: `${SITE_URL}/og.png`,
  datePublished: PUBLISHED, mainEntityOfPage: `${SITE_URL}/`,
  author: { "@type": "Person", name: "Aditya", url: "https://x.com/0xironyAditya" },
};
const meta = `
<meta name="description" content="${DESC}">
<meta name="author" content="Aditya (@0xironyAditya)">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#f6f5f1">
<link rel="canonical" href="${SITE_URL}/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ironyaditya.xyz">
<meta property="og:title" content="Who closed the position?">
<meta property="og:description" content="My bot held the stop-loss and went offline. The chain sold by itself, with nobody signing.">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:image:secure_url" content="${SITE_URL}/og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${CARD_ALT}">
<meta property="og:locale" content="en_US">
<meta property="article:published_time" content="${PUBLISHED}">
<meta property="article:author" content="https://x.com/0xironyAditya">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@0xironyAditya">
<meta name="twitter:creator" content="@0xironyAditya">
<meta name="twitter:title" content="Who closed the position?">
<meta name="twitter:description" content="My bot held the stop-loss and went offline. The chain sold by itself.">
<meta name="twitter:image" content="${SITE_URL}/og.png">
<meta name="twitter:image:alt" content="${CARD_ALT}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
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
