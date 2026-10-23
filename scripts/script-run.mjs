// Turns a recorded run into a scripted one for the film: every event keeps
// its recorded time, but the price path after the bot's cut is written by
// hand (a slide to the stop, then a crash with no bounce), the size is 1 ETH
// and all transaction hashes are dropped, because these prices never traded.
//   node scripts/script-run.mjs runs/<run>.json runs/scripted-loss.json
import { readFile, writeFile } from "node:fs/promises";

const [src, dst] = process.argv.slice(2);
if (!src || !dst) throw new Error("usage: node scripts/script-run.mjs runs/<run>.json <out>.json");
const run = JSON.parse(await readFile(src, "utf8"));

const CHAIN_SELL = 2461.80; // the chain's next check, just under the stop
const BOT_SELL = 2418.10;   // where the bot finally sells after reconnecting

const ev = [...run.events].sort((a, b) => a.ms - b.ms).map(({ tx, block, from, ...e }) => e);
const cut = ev.find((e) => e.kind === "offline");
// The price reaches the stop on the first mark after the chain's last
// "above stop" check, so no check ever reads a price under the stop.
const lastTick = ev.filter((e) => e.kind === "tick").at(-1);
const crossed = ev.find((e) => e.lane === "price" && e.ms > lastTick.ms);
const fired = ev.find((e) => e.kind === "fired");
const closed = ev.find((e) => e.kind === "closed" && e.lane === "bot");
const startPrice = [...ev].reverse().find((e) => e.ms < cut.ms && e.price !== undefined).price;

// Small fixed wobble so the line is not a ruler, never enough to bounce.
const wobble = (ms) => 0.06 * Math.sin(ms / 1700) + 0.04 * Math.sin(ms / 610);
const path = (ms) => {
  if (ms < crossed.ms) { // slide from the cut down to just above the stop
    const u = (ms - cut.ms) / (crossed.ms - cut.ms);
    return Math.max(run.stop + 0.03, startPrice + (run.stop + 0.08 - startPrice) * u + wobble(ms) * (1 - u));
  }
  if (ms <= fired.ms) { // through the stop, gently, until the chain's check
    const u = (ms - crossed.ms) / (fired.ms - crossed.ms);
    return run.stop - 0.05 + (CHAIN_SELL - (run.stop - 0.05)) * u;
  }
  const u = Math.min(1, (ms - fired.ms) / (closed.ms - fired.ms)); // the crash
  return CHAIN_SELL - (CHAIN_SELL - BOT_SELL) * Math.pow(u, 1.4);
};

const out = [];
for (const e of ev) {
  if (e.ms > cut.ms && (e.lane === "price" || e.kind === "tick")) e.price = path(e.ms);
  if (e === fired) e.price = CHAIN_SELL;
  if (e === closed) {
    // the recorded marks stop at the chain's sale: add one a second until the bot sells
    const lastMark = out.filter((x) => x.lane === "price").at(-1).ms;
    for (let ms = lastMark + 1000; ms < closed.ms; ms += 1000) out.push({ lane: "price", kind: "mark", ms, price: path(ms) });
    out.push({ lane: "price", kind: "mark", ms: closed.ms, price: BOT_SELL });
    e.price = BOT_SELL;
  }
  out.push(e);
}

// Prices only fall from the cut onward.
let low = Infinity;
for (const e of out) if (e.ms > crossed.ms && e.price !== undefined) {
  if (e.price > low + 1e-9) throw new Error(`price bounced at ${e.ms} ms`);
  low = e.price;
}

const { tx, block, from, ...chain } = run.chain;
const scripted = {
  ...run,
  scripted: true,
  note: "Scripted price path for the film: event times are from the recorded run, prices after the cut are not.",
  settings: { ...run.settings, quantity: 1 },
  chain: { ...chain, price: CHAIN_SELL },
  bot: { exit: BOT_SELL, belowStop: Number((run.stop - BOT_SELL).toFixed(2)) },
  result: `chain sold just under the stop; the bot sold ${(run.stop - BOT_SELL).toFixed(2)} below it`,
  events: out,
};
await writeFile(dst, JSON.stringify(scripted, null, 2) + "\n");
console.log(`wrote ${dst}: ${out.length} events, chain P&L ${(CHAIN_SELL - run.entry.chain).toFixed(2)}, bot P&L ${(BOT_SELL - run.entry.bot).toFixed(2)}`);
