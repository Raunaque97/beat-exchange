import { Balance, BalancesKey, TokenId, UInt64 } from "@proto-kit/library";
import { client } from "../src/environments/client.config";
import { PrivateKey } from "o1js";
import * as dotenv from "dotenv";
import { DECIMALS, PRICE_DECIMALS } from "../src/runtime/constants";
import { getBalance, getCurrentNonce, prettyBalance } from "./utils";
import { exit } from "process";
import { TokenPair } from "../src/runtime/utils";

// running script from `root/packages/chain`
dotenv.config({ path: "./scripts/.env" });
const pvtKey = PrivateKey.fromBase58(process.env.BOT_PVT_KEY_1 as string);
const publicKey = pvtKey.toPublicKey();
client.configurePartial({
  GraphqlClient: {
    url: process.env.NEXT_PUBLIC_PROTOKIT_GRAPHQL_URL,
  },
});
await client.start();

let nonce = await getCurrentNonce(client, publicKey);

/***************************
 * Provide liquidity on Both Sides
 * within a range of `p(1 - delta)`, `p(1 + delta)`
 * get `p` from a price source like uniswap, binance, etc.
 *
 * Assumes that tokenA = usdt HAVE lower id than B
 *
 ***************************/

const delta = 0.1; // 10%
const balances = client.runtime.resolve("Balances");
const dex = client.runtime.resolve("Dex");

const pair = TokenPair.from(
  TokenId.from(2), // eth
  TokenId.from(1) // usdt
);

let balanceA = await getBalance(client, publicKey, pair.a); // usdt
let balanceB = await getBalance(client, publicKey, pair.b); // eth
console.log(`starting A Balance:\t${balanceA}`);
console.log(`starting B Balance:\t${balanceB}`);

let counter = 0;

const price = await getEthPrice(); // price of B in terms of A
const tokenB_usdVal = balanceB.mul(price).div(10 ** PRICE_DECIMALS);
let amt =
  tokenB_usdVal.toBigInt() < balanceA.toBigInt() ? tokenB_usdVal : balanceA;
amt = amt.div(10);

while (true) {
  // balanceA = await getBalance(client, publicKey, pair.a); // usdt
  // balanceB = await getBalance(client, publicKey, pair.b); // eth
  if (balanceA.toString() === "0" || balanceB.toString() === "0") {
    console.log("Dont have enough balance to provide liquidity");
    exit(0);
  }

  // get price from binance
  const price = await getEthPrice(); // price of B in terms of A

  // console.log(`amt :\t${amt.toString()}`);
  // place Buy side order(s)
  let tx1 = await client.transaction(
    publicKey,
    async () => {
      await dex.placeBuyOrder(
        pair,
        amt,
        Balance.zero,
        UInt64.from(Math.floor(price * (1 - delta))),
        UInt64.from(price)
      );
    },
    { nonce: nonce++ }
  );
  tx1.transaction = tx1.transaction?.sign(pvtKey);

  // place Sell side order(s)
  let tx2 = await client.transaction(
    publicKey,
    async () => {
      await dex.placeSellOrder(
        pair,
        Balance.zero,
        amt,
        UInt64.from(price),
        UInt64.from(Math.floor(price * (1 + delta)))
      );
    },
    { nonce: nonce++ }
  );
  tx2.transaction = tx2.transaction?.sign(pvtKey);

  await Promise.all([tx1.send(), tx2.send()]);

  // wait for next block
  await new Promise((resolve) => setTimeout(resolve, 300)); // TODO find a better way

  // calculate stats
  counter++;
  if (counter % 10 === 0) {
    balanceA = await getBalance(client, publicKey, pair.a); // usdt
    balanceB = await getBalance(client, publicKey, pair.b); // eth
    const usdVal = balanceB.mul(price).div(10 ** PRICE_DECIMALS);
    amt = usdVal.toBigInt() < balanceA.toBigInt() ? usdVal : balanceA;
    amt = amt.div(10);
    console.log(
      `BalanceA (usdt): ${prettyBalance(balanceA)} \tBalanceB (eth): ${prettyBalance(balanceB)} \t ~ $${prettyBalance(usdVal)}`
    );
  }
}

async function getEthPrice(): Promise<number> {
  const url = "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT";

  try {
    const response = await fetch(url);
    const data = await response.json();
    //@ts-ignore
    const price = parseFloat(data.price);
    return Math.floor(price * 10 ** PRICE_DECIMALS);
  } catch (error) {
    console.error("Error fetching price:", error);
    throw error;
  }
}
