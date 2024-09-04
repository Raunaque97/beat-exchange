import { Balance, BalancesKey, TokenId, UInt64 } from "@proto-kit/library";
import { client } from "../src/environments/client.config";
import { PrivateKey, PublicKey } from "o1js";
import * as dotenv from "dotenv";
import { DECIMALS } from "../src/runtime/constants";
import { getBalance, getCurrentNonce } from "./utils";

// running script from `root/packages/chain`
dotenv.config({ path: "./scripts/.env" });
const pvtKey = PrivateKey.random();
const publicKey = pvtKey.toPublicKey();
const receiver = PrivateKey.fromBase58(
  process.env.BOT_PVT_KEY_1 as string
).toPublicKey();
// const receiver = PrivateKey.fromBase58(
//   process.env.BOT_PVT_KEY_2 as string
// ).toPublicKey();

client.configurePartial({
  GraphqlClient: {
    url: process.env.NEXT_PUBLIC_PROTOKIT_GRAPHQL_URL,
  },
});
await client.start();

let nonce = await getCurrentNonce(client, publicKey);
/***************************
 * Mint Tokens
 ***************************/

const balances = client.runtime.resolve("Balances");
let tx = await client.transaction(
  publicKey,
  async () => {
    await balances.addBalance(
      TokenId.from(2), // eth
      receiver,
      UInt64.from(3 * 10 ** DECIMALS)
    );
  },
  { nonce: nonce++ }
);
tx.transaction = tx.transaction?.sign(pvtKey);
await tx.send();

tx = await client.transaction(
  publicKey,
  async () => {
    await balances.addBalance(
      TokenId.from(1), // usdt
      receiver,
      UInt64.from(10000 * 10 ** DECIMALS)
    );
  },
  { nonce: nonce++ }
);
tx.transaction = tx.transaction?.sign(pvtKey);
await tx.send();

// sleep for 1s
await new Promise((resolve) => setTimeout(resolve, 1000));

const eth_bal = await getBalance(
  client,
  receiver,
  TokenId.from(2) // eth
);
const usdt_bal = await getBalance(
  client,
  receiver,
  TokenId.from(1) // usdt
);

console.log(`usdt Balance:\t${usdt_bal}`);
console.log(`eth Balance:\t${eth_bal}`);
