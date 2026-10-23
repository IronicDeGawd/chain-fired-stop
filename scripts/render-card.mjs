// Renders the board replaying a saved run into a clip for the video edit:
// frame-stepped (deterministic), board only on a transparent background.
//   node scripts/render-card.mjs runs/<run>.json [outDir]
// Needs the board server running (node server.mjs). Outputs:
//   card-alpha.mov (ProRes 4444 + alpha), card-alpha.webm (VP9 + alpha),
//   card.mp4 (H.264 on a plain background), final-frame.png
import { chromium } from "playwright";
import { mkdir, rm, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";

const run = process.argv[2];
if (!run) throw new Error("usage: node scripts/render-card.mjs runs/<run>.json [outDir]");
const out = process.argv[3] || "out/card";
const frames = join(out, "frames");
const PORT = process.env.PORT || 8810;
const FPS = 30;

await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1228, height: 1200 }, deviceScaleFactor: 2 });
const FFX = process.env.FFX || 10;
const WIDE = process.env.FF_WIDE === "1" ? "&ffwide=1" : "";
const CUES = process.env.CUES ? `&cues=${encodeURIComponent(process.env.CUES)}` : "";
await page.goto(`http://localhost:${PORT}/?replay=/runs/${basename(run)}&render=1&ffx=${FFX}${WIDE}${CUES}`);
await page.waitForFunction(() => document.fonts.status === "loaded");
const board = page.locator(".wrap");

let n = 0;
for (;;) {
  await board.screenshot({ path: join(frames, `f${String(n++).padStart(5, "0")}.png`), omitBackground: true });
  if (await page.evaluate(() => window.__finished)) break;
  await page.evaluate(() => new Promise((r) => {
    // step once; if the page has not asked for a frame yet, wait for it to
    const tryStep = () => (window.__step() ? r() : setTimeout(tryStep, 2));
    tryStep();
  }));
  if (n % 300 === 0) console.log(`${n} frames (${(n / FPS).toFixed(0)} s)`);
}
const marks = await page.evaluate(() => window.__marks);
await browser.close();
console.log(`${n} frames, ${(n / FPS).toFixed(1)} s`);
for (const m of marks) if (!["poll", "tick", "mark"].includes(m.kind)) console.log(`  ${(m.frame / FPS).toFixed(2)} s  ${m.lane} ${m.kind}`);

const input = ["-y", "-framerate", String(FPS), "-i", join(frames, "f%05d.png")];
const even = "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=0x00000000";
execFileSync("ffmpeg", [...input, "-vf", even, "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", join(out, "card-alpha.mov")], { stdio: "inherit" });
execFileSync("ffmpeg", [...input, "-vf", even, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", join(out, "card-alpha.webm")], { stdio: "inherit" });
if (process.env.SKIP_MP4 !== "1") execFileSync("ffmpeg", [...input, "-filter_complex", `color=c=0xe4e2da:s=2600x1900:r=${FPS}[bg];[bg][0:v]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p`, "-c:v", "libx264", "-crf", "18", join(out, "card.mp4")], { stdio: "inherit" });
await copyFile(join(frames, `f${String(n - 1).padStart(5, "0")}.png`), join(out, "final-frame.png"));
console.log(`wrote ${out}/card-alpha.mov, card-alpha.webm, card.mp4, final-frame.png`);
