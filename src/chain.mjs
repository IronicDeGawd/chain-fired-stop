// Chain lane. The ChainStop contract holds the position and the stop. After
// `arm`, nothing here acts: the server only watches the contract's events while
// Somnia wakes it every 5 s and, at the stop, the contract sells by itself.
import { decodeEventLog } from "viem";
import { pub, wallet, ADDR, SETTINGS, ORDER_GAS, abi } from "./config.mjs";
import { mark, position, through, confirmed, usd } from "./perps.mjs";

export async function openChainLane(emit, t0) {
  const w = wallet();
  const m = await mark();
  const hash = await w.writeContract({
    address: ADDR.chainStop, abi: abi.chainStop, functionName: "openLong",
    args: [SETTINGS.quantity, through(m, true)], gas: ORDER_GAS,
  });
  await confirmed(hash);
  const { size, entry } = await position(ADDR.chainStop);
  if (size <= 0n) throw new Error("chain lane: open did not fill");
  emit({ lane: "chain", kind: "open", ms: Date.now() - t0, price: usd(entry), tx: hash });
  return { entry };
}

export async function armChainLane(stop, emit, t0) {
  const w = wallet();
  const hash = await w.writeContract({
    address: ADDR.chainStop, abi: abi.chainStop, functionName: "arm",
    args: [stop, SETTINGS.maxTicks], gas: 5_000_000n,
  });
  const r = await confirmed(hash);
  emit({ lane: "chain", kind: "armed", ms: Date.now() - t0, stop: usd(stop), tx: hash });
  return r.blockNumber;
}

// Resolves when the contract reports StopFired (or disarms itself).
export function watchChainLane(fromBlock, emit, t0, signal) {
  return new Promise((resolve) => {
    let next = fromBlock;
    const seen = new Set();
    const timer = setInterval(async () => {
      if (signal.aborted) { clearInterval(timer); return resolve({ fired: false, reason: "aborted" }); }
      try {
        const head = await pub.getBlockNumber();
        if (head < next) return;
        const logs = await pub.getLogs({ address: ADDR.chainStop, fromBlock: next, toBlock: head });
        next = head + 1n;
        for (const log of logs) {
          if (seen.has(log.transactionHash + log.logIndex)) continue;
          seen.add(log.transactionHash + log.logIndex);
          let ev;
          try { ev = decodeEventLog({ abi: abi.chainStop, data: log.data, topics: log.topics }); } catch { continue; }
          const ms = Date.now() - t0;
          if (ev.eventName === "Tick") {
            emit({ lane: "chain", kind: "tick", ms, n: ev.args.n, price: usd(ev.args.markPrice), tx: log.transactionHash });
          } else if (ev.eventName === "StopFired") {
            const tx = await pub.getTransaction({ hash: log.transactionHash });
            const r = await pub.getTransactionReceipt({ hash: log.transactionHash });
            const out = {
              lane: "chain", kind: "fired", ms, price: usd(ev.args.markPrice), ok: ev.args.success,
              tx: log.transactionHash, block: Number(log.blockNumber), from: tx.from, gasUsed: Number(r.gasUsed),
            };
            emit(out);
            clearInterval(timer);
            return resolve({ fired: ev.args.success, ...out });
          } else if (ev.eventName === "Disarmed") {
            emit({ lane: "chain", kind: "disarmed", ms, reason: ev.args.reason });
            clearInterval(timer);
            return resolve({ fired: false, reason: ev.args.reason });
          }
        }
      } catch { /* a slow RPC read is retried on the next interval */ }
    }, 1000);
  });
}

// Cleanup after a run that ended without a fire: stop the alarm, flatten.
export async function flattenChainLane() {
  const w = wallet();
  const left = await pub.readContract({ address: ADDR.chainStop, abi: abi.chainStop, functionName: "ticksLeft" });
  if (left > 0) await confirmed(await w.writeContract({ address: ADDR.chainStop, abi: abi.chainStop, functionName: "disarm" }));
  const { size } = await position(ADDR.chainStop);
  if (size > 0n) {
    await confirmed(await w.writeContract({
      address: ADDR.chainStop, abi: abi.chainStop, functionName: "closeNow",
      args: [through(await mark(), false, 2n)], gas: ORDER_GAS,
    }));
  }
}
