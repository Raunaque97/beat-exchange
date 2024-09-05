import { Balance } from "@proto-kit/library";
import { DECIMALS } from "./constants";

export function prettyBalance(bal: Balance): string {
  return `${bal.toString().slice(0, -DECIMALS) || "0"}.${Number(bal.toString().slice(-DECIMALS))}`;
}
