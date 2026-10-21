// Bot lane. An ordinary script holds the stop: it polls the mark price and
// would sell at the stop. The demo cuts its connection after `botDiesAtMs`,
// then lets it reconnect and sell once the chain lane has fired.
import { wallet, ADDR, SETTINGS, ORDER_GAS, FAR_EXPIRY_NS, IOC, abi } from "./config.mjs";
import { mark, position, through, confirmed, usd } from "./perps.mjs";

async function sell(size) {
  const w = wallet();
  const hash = await w.writeContract({
    address: ADDR.pool, abi: abi.pool, functionName: "placeOrder",
    args: [false, 0n, through(await mark(), false, 2n), size, FAR_EXPIRY_NS, IOC, 0, "0x0000000000000000000000000000000000000000", 0n],
    gas: ORDER_GAS,
  });
  await confirmed(hash);
  return hash;
}

export async function openBotLane(emit, t0) {
  const w = wallet();
  const hash = await w.writeContract({
    address: ADDR.pool, abi: abi.pool, functionName: "placeOrder",
    args: [true, 0n, through(await mark(), true), SETTINGS.quantity, FAR_EXPIRY_NS, IOC, 0, "0x0000000000000000000000000000000000000000", 0n],
    gas: ORDER_GAS,
  });
  await confirmed(hash);
  const { size, entry } = await position(w.account.address);
  if (size <= 0n) throw new Error("bot lane: open did not fill");
  emit({ lane: "bot", kind: "open", ms: Date.now() - t0, price: usd(entry), tx: hash });
  return { entry };
}

// Polls until the stop is hit (it sells) or the demo cuts it (it goes quiet).
export async function runBotWatcher(stop, armedAt, emit, t0) {
  for (;;) {
    const ms = Date.now() - t0;
    if (ms - armedAt >= SETTINGS.botDiesAtMs) {
      emit({ lane: "bot", kind: "offline", ms });
      return { closed: false };
    }
    const m = await mark();
    emit({ lane: "bot", kind: "poll", ms: Date.now() - t0, price: usd(m), hit: m <= stop });
    if (m <= stop) {
      const { size } = await position(wallet().account.address);
      const tx = await sell(size);
      emit({ lane: "bot", kind: "closed", ms: Date.now() - t0, price: usd(m), tx, online: true });
      return { closed: true };
    }
    await new Promise((r) => setTimeout(r, SETTINGS.botPollMs));
  }
}

// The bot comes back, finds its position still open, and sells at market.
export async function reconnectBot(emit, t0) {
  emit({ lane: "bot", kind: "reconnected", ms: Date.now() - t0 });
  const { size } = await position(wallet().account.address);
  if (size <= 0n) return null;
  const m = await mark();
  const tx = await sell(size);
  emit({ lane: "bot", kind: "closed", ms: Date.now() - t0, price: usd(m), tx, online: false });
  return usd(m);
}
