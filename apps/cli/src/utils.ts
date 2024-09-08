import { Balance } from "@proto-kit/library";
import { DECIMALS, PRICE_DECIMALS } from "./constants";
import { Poseidon } from "o1js";
import { stringToField } from "@proto-kit/protocol";

export function prettyBalance(bal: Balance): string {
  return `${bal.toString().slice(0, -DECIMALS) || "0"}.${Number(bal.toString().slice(-DECIMALS).substring(0, 5))}`;
}

export function prettyPrice(bal: Balance, decimals = PRICE_DECIMALS) {
  return `${bal.toString().slice(0, -decimals)}.${Number(bal.toString().slice(-decimals).substring(0, 3))}`;
}

export function getMethodId(moduleName: string, methodName: string): string {
  return Poseidon.hash([stringToField(moduleName), stringToField(methodName)])
    .toBigInt()
    .toString();
}
