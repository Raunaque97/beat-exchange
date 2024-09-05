import { Balance, TokenId, UInt64 } from "@proto-kit/library";
import { PublicKey, PrivateKey } from "o1js";
import { client } from "chain";
import { Logger } from "./logger";
import { DECIMALS, TOKEN_IDS, MARKETS, tokenNameFromId } from "./constants";
import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";
import { TokenPair } from "chain";
import { WalletManager } from "./walletManager";
import { prettyBalance } from "./utils";

export class OrderManager {
  constructor(
    private wallet: WalletManager,
    private logger: Logger
  ) {}

  async placeOrder(): Promise<void> {
    const { market } = (await inquirer.prompt([
      {
        type: "list",
        name: "market",
        message: "Available markets:",
        choices: [...Object.keys(MARKETS), "Back to Main Menu"],
      },
    ])) as { market: keyof typeof MARKETS | "Back to Main Menu" };
    if (market === "Back to Main Menu") {
      return;
    }
    const balA = await this.wallet.getBalance(MARKETS[market].a);
    const balB = await this.wallet.getBalance(MARKETS[market].b);
    console.log(
      chalk.blue(
        `Your balances:
        ${tokenNameFromId(MARKETS[market].a)}: ${prettyBalance(balA)}
        ${tokenNameFromId(MARKETS[market].b)}: ${prettyBalance(balB)}`
      )
    );
    const { side } = (await inquirer.prompt([
      {
        type: "list",
        name: "side",
        message: "Select order side:",
        choices: ["Buy", "Sell"],
      },
    ])) as { side: "Buy" | "Sell" };
    const { orderType } = (await inquirer.prompt([
      {
        type: "list",
        name: "orderType",
        message: "Select order type:",
        choices: ["Limit", "Market", "Custom"],
      },
    ])) as { orderType: "Limit" | "Market" | "Custom" };

    if (orderType === "Limit" && side === "Buy") {
      await this.handleLimitBuy(market);
    } else if (orderType === "Limit" && side === "Sell") {
      await this.handleLimitSell(market);
    } else if (orderType === "Market" && side === "Buy") {
      await this.handleMarketBuy(market);
    } else if (orderType === "Market" && side === "Sell") {
      await this.handleMarketSell(market);
    } else if (orderType === "Custom") {
      await this.handleCustom(market, side);
    }
  }

  private async handleLimitBuy(market: keyof typeof MARKETS): Promise<void> {
    const { amount, price } = (await inquirer.prompt([
      {
        type: "number",
        name: "amount",
        message: "Enter amount to buy:",
      },
      {
        type: "number",
        name: "price",
        message: "Enter price:",
      },
    ])) as { amount: number; price: number };

    const spinner = ora("Placing buy order...").start();

    try {
      await this.placeBuyOrder(MARKETS[market], amount, amount, 0, price);
      spinner.succeed("SUCCESS!!!");
    } catch (error) {
      spinner.fail("Failed to place buy order");
      this.logger.error("Error placing buy order:", error);
    }
  }

  private async handleLimitSell(market: keyof typeof MARKETS): Promise<void> {}

  private async handleMarketBuy(market: keyof typeof MARKETS): Promise<void> {}

  private async handleMarketSell(market: keyof typeof MARKETS): Promise<void> {}

  private async handleCustom(
    market: keyof typeof MARKETS,
    side: "Buy" | "Sell"
  ): Promise<void> {}

  private async placeBuyOrder(
    pair: TokenPair,
    amount_low: number,
    amount_high: number,
    price_low: number,
    price_high: number
  ) {
    const dex = client.runtime.resolve("Dex");

    return this.wallet.sendTransaction(async () => {
      await dex.placeBuyOrder(
        pair,
        UInt64.from(amount_low * 10 ** DECIMALS),
        UInt64.from(amount_high * 10 ** DECIMALS),
        UInt64.from(price_low),
        UInt64.from(price_high)
      );
    });
  }
}
