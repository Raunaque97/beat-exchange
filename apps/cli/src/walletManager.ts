import { Balance, BalancesKey, TokenId, UInt64 } from "@proto-kit/library";
import { PublicKey, PrivateKey } from "o1js";
import { client } from "chain";
import { Logger } from "./logger";
import { ConfigManager } from "./configManager";
import { DEFAULT_GRAPHQL_ENDPOINT } from "./constants";

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
  constructor(
    private configManager: ConfigManager,
    private logger: Logger
  ) {}

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
  }

  private async startPooling(poolingInterval = 200) {
    const pendingTxns =
      this.sendTxns?.filter((t) => t.state === "PENDING") || [];
    if (pendingTxns.length === 0) return;

    // fetch txn status
    for (const txn of pendingTxns) {
      const response = await fetch(this.graphqlEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `query GetTxnState {
							transactionState(hash: "${txn.hash}")
						}`,
        }),
      });
      const { data } = await response.json();
      txn.state = data?.transactionState;
      // console.log("txn ", txn.hash + " :", txn.state);
      if (data?.transactionState === "INCLUDED") {
        // TODO change to `finalized`
        txn.promise.resolve({});
      } else if (data?.transactionState === "UNKNOWN") {
        console.log("reject", data);
        txn.promise.reject();
        // TODO reject on failure
      } else if (txn.sentAt + 10000 < Date.now()) {
        txn.state = "TIMED_OUT";
        txn.promise.reject();
      }
    }
    setTimeout(this.startPooling.bind(this), poolingInterval);
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
        promise: {
          resolve,
          reject,
        },
        sentAt: Date.now(),
      });
      this.startPooling();
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
