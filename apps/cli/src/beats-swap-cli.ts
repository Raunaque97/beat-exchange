import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import figlet from "figlet";
import { ConfigManager } from "./configManager";
import { WalletManager } from "./walletManager";
import { OrderManager } from "./orderManager";
import { Logger } from "./logger";
import { CLI_NAME, CLI_DESCRIPTION, TOKEN_IDS, DECIMALS } from "./constants";
import ora from "ora";
import { prettyBalance } from "./utils";
import { client } from "chain";
import { TokenId, UInt64 } from "@proto-kit/library";

class BeatExCLI {
  private wallet: WalletManager;
  private orderManager: OrderManager;
  private logger: Logger;

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

  async mainMenu(): Promise<void> {
    console.log(
      chalk.blue(figlet.textSync(CLI_NAME, { horizontalLayout: "full" }))
    );

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
          await this.orderManager.placeOrder();
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
          //@ts-ignore
          TokenId.from(TOKEN_IDS[tokenName])
        );
        balanceTxt += `${tokenName}:\t${prettyBalance(balance)}\n`;
      }
      spinner.succeed(chalk.green(balanceTxt));
    } catch (error) {
      spinner.fail("Failed to fetch balances");
      this.logger.error("Error fetching balances:", error);
    }
  }

  private async mintTestTokens() {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Which token would you like to mint?",
        choices: [...Object.keys(TOKEN_IDS), "Back to Main Menu"],
      },
    ]);

    if (action === "Back to Main Menu") {
      return;
    }
    const spinner = ora("Minting test tokens...").start();
    try {
      //@ts-ignore
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
