import { Balance, BalancesKey, TokenId, UInt64 } from "@proto-kit/library";
import { PublicKey, PrivateKey } from "o1js";
import { client, DECIMALS } from "chain";
import { Logger } from "./logger";
import { ConfigManager } from "./configManager";
import { DEFAULT_GRAPHQL_ENDPOINT, marketNameFromIds } from "./constants";
import { BlockQueryResponse, MarkeStats, Transaction } from "./types";
import { getMethodId } from "./utils";

export class WalletManager {
  private sendTxns: {
    hash: string;
    state: "PENDING" | "UNKNOWN" | "INCLUDED" | "SETTLED" | "TIMED_OUT";
    promise: {
      resolve: (value: unknown) => void;
      reject: (reason?: string) => void;
    };
    sentAt: number;
  }[] = [];
  private pvtKey!: PrivateKey;
  public publicKey!: PublicKey;
  private graphqlEndpoint: string = DEFAULT_GRAPHQL_ENDPOINT;
  private nonce = 0;
  public latestBlockHeight = 0;
  public blockHeightToProcess = 0;
  public marketStats: Map<string, MarkeStats>;

  constructor(
    private configManager: ConfigManager,
    private logger: Logger
  ) {
    this.marketStats = new Map();
  }

  async initialize(): Promise<void> {
    const { privateKey, graphqlEndpoint } =
      await this.configManager.loadOrCreateConfig();
    this.pvtKey = PrivateKey.fromBase58(privateKey);
    this.publicKey = this.pvtKey.toPublicKey();
    this.graphqlEndpoint = graphqlEndpoint;
    client.configurePartial({
      GraphqlClient: {
        url: graphqlEndpoint,
      },
    });
    await client.start();

    // try to get nonce from chain
    try {
      this.nonce = await this.getCurrentNonce(this.publicKey);
    } catch (e) {
      // TODO check if network error
      this.logger.error(
        `Error getting nonce from chain\n unable to reach: ${this.graphqlEndpoint}`
      );
    }

    this.startPolling();
  }

  private async startPolling(pollingInterval = 1000) {
    while (true) {
      try {
        const blockData = await this.fetchBlock();
        if (blockData.block !== null && blockData.block.txs) {
          this.latestBlockHeight =
            Number(blockData.network.staged.block.height) || 0;

          if (this.latestBlockHeight >= this.blockHeightToProcess) {
            this.processBlockData(blockData);
            this.blockHeightToProcess++;
          }
          if (this.latestBlockHeight === this.blockHeightToProcess) {
            await new Promise((resolve) =>
              setTimeout(resolve, pollingInterval)
            );
          }
          // for catching up
          this.blockHeightToProcess = Math.max(
            this.blockHeightToProcess,
            this.latestBlockHeight - 10
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, pollingInterval / 10)
        );
      } catch (error) {
        this.logger.error("Error during polling:", error);
        await new Promise((resolve) => setTimeout(resolve, pollingInterval));
      }
    }
  }

  private async fetchBlock() {
    // console.log("fetching block", this.blockHeightToProcess);
    const response = await fetch(this.graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query GetBlock {
            block(height: ${this.blockHeightToProcess}) {
              txs {
                tx {
                  argsFields
                  methodId
                  nonce
                  sender
                  auxiliaryData
                  hash
                }
                status
                statusMessage
              }
            }
            network {
              staged {
                block {
                  height
                }
              }
            }
          }
        `,
      }),
    });
    const { data } = (await response.json()) as BlockQueryResponse;
    return data;
  }

  private processBlockData(blockData: BlockQueryResponse["data"]) {
    if (blockData.block.txs) {
      this.processTxns(blockData.block.txs);
    }
  }

  private processTxns(txns: Transaction[]) {
    for (const txn of txns) {
      // handle pending txns
      const pendingTxn = this.sendTxns.find((t) => t.hash === txn.tx.hash);
      if (pendingTxn) {
        if (txn.status) {
          // console.log(`Txn included: ${txn.tx.hash}`);
          pendingTxn.state = "INCLUDED";
          pendingTxn.promise.resolve({});
        } else {
          pendingTxn.state = "UNKNOWN";
          pendingTxn.promise.reject(txn.statusMessage);
        }
        // this.sendTxns = this.sendTxns.filter((t) => t.hash !== txn.tx.hash);
      }
      // update market stats
      if (txn.tx.methodId === getMethodId("Dex", "startSettlement")) {
        const tokenAId = TokenId.from(txn.tx.argsFields[0]);
        const tokenBId = TokenId.from(txn.tx.argsFields[1]);
        const price = Number(txn.tx.argsFields[2]) / 10 ** 0;
        const buyTotal = Number(txn.tx.argsFields[3]);
        const sellTotal = Number(txn.tx.argsFields[4]);
        const vol = Math.max(buyTotal, sellTotal) / 10 ** DECIMALS;
        const marketName = marketNameFromIds(tokenAId, tokenBId);
        this.updateMarketStats(marketName, price, vol);
      }
    }
  }

  updateMarketStats(marketName: string, price: number, vol: number) {
    if (!this.marketStats.has(marketName)) {
      this.marketStats.set(marketName, {
        prices: [],
        volume: {
          last10sEMA: 0,
          last1minEMA: 0,
          last1hrEMA: 0,
        },
      });
    }
    const marketStats = this.marketStats.get(marketName);
    if (marketStats) {
      marketStats.prices.push(price);
      if (marketStats.prices.length > 10) {
        marketStats.prices.shift();
      }
      marketStats.volume.last10sEMA = (2 / 11) * vol + (1 - 2 / 11) * vol;
      marketStats.volume.last1minEMA = (2 / 61) * vol + (1 - 2 / 61) * vol;
      marketStats.volume.last1hrEMA = (2 / 3601) * vol + (1 - 2 / 3601) * vol;
    }
  }

  public async sendTransaction(txn: () => Promise<void>) {
    const tx = await client.transaction(this.publicKey, txn, {
      nonce: this.nonce++,
    });
    tx.transaction = tx.transaction?.sign(this.pvtKey);
    await tx.send();
    return new Promise((resolve, reject) => {
      this.sendTxns.push({
        hash: tx.transaction?.hash().toString() || "",
        state: "PENDING",
        promise: { resolve, reject },
        sentAt: Date.now(),
      });
    });
  }

  public async getBalance(tokenId: TokenId): Promise<Balance> {
    // TODO do caching?
    const bal = await client.query.runtime.Balances.balances.get(
      new BalancesKey({
        address: this.publicKey,
        tokenId,
      })
    );
    return bal || Balance.from(0);
  }

  private async getCurrentNonce(address: PublicKey): Promise<number> {
    const accountState =
      await client.query.protocol.AccountState.accountState.get(address);
    return Number(accountState?.nonce.toBigInt() || 0n);
  }
}
