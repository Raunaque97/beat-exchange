import { UInt64 } from "@proto-kit/library";
import { client } from "chain";
import { Logger } from "./logger";
import { DECIMALS, TOKEN_IDS, MARKETS, tokenNameFromId } from "./constants";
import inquirer from "inquirer";
import ora from "ora";
import { TokenPair } from "chain";
import { WalletManager } from "./walletManager";

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
    await inquirer.prompt([
      {
        type: "confirm",
        name: "continue",
        message: "Press enter to continue...",
      },
    ]);
  }

  private async handleLimitBuy(market: keyof typeof MARKETS): Promise<void> {
    const tokenABal = await this.wallet.getBalance(MARKETS[market].a);
    const tokenABal_float = Number(tokenABal.toBigInt()) / 10 ** DECIMALS;
    const { amount, price } = await inquirer.prompt([
      {
        type: "number",
        name: "amount",
        message: "Enter amount to buy:",
        validate: (value) => {
          if (!value || isNaN(value)) {
            return "Please enter a valid number";
          }
          if (value <= 0) {
            return "Please enter a number greater than 0";
          }
          if (value > tokenABal_float) {
            return `Insufficient balance`;
          }
          return true;
        },
      },
      {
        type: "number",
        name: "price",
        message: "Enter price to buy at:",
      },
    ]);

    const spinner = ora("Executing buy order...").start();

    try {
      await this.placeBuyOrder(
        MARKETS[market],
        amount,
        amount,
        price / 2,
        price
      );
      spinner.succeed("Buy order placed successfully!");
    } catch (error) {
      spinner.fail("Failed to place buy order");
      this.logger.error("Error executing buy order:", error);
    }
  }

  private async handleLimitSell(market: keyof typeof MARKETS): Promise<void> {
    const tokenBBal = await this.wallet.getBalance(MARKETS[market].b);
    const tokenBBal_float = Number(tokenBBal.toBigInt()) / 10 ** DECIMALS;
    const { amount, price } = await inquirer.prompt([
      {
        type: "number",
        name: "amount",
        message: "Enter amount to sell:",
        validate: (value) => {
          if (!value || isNaN(value)) {
            return "Please enter a valid number";
          }
          if (value <= 0) {
            return "Please enter a number greater than 0";
          }
          if (value > tokenBBal_float) {
            return `Insufficient balance`;
          }
          return true;
        },
      },
      {
        type: "number",
        name: "price",
        message: "Enter price:",
      },
    ]);

    const spinner = ora("Executing sell order...").start();

    try {
      await this.placeSellOrder(
        MARKETS[market],
        amount * price,
        amount * price * 2,
        price,
        price * 2
      );
      spinner.succeed("Sell order placed successfully!");
    } catch (error) {
      spinner.fail("Failed to place sell order");
      this.logger.error("Error executing sell order:", error);
    }
  }

  private async handleMarketBuy(market: keyof typeof MARKETS): Promise<void> {
    const tokenABal = await this.wallet.getBalance(MARKETS[market].a);
    const tokenABal_float = Number(tokenABal.toBigInt()) / 10 ** DECIMALS;
    const { amount } = await inquirer.prompt([
      {
        type: "number",
        name: "amount",
        message: "Enter amount to buy:",
        validate: (value) => {
          if (!value || isNaN(value)) {
            return "Please enter a valid number";
          }
          if (value <= 0) {
            return "Please enter a number greater than 0";
          }
          if (value > tokenABal_float) {
            return `Insufficient balance`;
          }
          return true;
        },
      },
    ]);

    const spinner = ora("Executing market buy order...").start();

    try {
      await this.placeBuyOrder(MARKETS[market], amount, amount, 10, 2 ** 32);
      spinner.succeed("Market buy order placed successfully!");
    } catch (error) {
      spinner.fail("Failed to place market buy order");
      this.logger.error("Error executing market buy order:", error);
    }
  }

  private async handleMarketSell(market: keyof typeof MARKETS): Promise<void> {
    const tokenBBal = await this.wallet.getBalance(MARKETS[market].b);
    const tokenBBal_float = Number(tokenBBal.toBigInt()) / 10 ** DECIMALS;
    const { amount } = await inquirer.prompt([
      {
        type: "number",
        name: "amount",
        message: "Enter amount to sell:",
        validate: (value) => {
          if (!value || isNaN(value)) {
            return "Please enter a valid number";
          }
          if (value <= 0) {
            return "Please enter a number greater than 0";
          }
          if (value > tokenBBal_float) {
            return `Insufficient balance`;
          }
          return true;
        },
      },
    ]);

    const spinner = ora("Executing market sell order...").start();

    try {
      await this.placeSellOrder(
        MARKETS[market],
        amount * 10,
        amount * 2 ** 30,
        10,
        2 ** 30
      );
      spinner.succeed("Market sell order placed successfully!");
    } catch (error) {
      spinner.fail("Failed to place market sell order");
      this.logger.error("Error executing market sell order:", error);
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
      `Executing custom ${side.toLowerCase()} order...`
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
        `Error executing custom ${side.toLowerCase()} order:`,
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
        UInt64.from(Math.floor(amountLow * 10 ** DECIMALS)),
        UInt64.from(Math.floor(amountHigh * 10 ** DECIMALS)),
        UInt64.from(Math.floor(priceLow)),
        UInt64.from(Math.floor(priceHigh))
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
        UInt64.from(Math.floor(amountLow * 10 ** DECIMALS)),
        UInt64.from(Math.floor(amountHigh * 10 ** DECIMALS)),
        UInt64.from(Math.floor(priceLow)),
        UInt64.from(Math.floor(priceHigh))
      );
    });
  }
}
