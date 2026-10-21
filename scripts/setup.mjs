// One-time setup: give the bot's own account (the throwaway EOA) perps margin,
// and report what both lanes hold. Usage: node scripts/setup.mjs [usdso]
import { pub, wallet, ADDR, abi } from "../src/config.mjs";
import { confirmed, usd } from "../src/perps.mjs";

const amount = BigInt(process.argv[2] || 60) * 10n ** 18n;
const w = wallet();
const me = w.account.address;

const equity = async (who) => (await pub.readContract({ address: ADDR.bank, abi: abi.bank, functionName: "getAccountHealth", args: [who] }))[0];

if ((await equity(me)) < amount / 2n) {
  await confirmed(await w.writeContract({ address: ADDR.usdso, abi: abi.erc20, functionName: "approve", args: [ADDR.bank, amount], gas: 2_000_000n }));
  await confirmed(await w.writeContract({ address: ADDR.bank, abi: abi.bank, functionName: "deposit", args: [amount], gas: 10_000_000n }));
  console.log(`deposited ${usd(amount)} USDso as bot margin`);
}

console.log({
  bot: { address: me, stt: usd(await pub.getBalance({ address: me })), margin: usd(await equity(me)) },
  chain: { address: ADDR.chainStop, stt: usd(await pub.getBalance({ address: ADDR.chainStop })), margin: usd(await equity(ADDR.chainStop)) },
});
