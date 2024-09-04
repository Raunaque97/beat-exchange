import { Balance, UInt, UInt112, UInt64 } from "@proto-kit/library";
import { assert } from "@proto-kit/protocol";
import { Provable } from "o1js";

export type Order = {
  amount_low: Balance;
  amount_high: Balance;
  price_low: UInt64;
  price_high: UInt64;
};

export function provableMin(a: UInt64, b: UInt64): UInt64 {
  return new UInt64(Provable.if(a.lessThan(b), UInt64, a, b));
}
export function provableMax(a: UInt64, b: UInt64): UInt64 {
  return new UInt64(Provable.if(a.greaterThan(b), UInt64, a, b));
}

/**
 * a_low >= a_high; p_low <= p <= p_high
 * Amt(p) = a_low - (a_low - a_high) * (p - p_low) / (p_high - p_low)
 */
export function calcBuyAmt(order: Order, settlementPrice: UInt64): Balance {
  const numerator1 = new UInt112(order.amount_low.sub(order.amount_high));
  const numerator2 = new UInt112(safeSub(settlementPrice, order.price_low));
  const denominator = Provable.if(
    order.price_high.equals(order.price_low),
    UInt64,
    UInt64.from(1),
    order.price_high.sub(order.price_low)
  );
  const dec = numerator1.mul(numerator2).div(new UInt112(denominator));
  return new Balance(
    Provable.if(
      settlementPrice.lessThanOrEqual(order.price_low),
      UInt64,
      order.amount_low,
      Provable.if(
        settlementPrice.greaterThan(order.price_high),
        UInt64,
        Balance.from(0),
        safeSub(order.amount_low, new UInt64(dec))
      )
    )
  );
}
/**
 * a_low <= a_high; p_low <= p <= p_high
 * Amt(p) = a_low + (a_high - a_low) * (p - p_low) / (p_high - p_low)
 */
export function calcSellAmt(order: Order, settlementPrice: UInt64): Balance {
  const numerator1 = new UInt112(order.amount_high.sub(order.amount_low));
  const numerator2 = new UInt112(safeSub(settlementPrice, order.price_low));
  const denominator = Provable.if(
    order.price_high.equals(order.price_low),
    UInt64,
    UInt64.from(1),
    order.price_high.sub(order.price_low)
  );
  const inc = numerator1.mul(numerator2).div(new UInt112(denominator));
  return new Balance(
    Provable.if(
      settlementPrice.lessThanOrEqual(order.price_low),
      UInt64,
      Balance.from(0),
      Provable.if(
        settlementPrice.greaterThanOrEqual(order.price_high),
        UInt64,
        order.amount_high,
        order.amount_low.add(new UInt64(inc))
      )
    )
  );
}
/**
 * handles division by zero
 * returns (y != 0) ? x / y : x
 */
export function safeDiv(x: UInt64, y: UInt64): UInt64 {
  const adjustedY = Provable.if(y.equals(0), UInt64, UInt64.from(1), y);
  return x.div(new UInt64(adjustedY));
}

export function safeDiv112(x: UInt<112>, y: UInt<112>): UInt64 {
  const adjustedY = Provable.if(y.equals(0), UInt112, UInt112.from(1), y);
  return new UInt64(x.div(new UInt112(adjustedY))); // TODO clamp value
}

/**
 * @returns (x > y) ? x - y : 0
 */
export function safeSub(x: UInt64, y: UInt64): UInt64 {
  const adjestedY = Provable.if(x.greaterThan(y), UInt64, y, x);
  return x.sub(new UInt64(adjestedY));
}
