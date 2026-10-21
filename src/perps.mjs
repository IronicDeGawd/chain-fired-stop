// Shared perp reads and order helpers. Prices are 18-decimal USDso per ETH.
import { pub, ADDR, MARKET, abi } from "./config.mjs";

export const usd = (wei) => Number(wei) / 1e18;

export async function mark() {
  return pub.readContract({ address: ADDR.pool, abi: abi.pool, functionName: "getMarkPrice" });
}

export async function position(account) {
  const [size, entry] = await pub.readContract({
    address: ADDR.bank, abi: abi.bank, functionName: "getPosition", args: [account, ADDR.pool],
  });
  return { size, entry };
}

// Tick-aligned limit price `pct` percent through the mark, up for buys, down for sells.
export function through(markPrice, isBid, pct = 1n) {
  const raw = isBid ? markPrice * (100n + pct) / 100n : markPrice * (100n - pct) / 100n;
  return isBid ? (raw + MARKET.tick - 1n) / MARKET.tick * MARKET.tick : raw / MARKET.tick * MARKET.tick;
}

// Wait for a receipt and fail loudly on a reverted transaction.
export async function confirmed(hash) {
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return r;
}
