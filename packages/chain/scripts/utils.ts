import { Balance, BalancesKey, TokenId, UInt64 } from "@proto-kit/library";
import { PublicKey } from "o1js";
import { client } from "../src/environments/client.config";
import { DECIMALS, PRICE_DECIMALS } from "../src/runtime/constants";

export async function getBalance(
  appChain: typeof client,
  address: PublicKey,
  tokenId: TokenId
) {
  const bal = await appChain.query.runtime.Balances.balances.get(
    new BalancesKey({
      address,
      tokenId,
    })
  );
  //   console.log(`mina Balance:\t${bal}`);
  return bal || Balance.from(0);
}

export async function getCurrentNonce(
  appChain: typeof client,
  address: PublicKey
) {
  const accountState =
    await appChain.query.protocol.AccountState.accountState.get(address);
  return Number(accountState?.nonce.toBigInt() || 0n);
}

export function prettyBalance(bal: Balance, decimals = DECIMALS) {
  return `${bal.toString().slice(0, -decimals)}.${Number(bal.toString().slice(-decimals).substring(0, 5))}`;
}

export function prettyPrice(bal: Balance, decimals = PRICE_DECIMALS) {
  return `${bal.toString().slice(0, -decimals)}.${Number(bal.toString().slice(-decimals).substring(0, 2))}`;
}
