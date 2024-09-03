import { log } from "@proto-kit/common";
import { Startable } from "@proto-kit/deployment";
import {
  ManualBlockTrigger,
  PendingTransaction,
  PrivateMempool,
} from "@proto-kit/sequencer";
import { LogLevelDesc } from "loglevel";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Dex, TokenPair } from "./runtime/modules/dex";
import { PrivateKey } from "o1js";
import { Balance, TokenId, UInt64 } from "@proto-kit/library";
import { calcBuyAmt, calcSellAmt, Order } from "./runtime/utils";
import { calculateSettlementPrice } from "./solver";
import { MethodIdResolver } from "@proto-kit/module";
import { AppChainTransaction, InMemorySigner } from "@proto-kit/sdk";

export interface Arguments {
  appChain: string;
  pruneOnStartup: boolean;
  logLevel: LogLevelDesc;
}

export type AppChainFactory = (args: Arguments) => Promise<Startable>;

yargs(hideBin(process.argv))
  .command<Arguments>(
    "start [app-chain]",
    "Start the specified app-chain",
    (yargs) => {
      return yargs
        .env("PROTOKIT")
        .positional("appChain", {
          type: "string",
          demandOption: true,
        })
        .option("pruneOnStartup", {
          type: "boolean",
          default: false,
        })
        .option("logLevel", {
          type: "string",
          default: "info",
        });
    },
    async (args) => {
      log.setLevel(args.logLevel);

      // For windows support, we need to parse out environment variables used in the path
      let path = replaceEnvTemplates(args.appChain);

      const appChainFactory: AppChainFactory = (await import(path)).default;
      const appChain = (await appChainFactory(args)) as any;

      await appChain.start();
      const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
      inMemorySigner.config.signer = sequencerPrivateKey;
      const blockTrigger = appChain.sequencer.resolveOrFail(
        "BlockTrigger",
        ManualBlockTrigger
      );
      const mempool: PrivateMempool = appChain.sequencer.resolveOrFail(
        "Mempool",
        PrivateMempool
      );
      const methodIdResolver: MethodIdResolver =
        appChain.runtime.dependencyContainer.resolve("MethodIdResolver");

      setInterval(async () => {
        const ordersMap = await getAllOrders(
          await mempool.getTxs(),
          methodIdResolver
        );
        for (const pairKey of ordersMap.keys()) {
          const pair = TokenPair.from(
            TokenId.from(pairKey.split("-")[0]),
            TokenId.from(pairKey.split("-")[1])
          );
          const buyOrders = ordersMap.get(pairKey)!.buyOrders;
          const sellOrders = ordersMap.get(pairKey)!.sellOrders;
          await settleAllOrdersForPair(appChain, pair, buyOrders, sellOrders);
        }
        await blockTrigger.produceBlock();
      }, 1 * 1000);
    }
  )
  .parse();

function replaceEnvTemplates(str: string) {
  let temp = str;

  const envRegex = /\$[A-Z1-9_]*/;

  let m;
  while ((m = envRegex.exec(temp)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === envRegex.lastIndex) {
      envRegex.lastIndex++;
    }

    // The result can be accessed through the `m`-variable.
    m.forEach((match, groupIndex) => {
      const envVarName = match.slice(1);
      const envVarValue = process.env[envVarName];
      if (envVarValue === undefined) {
        throw new Error(
          `Substituted environment variable ${envVarName} not found`
        );
      }
      temp = temp.replace(match, envVarValue);
    });
  }
  return temp;
}

//////////////////////////////////////////////
const sequencerPrivateKey = PrivateKey.random();
const sequencer = sequencerPrivateKey.toPublicKey();
const usdt_Id = TokenId.from(0);
const mina_Id = TokenId.from(1);
const pairsToSettle = [TokenPair.from(mina_Id, usdt_Id)];
let nonce = 0; // TODO fetch from chain
async function settleAllOrdersForPair(
  appChain: any,
  pair: TokenPair,
  buyOrders: Order[],
  sellOrders: Order[]
) {
  if (buyOrders.length === 0 || sellOrders.length === 0) return;

  const dex: Dex = appChain.runtime.resolveOrFail("Dex", Dex);
  // solve for SettlementPrice
  const sPrice = calculateSettlementPrice(buyOrders, sellOrders);
  console.log(
    `pair: ${pair.a.toString()}-${pair.b.toString()}  \tSettlement Price: ${sPrice}`
  );
  const buyTotal = buyOrders
    .map((o) => calcBuyAmt(o, sPrice))
    .reduce((a, b) => a.add(b), UInt64.zero);
  const sellTotal = sellOrders
    .map((o) => calcSellAmt(o, sPrice))
    .reduce((a, b) => a.add(b), UInt64.zero);

  // startSettlement txn
  let tx: AppChainTransaction = await appChain.transaction(
    sequencer,
    async () => {
      await dex.startSettlement(pair, sPrice, buyTotal, sellTotal);
    },
    { nonce: nonce++ }
  );
  await tx.sign();
  await tx.send();
  // settlementStep txns
  for (let i = 0; i < buyOrders.length; i++) {
    tx = await appChain.transaction(
      sequencer,
      async () => {
        await dex.settlementStepBuy(pair);
      },
      { nonce: nonce++ }
    );
    await tx.sign();
    await tx.send();
  }
  for (let i = 0; i < sellOrders.length; i++) {
    tx = await appChain.transaction(
      sequencer,
      async () => {
        await dex.settlementStepSell(pair);
      },
      { nonce: nonce++ }
    );
    await tx.sign();
    await tx.send();
  }
  // settleBlock txn
  tx = await appChain.transaction(
    sequencer,
    async () => {
      await dex.settleBlock(pair);
    },
    { nonce: nonce++ }
  );
  await tx.sign();
  await tx.send();
}
async function getAllOrders(
  txns: PendingTransaction[],
  methodIdResolver: MethodIdResolver
): Promise<
  Map<
    string,
    {
      buyOrders: Order[];
      sellOrders: Order[];
    }
  >
> {
  const result = new Map<
    string,
    {
      buyOrders: Order[];
      sellOrders: Order[];
    }
  >();
  for (const txn of txns) {
    const [moduleName, methodName] = methodIdResolver.getMethodNameFromId(
      txn.methodId.toBigInt()
    ) || ["unknown", "unknown"];

    if (
      moduleName === "Dex" &&
      (methodName === "placeBuyOrder" || methodName === "placeSellOrder")
    ) {
      const tokenIdA = TokenId.from(txn.argsFields[0]);
      const tokenIdB = TokenId.from(txn.argsFields[1]);
      const amount_low = Balance.from(txn.argsFields[2].toBigInt());
      const amount_high = Balance.from(txn.argsFields[3].toBigInt());
      const price_low = Balance.from(txn.argsFields[4].toBigInt());
      const price_high = Balance.from(txn.argsFields[5].toBigInt());
      const pair = TokenPair.from(tokenIdA, tokenIdB);

      const pairKey = `${pair.a.toString()}-${pair.b.toString()}`;
      if (!result.has(pairKey)) {
        result.set(pairKey, {
          buyOrders: [],
          sellOrders: [],
        });
      }

      if (methodName === "placeBuyOrder") {
        result.get(pairKey)!.buyOrders.push({
          amount_low,
          amount_high,
          price_low,
          price_high,
        });
      } else if (methodName === "placeSellOrder") {
        result.get(pairKey)!.sellOrders.push({
          amount_low,
          amount_high,
          price_low,
          price_high,
        });
      }
    }
  }
  return result;
}
