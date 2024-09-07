import { Balance } from "@proto-kit/library";
import { DECIMALS } from "./constants";
import { Poseidon } from "o1js";
import { stringToField } from "@proto-kit/protocol";

export function prettyBalance(bal: Balance): string {
  return `${bal.toString().slice(0, -DECIMALS) || "0"}.${Number(bal.toString().slice(-DECIMALS))}`;
}

export function getMethodId(moduleName: string, methodName: string): string {
  return Poseidon.hash([stringToField(moduleName), stringToField(methodName)])
    .toBigInt()
    .toString();
}
