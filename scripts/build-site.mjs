// Builds the write-up's images in site/: the share card (og.png, rendered
// from site/og.html) and the hero image (demo.jpg, the board's last frame
// from a render, flattened onto the page's paper background).
//   node scripts/build-site.mjs [out/card-take1-loss/final-frame.png]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const frame = process.argv[2] || "out/card-take1-loss/final-frame.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto("file://" + resolve("site/og.html"), { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "site/og.png" });
await browser.close();

// The board's header (title, clock, Run again button) is cropped off: the
// article has its own title, and a button in a picture invites a click.
// FOOTER_PX trims the bottom too (the price trace), for a run whose trace
// has nothing to show by the end.
const HEADER = Number(process.env.HEADER_PX || 262);
const FOOTER = Number(process.env.FOOTER_PX || 0);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", frame,
  "-filter_complex", `[0]crop=iw:ih-${HEADER + FOOTER}:0:${HEADER},pad=iw+40:ih+40:20:20:color=0xf6f5f1,scale=1600:-2`,
  "-frames:v", "1", "-q:v", "3", "site/demo.jpg"]);
console.log("site/ images built: og.png, demo.jpg");
