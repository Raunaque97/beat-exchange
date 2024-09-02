import {
  runtimeModule,
  state,
  runtimeMethod,
  RuntimeModule,
} from "@proto-kit/module";
import { State, StateMap, assert } from "@proto-kit/protocol";
import {
  Balance,
  TokenId,
  UInt64,
  UInt112,
  BalancesKey,
  UInt,
} from "@proto-kit/library";
import { Field, Provable, PublicKey, Struct, Encoding, Poseidon } from "o1js";
import { Balances } from "./balances";
import { inject } from "tsyringe";
import {
  calcBuyAmt,
  calcSellAmt,
  provableMax,
  provableMin,
  safeDiv,
  safeDiv112,
} from "../utils";

export class TokenPair extends Struct({
  a: TokenId,
  b: TokenId,
}) {
  public static from(tokenIdA: TokenId, tokenIdB: TokenId) {
    return Provable.if(
      tokenIdA.greaterThan(tokenIdB),
      TokenPair,
      new TokenPair({ a: tokenIdB, b: tokenIdA }),
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
  receiverAddress: PublicKey,
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
export const DEX_ADDRESS = PublicKey.fromGroup(
  Poseidon.hashToGroup(Encoding.stringToFields("DEX_ADDRESS"))
);

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

  public constructor(@inject("Balances") public balances: Balances) {
    super();
  }

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
    assert(price_low.equals(0).not(), "price_low must not be 0");

    const blockHeight = new UInt64(this.network.block.height);
    const { value: orderId } = await this.buyOrderCounters.get(
      new PairBlockKey({ pair, blockHeight })
    );
    await this.buyOrders.set(
      new OrderKey({ pair, blockHeight, orderId }),
      new Order({
        amount_low,
        amount_high,
        price_low,
        price_high,
        receiverAddress: this.transaction.sender.value,
      })
    );
    await this.buyOrderCounters.set(
      new PairBlockKey({ pair, blockHeight }),
      orderId.add(1)
    );
    // update sender's balance
    await this.balances.transfer(
      pair.a,
      this.transaction.sender.value,
      DEX_ADDRESS,
      amount_low
    );
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
    assert(price_low.equals(0).not(), "price_low must not be 0");

    const blockHeight = new UInt64(this.network.block.height);
    const { value: orderId } = await this.sellOrderCounters.get(
      new PairBlockKey({ pair, blockHeight })
    );
    await this.sellOrders.set(
      new OrderKey({ pair, blockHeight, orderId }),
      new Order({
        amount_low,
        amount_high,
        price_low,
        price_high,
        receiverAddress: this.transaction.sender.value,
      })
    );
    await this.sellOrderCounters.set(
      new PairBlockKey({ pair, blockHeight }),
      orderId.add(1)
    );
    // update sender's balance
    const deduction_low = safeDiv(amount_low, price_low);
    const deduction_high = safeDiv(amount_high, price_high);
    await this.balances.transfer(
      pair.b,
      this.transaction.sender.value,
      DEX_ADDRESS,
      provableMax(deduction_low, deduction_high)
    );
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
    assert(settlementPrice.equals(0).not(), "settlementPrice must not be 0");
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
      buyTotal,
      sellTotal,
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
    const { value: buyOrderCount } =
      await this.buyOrderCounters.get(currentPairBlockKey);
    assert(settledBuyOrderCount.lessThan(buyOrderCount), "nothing to settle");

    const amtSP_minus1 = calcBuyAmt(order, settlementPrice.sub(1));
    const amtSP = calcBuyAmt(order, settlementPrice);
    const amtSP_plus1 = calcBuyAmt(order, settlementPrice.add(1));

    // update sender's balances
    // fillRatio = sellTotal /  Max(buyTotal, sellTotal)
    // amount of token A traded = fillRatio * amtSP
    const tradeAmt_A = safeDiv112(
      new UInt112(amtSP).mul(new UInt112(sellTotal)),
      new UInt112(provableMax(buyTotal, sellTotal))
    );
    const tradeAmt_B = safeDiv(tradeAmt_A, settlementPrice);
    assert(
      tradeAmt_A.lessThanOrEqual(order.amount_low),
      "Invariant Unsatisfied: tradeAmt_A <= amount_low"
    );

    await this.balances.transfer(
      pair.b,
      DEX_ADDRESS,
      order.receiverAddress,
      tradeAmt_B
    );
    await this.balances.transfer(
      pair.a,
      DEX_ADDRESS,
      order.receiverAddress,
      order.amount_low.sub(tradeAmt_A) // amount of token A refunded
    );
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
      buyTotal,
      sellTotal,
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
    const { value: sellOrderCount } =
      await this.sellOrderCounters.get(currentPairBlockKey);
    assert(settledSellOrderCount.lessThan(sellOrderCount), "nothing to settle");

    const amtSP_minus1 = calcSellAmt(order, settlementPrice.sub(1));
    const amtSP = calcSellAmt(order, settlementPrice);
    const amtSP_plus1 = calcSellAmt(order, settlementPrice.add(1));

    // update sender's balances
    // fillRatio = buyTotal /  Max(buyTotal, sellTotal)
    // amount of token A traded = fillRatio * amtSP
    const tradeAmt_A = safeDiv112(
      new UInt112(amtSP).mul(new UInt112(buyTotal)),
      new UInt112(provableMax(buyTotal, sellTotal))
    );
    const tradeAmt_B = safeDiv(tradeAmt_A, settlementPrice);
    const totalDeposit = provableMax(
      safeDiv(order.amount_low, order.price_low),
      safeDiv(order.amount_high, order.price_high)
    );
    assert(
      tradeAmt_B.lessThanOrEqual(totalDeposit),
      "Invariant Unsatisfied: tradeAmt_B <= totalDeposit"
    );
    await this.balances.transfer(
      pair.b,
      DEX_ADDRESS,
      order.receiverAddress,
      totalDeposit.sub(tradeAmt_B) // amount of token B to refunded
    );
    await this.balances.transfer(
      pair.a,
      DEX_ADDRESS,
      order.receiverAddress,
      tradeAmt_A
    );

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

    assert(
      vol_sp
        .greaterThanOrEqual(vol_sp_minus1)
        .and(vol_sp.greaterThanOrEqual(vol_sp_plus1)),
      "should be settled for max volume"
    );
  }
}
