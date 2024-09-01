import "reflect-metadata";
import { log } from "@proto-kit/common";
import {
  BalancesKey,
  TokenId,
  UInt64,
  VanillaProtocolModules,
} from "@proto-kit/library";
import { Field, method, PrivateKey } from "o1js";
import { Balances } from "../../../src/runtime/modules/balances";
import {
  Dex,
  DEX_ADDRESS,
  PairBlockKey,
  SettlementInfo,
  TokenPair,
} from "../../../src/runtime/modules/dex";
import { DECIMALS } from "../../../src/runtime/constants";
import { TestingAppChain } from "../../TestingAppchain";

log.setLevel("ERROR");

describe("dex", () => {
  const appChain = TestingAppChain.fromRuntime({
    Balances,
    Dex,
  });
  let dex: Dex;
  let balances: Balances;
  const eth_Id = TokenId.from(Field.random());
  const usdt_Id = TokenId.from(0); // so that usdt is always first in Pair
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
        Balances: {},
        Dex: {},
      },
    });

    await appChain.start();
    dex = appChain.runtime.resolve("Dex");
    balances = appChain.runtime.resolve("Balances");

    console.log(`
      Alice: ${alice.toBase58()}
      Bob: ${bob.toBase58()}
      Sequencer: ${sequencer.toBase58()}
    `);

    // mint tokens for alice and bob
    const minterPrivateKey = PrivateKey.random();
    let nonce = 0;
    appChain.setSigner(minterPrivateKey);
    const mints = [
      {
        tokenId: usdt_Id,
        address: alice,
        amount: UInt64.from(1000 * 10 ** DECIMALS),
      },
      {
        tokenId: usdt_Id,
        address: bob,
        amount: UInt64.from(20000 * 10 ** DECIMALS),
      },
      {
        tokenId: eth_Id,
        address: bob,
        amount: UInt64.from(5 * 10 ** DECIMALS),
      },
    ];
    for (const { tokenId, address, amount } of mints) {
      const tx = await appChain.transaction(
        minterPrivateKey.toPublicKey(),
        async () => {
          await balances.addBalance(tokenId, address, amount);
        },
        { nonce: nonce++ }
      );
      await tx.sign();
      await tx.send();
    }
    await appChain.produceBlock();

    const aliceUsdtBalance = await appChain.query.runtime.Balances.balances.get(
      new BalancesKey({ address: alice, tokenId: usdt_Id })
    );
    const bobUsdtBalance = await appChain.query.runtime.Balances.balances.get(
      new BalancesKey({ address: bob, tokenId: usdt_Id })
    );
    console.log(`
      aliceUsdtBalance:\t${aliceUsdtBalance}
      bobUsdtBalance: \t${bobUsdtBalance}
    `);
  });

  it("should demonstrate how dex works", async () => {
    // alice submits a buy order (market buy for 100 usdt)
    appChain.setSigner(alicePrivateKey);
    const tx1 = await appChain.transaction(alice, async () => {
      await dex.placeBuyOrder(
        ethUsdt,
        UInt64.from(100 * 10 ** DECIMALS),
        UInt64.from(100 * 10 ** DECIMALS),
        UInt64.from(2000),
        UInt64.from(4000)
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
        UInt64.from(3000),
        UInt64.from(3300)
      );
    });
    await tx2.sign();
    await tx2.send();

    // these should run in the server/sequencer
    appChain.setSigner(sequencerPrivateKey);
    // calculate settlement price
    const settlementPrice = UInt64.from(3300);

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
    if (!block) {
      throw new Error("no block produced");
    }

    for (let i = 0; i < block.transactions.length; i++) {
      expect(
        block.transactions[i].status.toBoolean(),
        "tx:" + (i + 1) + "\t" + block.transactions[i].statusMessage
      ).toBe(true);
      // console.log("status: ", block.transactions[i].statusMessage);
    }

    const pairBlock1Key = new PairBlockKey({
      pair: ethUsdt,
      blockHeight: UInt64.from(1),
    });
    const buyOrderCount =
      await appChain.query.runtime.Dex.buyOrderCounters.get(pairBlock1Key);
    const sellOrderCount =
      await appChain.query.runtime.Dex.sellOrderCounters.get(pairBlock1Key);
    const settlementInfo =
      (await appChain.query.runtime.Dex.settlementInfos.get(
        pairBlock1Key
      )) as SettlementInfo;
    // console.log(
    //   "settlementInfo ",
    //   Object.keys(settlementInfo).map(
    //     (key) => `${key}: ${settlementInfo[key as keyof SettlementInfo]}`
    //   )
    // );
    const dexBalance_usdt = await appChain.query.runtime.Balances.balances.get(
      new BalancesKey({
        tokenId: usdt_Id,
        address: DEX_ADDRESS,
      })
    );
    const dexBalance_eth = await appChain.query.runtime.Balances.balances.get(
      new BalancesKey({
        tokenId: eth_Id,
        address: DEX_ADDRESS,
      })
    );
    console.log(`
      dexBalance_usdt:\t${dexBalance_usdt}
      dexBalance_eth: \t${dexBalance_eth}
    `);
    expect(buyOrderCount?.toString()).toBe("1");
    expect(sellOrderCount?.toString()).toBe("1");
    expect(settlementInfo?.settledBuyOrderCount?.toString()).toBe(
      buyOrderCount?.toString()
    );
    expect(settlementInfo?.settledSellOrderCount?.toString()).toBe(
      sellOrderCount?.toString()
    );
  }, 1_000_000);
});
