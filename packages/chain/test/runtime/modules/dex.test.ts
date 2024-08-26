import { TestingAppChain } from "@proto-kit/sdk";
import { Field, method, PrivateKey } from "o1js";
import { Balances } from "../../../src/runtime/modules/balances";
import { Dex, PairBlockKey, TokenPair } from "../../../src/runtime/modules/dex";
import { log } from "@proto-kit/common";
import { BalancesKey, TokenId, UInt64 } from "@proto-kit/library";
import { DECIMALS } from "../../../src/runtime/constants";

log.setLevel("ERROR");

describe("dex", () => {
  const appChain = TestingAppChain.fromRuntime({
    Balances,
    Dex,
  });
  const eth_Id = TokenId.from(Field.random());
  const usdt_Id = TokenId.from(Field.random());
  const ethUsdt = TokenPair.from(eth_Id, usdt_Id);

  const sequencerPrivateKey = PrivateKey.random();
  const sequencer = sequencerPrivateKey.toPublicKey();
  // users
  const alicePrivateKey = PrivateKey.random();
  const alice = alicePrivateKey.toPublicKey();
  const bobPrivateKey = PrivateKey.random();
  const bob = bobPrivateKey.toPublicKey();
  beforeAll(async () => {
    appChain.configurePartial({
      Runtime: {
        Balances: {
          totalSupply: UInt64.from(10000),
        },
        Dex: {},
      },
    });

    await appChain.start();
    // TODO mint tokens for alice and bob
  });

  it("should demonstrate how dex works", async () => {
    // alice submits a buy order (market buy for 100 usdt)
    appChain.setSigner(alicePrivateKey);
    const dex = appChain.runtime.resolve("Dex");
    const tx1 = await appChain.transaction(alice, async () => {
      await dex.placeBuyOrder(
        ethUsdt,
        UInt64.from(100 * 10 ** DECIMALS),
        UInt64.from(100 * 10 ** DECIMALS),
        UInt64.from(2000 * 10 ** DECIMALS),
        UInt64.from(4000 * 10 ** DECIMALS)
      );
    });
    await tx1.sign();
    await tx1.send();
    // bob is market making with 1 eth and 3000 usdt
    // current eth price ~ 3k
    appChain.setSigner(bobPrivateKey);
    const tx2 = await appChain.transaction(bob, async () => {
      await dex.placeSellOrder(
        ethUsdt,
        UInt64.from(0),
        UInt64.from(3300 * 10 ** DECIMALS),
        UInt64.from(3000 * 10 ** DECIMALS),
        UInt64.from(3300 * 10 ** DECIMALS)
      );
    });
    await tx2.sign();
    await tx2.send();

    // these should run in the server/sequencer
    appChain.setSigner(sequencerPrivateKey);
    // calculate settlement price
    const settlementPrice = UInt64.from(3300 * 10 ** DECIMALS);

    const tx3 = await appChain.transaction(
      sequencer,
      async () => {
        await dex.startSettlement(
          ethUsdt,
          settlementPrice,
          UInt64.from(100 * 10 ** DECIMALS),
          UInt64.from(3300 * 10 ** DECIMALS)
        );
      },
      { nonce: 0 }
    );
    await tx3.sign();
    await tx3.send();

    const tx4 = await appChain.transaction(
      sequencer,
      async () => {
        await dex.settlementStepSell(ethUsdt);
      },
      { nonce: 1 }
    );
    await tx4.sign();
    await tx4.send();

    const tx5 = await appChain.transaction(
      sequencer,
      async () => {
        await dex.settlementStepBuy(ethUsdt);
      },
      { nonce: 2 }
    );
    await tx5.sign();
    await tx5.send();
    // [TODO] add constrain so that blocks can be produced after all settlement is completed
    const tx6 = await appChain.transaction(
      sequencer,
      async () => {
        await dex.settleBlock(ethUsdt);
      },
      { nonce: 3 }
    );
    await tx6.sign();
    await tx6.send();

    const block = await appChain.produceBlock();
    // sleep 1 second
    const pairBlock0Key = new PairBlockKey({
      pair: ethUsdt,
      blockHeight: UInt64.from(0),
    });
    const buyOrderCount =
      await appChain.query.runtime.Dex.buyOrderCounters.get(pairBlock0Key);
    const sellOrderCount =
      await appChain.query.runtime.Dex.sellOrderCounters.get(pairBlock0Key);
    const settlementInfo =
      await appChain.query.runtime.Dex.settlementInfos.get(pairBlock0Key);
    expect(buyOrderCount?.toString()).toBe("1");
    expect(sellOrderCount?.toString()).toBe("1");
    // console.log(
    //   "OrderCounts ",
    //   buyOrderCount?.toString(),
    //   sellOrderCount?.toString(),
    //   settlementInfo?.settledBuyOrderCount.toString(),
    //   settlementInfo?.settledSellOrderCount.toString()
    // );
    expect(settlementInfo?.settledBuyOrderCount?.toString()).toBe(
      buyOrderCount?.toString()
    );
    expect(settlementInfo?.settledSellOrderCount?.toString()).toBe(
      sellOrderCount?.toString()
    );
  }, 1_000_000);
});
