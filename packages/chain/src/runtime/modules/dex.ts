import {
  runtimeModule,
  state,
  runtimeMethod,
  RuntimeModule,
} from "@proto-kit/module";
import { State, StateMap, assert } from "@proto-kit/protocol";
import {
  Balance,
  Balances as BaseBalances,
  TokenId,
  UInt64,
  UInt112,
} from "@proto-kit/library";
import { Field, Provable, PublicKey, Struct } from "o1js";

export class TokenPair extends Struct({
  a: TokenId,
  b: TokenId,
}) {
  public static from(tokenIdA: TokenId, tokenIdB: TokenId) {
    return Provable.if(
      tokenIdA.greaterThan(tokenIdB),
      TokenPair,
      new TokenPair({ a: tokenIdA, b: tokenIdB }),
      new TokenPair({ a: tokenIdA, b: tokenIdB })
    );
  }
}

export class OrderKey extends Struct({
  pair: TokenPair,
  blockHeight: UInt64,
  orderId: UInt64, // starts from 0 for each block
}) {}
export class PairBlockKey extends Struct({
  pair: TokenPair,
  blockHeight: UInt64,
}) {}
export class Order extends Struct({
  amount_low: Balance,
  amount_high: Balance,
  price_low: UInt64,
  price_high: UInt64,
  // TODO add sender address
}) {}
export class SettlementInfo extends Struct({
  settlementPrice: UInt64,
  buyTotal: UInt64, // needed to calculate fill ratio
  sellTotal: UInt64, // needed to calculate fill ratio
  // accumulators
  settledSellOrderCount: UInt64,
  settledBuyOrderCount: UInt64,
  buyAccuSP_minus1: UInt64,
  buyAccuSP: UInt64,
  buyAccuSP_plus1: UInt64,
  sellAccuSP_minus1: UInt64,
  sellAccuSP: UInt64,
  sellAccuSP_plus1: UInt64,
}) {}

@runtimeModule()
export class Dex extends RuntimeModule<{}> {
  @state() public buyOrderCounters = StateMap.from<PairBlockKey, UInt64>(
    PairBlockKey,
    UInt64
  );
  @state() public buyOrders = StateMap.from<OrderKey, Order>(OrderKey, Order);

  @state() public sellOrderCounters = StateMap.from<PairBlockKey, UInt64>(
    PairBlockKey,
    UInt64
  );
  @state() public sellOrders = StateMap.from<OrderKey, Order>(OrderKey, Order);

  @runtimeMethod()
  public async placeBuyOrder(
    pair: TokenPair,
    amount_low: Balance,
    amount_high: Balance,
    price_low: UInt64,
    price_high: UInt64
  ): Promise<void> {
    assert(
      amount_low.greaterThanOrEqual(amount_high),
      "amount_low must be greater than or equal to amount_high"
    );
    assert(
      price_low.lessThan(price_high),
      "price_low must be less than or equal to price_high"
    );

    const blockHeight = new UInt64(this.network.block.height);
    const { value: orderId } = await this.buyOrderCounters.get(
      new PairBlockKey({ pair, blockHeight })
    );
    await this.buyOrders.set(
      new OrderKey({ pair, blockHeight, orderId }),
      new Order({ amount_low, amount_high, price_low, price_high })
    );
    await this.buyOrderCounters.set(
      new PairBlockKey({ pair, blockHeight }),
      orderId.add(1)
    );
    // TODO update sender's balance
  }

  @runtimeMethod()
  public async placeSellOrder(
    pair: TokenPair,
    amount_low: Balance,
    amount_high: Balance,
    price_low: UInt64,
    price_high: UInt64
  ): Promise<void> {
    assert(
      amount_low.lessThanOrEqual(amount_high),
      "amount_low must be less than or equal to amount_high"
    );
    // prevents division by zero, [TODO] should high - low > some delta?
    assert(
      price_low.lessThan(price_high),
      "price_low must be less than or equal to price_high"
    );

    const blockHeight = new UInt64(this.network.block.height);
    const { value: orderId } = await this.sellOrderCounters.get(
      new PairBlockKey({ pair, blockHeight })
    );
    await this.sellOrders.set(
      new OrderKey({ pair, blockHeight, orderId }),
      new Order({ amount_low, amount_high, price_low, price_high })
    );
    await this.sellOrderCounters.set(
      new PairBlockKey({ pair, blockHeight }),
      orderId.add(1)
    );
    // TODO update sender's balance
  }

  // TODO move these to a protocol hooks

  @state() public settlementInfos = StateMap.from<PairBlockKey, SettlementInfo>(
    PairBlockKey,
    SettlementInfo
  );

  @runtimeMethod()
  public async startSettlement(
    pair: TokenPair,
    settlementPrice: UInt64,
    buyTotal: UInt64,
    sellTotal: UInt64
  ): Promise<void> {
    await this.settlementInfos.set(
      new PairBlockKey({
        pair,
        blockHeight: new UInt64(this.network.block.height),
      }),
      new SettlementInfo({
        settlementPrice,
        buyTotal,
        sellTotal,
        settledBuyOrderCount: UInt64.zero,
        settledSellOrderCount: UInt64.zero,
        buyAccuSP_minus1: UInt64.zero,
        buyAccuSP: UInt64.zero,
        buyAccuSP_plus1: UInt64.zero,
        sellAccuSP_minus1: UInt64.zero,
        sellAccuSP: UInt64.zero,
        sellAccuSP_plus1: UInt64.zero,
      })
    );
  }
  @runtimeMethod()
  public async settlementStepBuy(pair: TokenPair): Promise<void> {
    const blockHeight = new UInt64(this.network.block.height);
    const currentPairBlockKey = new PairBlockKey({
      pair,
      blockHeight,
    });

    const { value: settlementInfo } =
      await this.settlementInfos.get(currentPairBlockKey);
    const {
      settlementPrice,
      settledBuyOrderCount,
      buyAccuSP_minus1,
      buyAccuSP,
      buyAccuSP_plus1,
    } = settlementInfo;
    const { value: order } = await this.buyOrders.get(
      new OrderKey({
        pair,
        blockHeight,
        orderId: settledBuyOrderCount,
      })
    );

    const amtSP_minus1 = calcBuyAmt(order, settlementPrice.sub(1));
    const amtSP = calcBuyAmt(order, settlementPrice);
    const amtSP_plus1 = calcBuyAmt(order, settlementPrice.add(1));

    // TODO update sender's balances

    // update settlementInfo, counters
    await this.settlementInfos.set(
      currentPairBlockKey,
      new SettlementInfo({
        ...settlementInfo,
        settledBuyOrderCount: settledBuyOrderCount.add(1),
        buyAccuSP_minus1: buyAccuSP_minus1.add(amtSP_minus1),
        buyAccuSP: buyAccuSP.add(amtSP),
        buyAccuSP_plus1: buyAccuSP_plus1.add(amtSP_plus1),
      })
    );
  }

  @runtimeMethod()
  public async settlementStepSell(pair: TokenPair): Promise<void> {
    const blockHeight = new UInt64(this.network.block.height);
    const currentPairBlockKey = new PairBlockKey({
      pair,
      blockHeight,
    });

    const { value: settlementInfo } =
      await this.settlementInfos.get(currentPairBlockKey);
    const {
      settlementPrice,
      settledSellOrderCount,
      sellAccuSP_minus1,
      sellAccuSP,
      sellAccuSP_plus1,
    } = settlementInfo;
    const { value: order } = await this.sellOrders.get(
      new OrderKey({
        pair,
        blockHeight,
        orderId: settledSellOrderCount,
      })
    );

    const amtSP_minus1 = calcSellAmt(order, settlementPrice.sub(1));
    const amtSP = calcSellAmt(order, settlementPrice);
    const amtSP_plus1 = calcSellAmt(order, settlementPrice.add(1));

    // TODO update sender's balances

    // update settlementInfo, counters
    await this.settlementInfos.set(
      currentPairBlockKey,
      new SettlementInfo({
        ...settlementInfo,
        settledSellOrderCount: settledSellOrderCount.add(1),
        sellAccuSP_minus1: sellAccuSP_minus1.add(amtSP_minus1),
        sellAccuSP: sellAccuSP.add(amtSP),
        sellAccuSP_plus1: sellAccuSP_plus1.add(amtSP_plus1),
      })
    );
  }

  @runtimeMethod()
  public async settleBlock(pair: TokenPair): Promise<void> {
    const blockHeight = new UInt64(this.network.block.height);
    const currentPairBlockKey = new PairBlockKey({
      pair,
      blockHeight,
    });
    const { value: settlementInfo } =
      await this.settlementInfos.get(currentPairBlockKey);

    const {
      buyTotal,
      sellTotal,
      settledBuyOrderCount,
      settledSellOrderCount,
      buyAccuSP_minus1,
      buyAccuSP,
      buyAccuSP_plus1,
      sellAccuSP_minus1,
      sellAccuSP,
      sellAccuSP_plus1,
    } = settlementInfo;

    assert(buyAccuSP.equals(buyTotal), "invalid buyTotal used");
    assert(sellAccuSP.equals(sellTotal), "invalid sellTotal used");
    // all orders should be settled
    const { value: buyOrderCount } =
      await this.buyOrderCounters.get(currentPairBlockKey);
    const { value: sellOrderCount } =
      await this.sellOrderCounters.get(currentPairBlockKey);
    assert(
      settledBuyOrderCount
        .equals(buyOrderCount)
        .and(sellOrderCount.equals(settledSellOrderCount)),
      "not all orders were settled"
    );

    // volume = min(buyAccuSP, sellAccuSP)
    const vol_sp = provableMin(buyAccuSP, sellAccuSP);
    const vol_sp_minus1 = provableMin(buyAccuSP_minus1, sellAccuSP_minus1);
    const vol_sp_plus1 = provableMin(buyAccuSP_plus1, sellAccuSP_plus1);

    Provable.asProver(() => {
      console.log(
        `settleBlock: vol_sp:${vol_sp.toString()} vol_sp_minus1:${vol_sp_minus1.toString()} vol_sp_plus1:${vol_sp_plus1.toString()}`
      );
    });

    assert(
      vol_sp
        .greaterThanOrEqual(vol_sp_minus1)
        .and(vol_sp.greaterThanOrEqual(vol_sp_plus1)),
      "should be settled for max volume"
    );
  }
}

function provableMin(a: UInt64, b: UInt64): UInt64 {
  return new UInt64(Provable.if(a.lessThan(b), UInt64, a, b));
}
function provableMax(a: UInt64, b: UInt64): UInt64 {
  return new UInt64(Provable.if(a.greaterThan(b), UInt64, a, b));
}

/**
 * a_low >= a_high; p_low <= p <= p_high
 * Amt(p) = a_low - (a_low - a_high) * (p - p_low) / (p_high - p_low)
 */
function calcBuyAmt(order: Order, settlementPrice: UInt64): Balance {
  const numerator1 = new UInt112(order.amount_low.sub(order.amount_high));
  const numerator2 = new UInt112(settlementPrice.sub(order.price_low));
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
        settlementPrice.greaterThanOrEqual(order.price_high),
        UInt64,
        Balance.from(0),
        order.amount_low.sub(new UInt64(dec))
      )
    )
  );
}
/**
 * a_low <= a_high; p_low <= p <= p_high
 * Amt(p) = a_low + (a_high - a_low) * (p - p_low) / (p_high - p_low)
 */
function calcSellAmt(order: Order, settlementPrice: UInt64): Balance {
  const numerator1 = new UInt112(order.amount_high.sub(order.amount_low));
  const numerator2 = new UInt112(settlementPrice.sub(order.price_low));
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
