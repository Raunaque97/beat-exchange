import { TokenId } from "@proto-kit/library";
import { DECIMALS as DECIMALS_CHAIN, TokenPair } from "chain";

export const DECIMALS = DECIMALS_CHAIN || 9;

export const TOKEN_IDS = {
  ETH: 2,
  USDT: 1,
  MINA: 0,
};

export const DEFAULT_GRAPHQL_ENDPOINT = "http://localhost:8080/graphql";

export const CLI_NAME = "Beat-Ex";
export const CLI_DESCRIPTION = "CLI tool for Beat-Ex";

export const MARKETS = {
  ETH_USDT: TokenPair.from(
    TokenId.from(TOKEN_IDS.ETH),
    TokenId.from(TOKEN_IDS.USDT)
  ),
};

export function tokenNameFromId(tokenId: TokenId): string {
  for (const [k, v] of Object.entries(TOKEN_IDS)) {
    if (v.toString() === tokenId.toString()) {
      return k;
    }
  }
  return "Unknown";
}

export function marketNameFromIds(a: TokenId, b: TokenId): string {
  const pair = TokenPair.from(a, b);
  for (const [k, v] of Object.entries(MARKETS)) {
    if (
      v.a.toString() === pair.a.toString() &&
      v.b.toString() === pair.b.toString()
    ) {
      return k;
    }
  }
  return `${tokenNameFromId(pair.a)}_${tokenNameFromId(pair.b)}`;
}
