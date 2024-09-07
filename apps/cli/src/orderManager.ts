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

  async placeOrder(
    market: keyof typeof MARKETS,
    side: "Buy" | "Sell"
  ): Promise<void> {
    const { orderType } = (await inquirer.prompt([
      {
        type: "list",
        name: "orderType",
        message: "Select order type:",
        choices: ["Limit", "Market", "Custom", "Cancel"],
      },
    ])) as { orderType: "Limit" | "Market" | "Custom" | "Cancel" };
    if (orderType === "Cancel") {
      return;
    }

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
    const { amount, price } = await inquirer.prompt([
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
    ]);

    const spinner = ora("Placing buy order...").start();

    try {
      await this.placeBuyOrder(MARKETS[market], amount, amount, price, price);
      spinner.succeed("Buy order placed successfully!");
    } catch (error) {
      spinner.fail("Failed to place buy order");
      this.logger.error("Error placing buy order:", error);
    }
  }

  private async handleLimitSell(market: keyof typeof MARKETS): Promise<void> {
    const { amount, price } = await inquirer.prompt([
      {
        type: "number",
        name: "amount",
        message: "Enter amount to sell:",
      },
      {
        type: "number",
        name: "price",
        message: "Enter price:",
      },
    ]);

    const spinner = ora("Placing sell order...").start();

    try {
      await this.placeSellOrder(MARKETS[market], amount, amount, price, price);
      spinner.succeed("Sell order placed successfully!");
    } catch (error) {
      spinner.fail("Failed to place sell order");
      this.logger.error("Error placing sell order:", error);
    }
  }

  private async handleMarketBuy(market: keyof typeof MARKETS): Promise<void> {
    const { amount } = await inquirer.prompt([
      {
        type: "number",
        name: "amount",
        message: "Enter amount to buy:",
      },
    ]);

    const spinner = ora("Placing market buy order...").start();

    try {
      await this.placeBuyOrder(MARKETS[market], amount, amount, 0, 2 ** 32);
      spinner.succeed("Market buy order placed successfully!");
    } catch (error) {
      spinner.fail("Failed to place market buy order");
      this.logger.error("Error placing market buy order:", error);
    }
  }

  private async handleMarketSell(market: keyof typeof MARKETS): Promise<void> {
    const { amount } = await inquirer.prompt([
      {
        type: "number",
        name: "amount",
        message: "Enter amount to sell:",
      },
    ]);

    const spinner = ora("Placing market sell order...").start();

    try {
      await this.placeSellOrder(MARKETS[market], amount, amount, 0, 2 ** 32);
      spinner.succeed("Market sell order placed successfully!");
    } catch (error) {
      spinner.fail("Failed to place market sell order");
      this.logger.error("Error placing market sell order:", error);
    }
  }

  private async handleCustom(
    market: keyof typeof MARKETS,
    side: "Buy" | "Sell"
  ): Promise<void> {
    const { amountLow, amountHigh, priceLow, priceHigh } =
      await inquirer.prompt([
        {
          type: "number",
          name: "amountLow",
          message: "Enter minimum amount:",
        },
        {
          type: "number",
          name: "amountHigh",
          message: "Enter maximum amount:",
        },
        {
          type: "number",
          name: "priceLow",
          message: "Enter minimum price:",
        },
        {
          type: "number",
          name: "priceHigh",
          message: "Enter maximum price:",
        },
      ]);

    const spinner = ora(
      `Placing custom ${side.toLowerCase()} order...`
    ).start();

    try {
      if (side === "Buy") {
        await this.placeBuyOrder(
          MARKETS[market],
          amountLow,
          amountHigh,
          priceLow,
          priceHigh
        );
      } else {
        await this.placeSellOrder(
          MARKETS[market],
          amountLow,
          amountHigh,
          priceLow,
          priceHigh
        );
      }
      spinner.succeed(
        `Custom ${side.toLowerCase()} order placed successfully!`
      );
    } catch (error) {
      spinner.fail(`Failed to place custom ${side.toLowerCase()} order`);
      this.logger.error(
        `Error placing custom ${side.toLowerCase()} order:`,
        error
      );
    }
  }

  private async placeBuyOrder(
    pair: TokenPair,
    amountLow: number,
    amountHigh: number,
    priceLow: number,
    priceHigh: number
  ) {
    const dex = client.runtime.resolve("Dex");

    return this.wallet.sendTransaction(async () => {
      await dex.placeBuyOrder(
        pair,
        UInt64.from(amountLow * 10 ** DECIMALS),
        UInt64.from(amountHigh * 10 ** DECIMALS),
        UInt64.from(priceLow),
        UInt64.from(priceHigh)
      );
    });
  }

  private async placeSellOrder(
    pair: TokenPair,
    amountLow: number,
    amountHigh: number,
    priceLow: number,
    priceHigh: number
  ) {
    const dex = client.runtime.resolve("Dex");

    return this.wallet.sendTransaction(async () => {
      await dex.placeSellOrder(
        pair,
        UInt64.from(amountLow * 10 ** DECIMALS),
        UInt64.from(amountHigh * 10 ** DECIMALS),
        UInt64.from(priceLow),
        UInt64.from(priceHigh)
      );
    });
  }
}
