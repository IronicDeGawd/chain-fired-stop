// Builds the write-up's images in site/: the share card (og.png, rendered
// from site/og.html) and the hero image (demo.jpg, the board's last frame
// from a render, flattened onto the page background).
//   node scripts/build-site.mjs [out/card-take1-loss/final-frame.png]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const frame = process.argv[2] || "out/card-take1-loss/final-frame.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto("file://" + resolve("site/og.html"));
await page.screenshot({ path: "site/og.png" });
await browser.close();

// The board's header (title, clock, Run again button) is cropped off: the
// article has its own title, and a button in a picture invites a click.
const HEADER = Number(process.env.HEADER_PX || 262);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", frame,
  "-filter_complex", `color=c=0x070707:s=2400x1810[bg];[0]crop=iw:ih-${HEADER}:0:${HEADER}[b];[bg][b]overlay=(W-w)/2:(H-h)/2:shortest=1,crop=2400:1810-${HEADER}:0:${HEADER / 2},scale=1600:-2`,
  "-frames:v", "1", "-q:v", "3", "site/demo.jpg"]);
console.log("site/ images built: og.png, demo.jpg");
