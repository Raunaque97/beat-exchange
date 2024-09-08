import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import figlet from "figlet";
import { ConfigManager } from "./configManager";
import { WalletManager } from "./walletManager";
import { OrderManager } from "./orderManager";
import { Logger } from "./logger";
import {
  CLI_NAME,
  CLI_DESCRIPTION,
  TOKEN_IDS,
  DECIMALS,
  MARKETS,
  tokenNameFromId,
} from "./constants";
import ora from "ora";
import { prettyBalance } from "./utils";
import { client } from "chain";
import { TokenId, UInt64 } from "@proto-kit/library";
import ansiEscapes from "ansi-escapes";

class BeatExCLI {
  private wallet: WalletManager;
  private orderManager: OrderManager;
  private logger: Logger;
  private headerHeight: number = 0;

  constructor() {
    this.wallet = new WalletManager(new ConfigManager(), new Logger());
    this.logger = new Logger();
    this.orderManager = new OrderManager(this.wallet, this.logger);
  }

  async initialize(): Promise<void> {
    try {
      await this.wallet.initialize();
    } catch (error) {
      this.logger.error(`Failed to initialize ${CLI_NAME} CLI:`, error);
      process.exit(1);
    }
  }

  private printHeader(subheader?: string): void {
    console.clear();
    const figletText = chalk.blue(
      figlet.textSync(CLI_NAME, { horizontalLayout: "full" })
    );
    const separator = chalk.yellow("-".repeat(process.stdout.columns));
    let headerContent = figletText + "\n" + separator + "\n";
    this.headerHeight = figletText.split("\n").length + 1; // +1 for the separator
    if (subheader) {
      headerContent += chalk.yellow(subheader);
      this.headerHeight += subheader.split("\n").length;
    }

    console.log(headerContent);
  }

  private printMarketInfo(
    market: string,
    statsText: string,
    firstTime = false
  ): void {
    // Save cursor position
    // process.stdout.write("\u001B[s");
    if (!firstTime) {
      process.stdout.write(ansiEscapes.cursorSavePosition);

      // Move cursor to just below the header
      process.stdout.write(ansiEscapes.cursorShow);
      process.stdout.write(`\u001B[${this.headerHeight + 1};0H`);

      // Clear the next 6 lines (5 for stats + 1 for separator)
      for (let i = 0; i < 6; i++) {
        process.stdout.write("\u001B[2K\u001B[1E");
      }

      // Move cursor back to just below the header
      process.stdout.write(`\u001B[${this.headerHeight + 1};0H`);
    }
    // Print the new market info
    console.log(statsText);
    console.log(chalk.yellow("-".repeat(process.stdout.columns)));
    if (!firstTime) {
      // Restore cursor position
      // process.stdout.write("\u001B[u");

      // process.stdout.write(`\u001B[${this.headerHeight + 10};0H`);

      process.stdout.write(ansiEscapes.cursorRestorePosition);
    }
  }

  async mainMenu(): Promise<void> {
    this.printHeader();

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: ["View Balances", "Mint Test Tokens", "Place Order", "Exit"],
      },
    ]);

    try {
      switch (action) {
        case "View Balances":
          await this.viewBalances();
          break;
        case "Mint Test Tokens":
          await this.mintTestTokens();
          break;
        case "Place Order":
          await this.marketMenu();
          break;
        case "Exit":
          process.exit(0);
      }
    } catch (error) {
      this.logger.error(`Error during ${action}:`, error);
    }

    // Return to main menu after action is completed
    await this.mainMenu();
  }

  async marketMenu(): Promise<void> {
    this.printHeader("Market Selection");

    const { market } = await inquirer.prompt([
      {
        type: "list",
        name: "market",
        message: "Select a market:",
        choices: [...Object.keys(MARKETS), "Back to Main Menu"],
      },
    ]);

    if (market === "Back to Main Menu") {
      return;
    }

    await this.marketSection(market);
  }

  async marketSection(market: keyof typeof MARKETS): Promise<void> {
    this.printHeader(`Market: ${market}`);
    const updateMarketInfo = async (firstTime: boolean) => {
      const marketInfo = this.wallet.marketStats.get(market);
      const balanceA = await this.wallet.getBalance(MARKETS[market].a);
      const balanceB = await this.wallet.getBalance(MARKETS[market].b);

      const statsText = `Block: ${this.wallet.latestBlockHeight} price: ${chalk.green(marketInfo?.prices.at(-1) || "N/A")}
Volume (Last 10s EMA): ${marketInfo?.volume.last10sEMA.toFixed(2) || "0.0"}
Volume (Last 1min EMA): ${marketInfo?.volume.last1minEMA.toFixed(2) || "0.0"}
Volume (Last 1hr EMA): ${marketInfo?.volume.last1hrEMA.toFixed(2) || "0.0"}
Balances: ${chalk.green(`${prettyBalance(balanceA)} ${tokenNameFromId(MARKETS[market].a)} | ${prettyBalance(balanceB)} ${tokenNameFromId(MARKETS[market].b)}`)}`;

      this.printMarketInfo(market, statsText, firstTime);
    };

    // Start updating market info
    const intervalId = setInterval(updateMarketInfo, 200);
    await updateMarketInfo(true);
    // process.stdout.write(`\u001B[15;0H`);
    while (true) {
      const prompt = inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What would you like to do?",
          choices: ["Buy", "Sell", "Back to Main Menu"],
        },
      ]);
      const { action } = (await prompt) as {
        action: "Buy" | "Sell" | "Back to Main Menu";
      };

      if (action === "Back to Main Menu") {
        clearInterval(intervalId);
        return;
      }
      await this.orderManager.placeOrder(market, action);
      console.clear();
      this.printHeader(`Market: ${market}`);
      await updateMarketInfo(true);
    }
  }

  async run(): Promise<void> {
    await this.initialize();
    await this.mainMenu();
  }

  private async viewBalances(): Promise<void> {
    const spinner = ora("Fetching balances...").start();
    let balanceTxt = "\n";
    try {
      for (const tokenName in TOKEN_IDS) {
        if (!(tokenName in TOKEN_IDS)) continue;
        const balance = await this.wallet.getBalance(
          TokenId.from(TOKEN_IDS[tokenName as keyof typeof TOKEN_IDS])
        );
        balanceTxt += `${tokenName}:\t${prettyBalance(balance)}\n`;
      }
      spinner.succeed(chalk.green(balanceTxt));
    } catch (error) {
      spinner.fail("Failed to fetch balances");
      this.logger.error("Error fetching balances:", error);
    }
    await inquirer.prompt([
      {
        type: "input",
        name: "continue",
        message: "Press enter to continue...",
      },
    ]);
  }

  private async mintTestTokens() {
    const { action } = (await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Which token would you like to mint?",
        choices: [...Object.keys(TOKEN_IDS), "Back to Main Menu"],
      },
    ])) as { action: keyof typeof TOKEN_IDS | "Back to Main Menu" };

    if (action === "Back to Main Menu") {
      return;
    }
    const spinner = ora("Minting test tokens...").start();
    try {
      const tokenId = TOKEN_IDS[action] as number;
      const amt = tokenId === 2 ? 1 : 1000;
      const balances = client.runtime.resolve("Balances");
      const txn = this.wallet.sendTransaction(async () => {
        await balances.addBalance(
          TokenId.from(tokenId),
          this.wallet.publicKey,
          UInt64.from(amt * 10 ** DECIMALS)
        );
      });
      await txn
        .then(() => {
          spinner.succeed("Test tokens minted successfully!");
          console.log(chalk.green(`+${amt} ${action}`));
        })
        .catch((reason) => {
          spinner.fail("Failed to mint test tokens");
          this.logger.error(reason);
        });
    } catch (error) {
      spinner.fail("Failed to mint test tokens");
      this.logger.error("Error minting test tokens:", error);
    }
    await inquirer.prompt([
      {
        type: "input",
        name: "continue",
        message: "Press enter to continue...",
      },
    ]);
  }
}

const program = new Command();

program
  .name(CLI_NAME.toLowerCase())
  .description(CLI_DESCRIPTION)
  .action(async () => {
    const cli = new BeatExCLI();
    await cli.run();
  });

program.parse(process.argv);
