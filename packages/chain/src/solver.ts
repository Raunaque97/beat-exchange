import { UInt, UInt64 } from "@proto-kit/library";
import { Order, calcBuyAmt, calcSellAmt } from "./runtime/utils";

/**
 * uses binary search to find a price where
 * sellSide == buySide
 */
export function calculateSettlementPrice(
  buyOrders: Order[],
  sellOrders: Order[]
) {
  // use min of price_low for start and max of price_high for end
  let start = buyOrders
    .map((o) => o.price_low)
    .reduce(
      (a, b) => (a.lessThan(b).toBoolean() ? a : b),
      UInt64.from(2 ** 31) // TODO temporary fix to prevent overflow
    );
  let end = sellOrders
    .map((o) => o.price_high)
    .reduce((a, b) => (a.greaterThan(b).toBoolean() ? a : b), UInt64.from(1));
  let mid = UInt64.from(1);
  let count = 0;

  while (start.lessThan(end)) {
    mid = start.add(end).div(2);

    const buyAmt = buyOrders
      .map((o) => calcBuyAmt(o, mid))
      .reduce((a, b) => a.add(b), UInt64.zero);
    const sellAmt = sellOrders
      .map((o) => calcSellAmt(o, mid))
      .reduce((a, b) => a.add(b), UInt64.zero);

    // console.log(`mid: ${mid}, buyAmt: ${buyAmt}, sellAmt: ${sellAmt}`);
    if (buyAmt.lessThan(sellAmt).toBoolean()) {
      end = mid;
    } else if (buyAmt.greaterThan(sellAmt).toBoolean()) {
      start = mid;
    } else {
      break;
    }
    count++;
    if (count > 100) {
      // TODO use config
      break;
    }
  }
  console.log(`count: ${count} SettlementPrice: ${mid.toString()}`);
  return mid;
}
