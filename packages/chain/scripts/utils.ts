import { Balance, BalancesKey, TokenId, UInt64 } from "@proto-kit/library";
import { PublicKey } from "o1js";
import { client } from "../src/environments/client.config";

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
