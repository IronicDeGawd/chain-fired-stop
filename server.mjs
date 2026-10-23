// The board server. One Start press runs both lanes live on Somnia Tokyo
// testnet and streams every event over Server-Sent Events. Each run is saved
// as a JSON timeline under runs/. The key stays here; the page only gets events.
//   node server.mjs   →  http://localhost:8810
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { ADDR, SETTINGS, MARKET, pub, account } from "./src/config.mjs";
import { mark, usd, through } from "./src/perps.mjs";
import { sendChainOpen, chainOpened, armChainLane, watchChainLane, flattenChainLane } from "./src/chain.mjs";
import { sendBotOpen, botOpened, runBotWatcher, reconnectBot } from "./src/bot.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dir, "public");
const RUNS = join(__dir, "runs");
const PORT = Number(process.env.PORT || 8810);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

let running = false;

async function handleRun(res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  if (running) { res.end(`event: error\ndata: ${JSON.stringify({ message: "a run is already in progress" })}\n\n`); return; }
  running = true;

  const t0 = Date.now();
  const events = [];
  const emit = (e) => { events.push(e); res.write(`event: tick\ndata: ${JSON.stringify(e)}\n\n`); };
  const run = { t0, date: new Date(t0).toISOString(), market: `${MARKET.symbol}-PERP`, contract: ADDR.chainStop, settings: {
    quantity: Number(SETTINGS.quantity) / 1e18, stopOffset: usd(SETTINGS.stopOffset), botPollMs: SETTINGS.botPollMs,
    botDiesAtMs: SETTINGS.botDiesAtMs, reconnectAfterMs: SETTINGS.reconnectAfterMs,
  } };
  const abort = new AbortController();
  const cap = setTimeout(() => abort.abort(), SETTINGS.maxRunMs);
  let feed;

  try {
    // One key signs both opens: consecutive nonces, sent back to back at one
    // limit price, so both lanes open in the same block at the same price.
    const limit = through(await mark(), true);
    const nonce = await pub.getTransactionCount({ address: account().address, blockTag: "pending" });
    const botTx = await sendBotOpen(limit, nonce);
    const chainTx = await sendChainOpen(limit, nonce + 1);
    const [bot, chain] = await Promise.all([botOpened(botTx, emit, t0), chainOpened(chainTx, emit, t0)]);
    const stop = (await mark()) - SETTINGS.stopOffset;
    run.stop = usd(stop);
    run.entry = { bot: usd(bot.entry), chain: usd(chain.entry) };

    const fromBlock = await armChainLane(stop, emit, t0);
    const armedAt = Date.now() - t0;
    emit({ lane: "bot", kind: "armed", ms: armedAt, stop: usd(stop) });

    // A read-only price line for the board. It never trades.
    feed = setInterval(async () => {
      try { emit({ lane: "price", kind: "mark", ms: Date.now() - t0, price: usd(await mark()) }); } catch {}
    }, 1000);

    const [botResult, chainResult] = await Promise.all([
      runBotWatcher(stop, armedAt, emit, t0),
      watchChainLane(fromBlock, emit, t0, abort.signal),
    ]);
    clearInterval(feed);
    run.chain = chainResult;

    if (botResult.closed) {
      run.result = "bot closed before it went offline";
    } else if (chainResult.fired) {
      await new Promise((r) => setTimeout(r, SETTINGS.reconnectAfterMs));
      const exit = await reconnectBot(emit, t0);
      run.bot = { exit, belowStop: exit === null ? null : +(run.stop - exit).toFixed(2) };
      run.result = "chain fired, bot was offline";
    } else {
      await flattenChainLane();
      await reconnectBot(emit, t0);
      run.result = `no cross: ${chainResult.reason}`;
    }
  } catch (err) {
    clearInterval(feed);
    run.error = String(err?.message || err);
    emit({ lane: "system", kind: "error", ms: Date.now() - t0, message: run.error });
  } finally {
    clearTimeout(cap);
    run.events = events;
    res.write(`event: done\ndata: ${JSON.stringify(run)}\n\n`);
    res.end();
    running = false;
    try {
      await mkdir(RUNS, { recursive: true });
      await writeFile(join(RUNS, `run-${t0}.json`), JSON.stringify(run, null, 2));
    } catch {}
  }
}

async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  const base = path.startsWith("/runs/") ? RUNS : PUBLIC;
  const rel = path.startsWith("/runs/") ? path.slice("/runs".length) : path;
  if (rel.includes("..")) { res.writeHead(400); return res.end(); }
  try {
    const body = await readFile(join(base, rel));
    res.writeHead(200, { "content-type": MIME[extname(rel)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}

createServer((req, res) => {
  if (req.url === "/run") return handleRun(res);
  return serveStatic(req, res);
}).listen(PORT, "127.0.0.1", () => console.log(`board on http://localhost:${PORT}`));
