// Addresses, ABIs and clients for Somnia Tokyo testnet. The throwaway key is
// read from a file and only ever handed to viem; it is never logged or sent.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const RPC = process.env.RPC_URL || "https://api.hideki2.infra.testnet.somnia.network";

export const tokyo = defineChain({
  id: 50383,
  name: "Somnia Tokyo testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export const ADDR = {
  usdso: "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72",
  bank: "0x478769E1177C0773c43A593DCCc4Ad15F15F1394",
  pool: "0xd6cb1dd58580b84d76068ac21594219ce03aeddf", // ETH perp
  chainStop: process.env.CHAIN_STOP || "0x09e201dAF194DdC18345bd26cb6fD23E954Cd565",
};

export const MARKET = { symbol: "ETH", baseDecimals: 18, tick: 10n ** 16n, lot: 10n ** 14n };

export const SETTINGS = {
  quantity: BigInt(process.env.QUANTITY || 10n ** 16n), // 0.01 ETH
  stopOffset: BigInt(process.env.STOP_OFFSET_USD || 1) * 10n ** 18n,
  botPollMs: Number(process.env.BOT_POLL_MS || 2000),
  botDiesAtMs: Number(process.env.BOT_DIES_AT_MS || 3000),
  reconnectAfterMs: Number(process.env.RECONNECT_AFTER_MS || 20000),
  maxRunMs: Number(process.env.MAX_RUN_MS || 10 * 60 * 1000),
  maxTicks: Number(process.env.MAX_TICKS || 130),
};

export const ORDER_GAS = 30_000_000n;
export const FAR_EXPIRY_NS = 2n ** 64n - 1n;
export const IOC = 2;

export const abi = {
  pool: parseAbi([
    "function placeOrder(bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) returns (bool success,uint128 orderId)",
    "function getMarkPrice() view returns (uint256)",
  ]),
  bank: parseAbi([
    "function deposit(uint256 amount)",
    "function getPosition(address account,address pool) view returns (int128 size,uint128 avgEntryPrice,int256 entryFundingIndex,uint64 lastUpdatedTimestampNs)",
    "function getAccountHealth(address account) view returns (int256 equity,uint256 imReq,uint256 mmReq,uint256 cmReq)",
  ]),
  erc20: parseAbi([
    "function approve(address spender,uint256 amount) returns (bool)",
    "function balanceOf(address who) view returns (uint256)",
  ]),
  chainStop: parseAbi([
    "function openLong(uint256 quantity,uint256 maxPrice)",
    "function arm(uint256 stopPrice,uint32 maxTicks)",
    "function disarm()",
    "function closeNow(uint256 minPrice)",
    "function ticksLeft() view returns (uint32)",
    "event Armed(uint256 stopPrice,uint256 markPrice,uint32 maxTicks)",
    "event Tick(uint32 n,uint256 markPrice,uint256 stopPrice)",
    "event StopFired(uint256 markPrice,uint256 stopPrice,int128 closedSize,bool success)",
    "event Disarmed(string reason)",
  ]),
};

export function account() {
  const file = process.env.KEY_FILE || `${homedir()}/.tokyo-throwaway/key`;
  return privateKeyToAccount(readFileSync(file, "utf8").trim());
}

export const pub = createPublicClient({ chain: tokyo, transport: http(RPC) });
export const wallet = () => createWalletClient({ chain: tokyo, transport: http(RPC), account: account() });
