import * as fs from "fs";
import * as path from "path";
import inquirer from "inquirer";
import { PrivateKey } from "o1js";

interface Config {
  privateKey: string;
  graphqlEndpoint: string;
}

export class ConfigManager {
  private static CONFIG_DIR = path.join(
    process.env.HOME || process.env.USERPROFILE || ".",
    ".beat-ex"
  );
  private static CONFIG_FILE = path.join(this.CONFIG_DIR, "config.json");

  async loadOrCreateConfig(): Promise<Config> {
    if (!fs.existsSync(ConfigManager.CONFIG_DIR)) {
      fs.mkdirSync(ConfigManager.CONFIG_DIR, { recursive: true });
    }

    if (fs.existsSync(ConfigManager.CONFIG_FILE)) {
      return this.loadConfig();
    } else {
      return this.createConfig();
    }
  }

  private async loadConfig(): Promise<Config> {
    try {
      const config = JSON.parse(
        fs.readFileSync(ConfigManager.CONFIG_FILE, "utf-8")
      );
      return config;
    } catch (error) {
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  private async createConfig(): Promise<Config> {
    const privateKey = PrivateKey.random();
    const { confirmGenerate } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmGenerate",
        message: "No private key found. Do you want to generate a new one?",
        default: true,
      },
    ]);

    if (!confirmGenerate) {
      throw new Error("Cannot proceed without a private key.");
    }

    const { graphqlEndpoint } = await inquirer.prompt([
      {
        type: "input",
        name: "graphqlEndpoint",
        message: "Enter the GraphQL endpoint:",
        default: "http://localhost:8080/graphql",
      },
    ]);

    const config: Config = {
      privateKey: privateKey.toBase58(),
      graphqlEndpoint,
    };

    try {
      fs.writeFileSync(
        ConfigManager.CONFIG_FILE,
        JSON.stringify(config, null, 2)
      );
      console.log("Configuration saved successfully.");
      return config;
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error}`);
    }
  }

  async getConfig(): Promise<Config> {
    return this.loadConfig();
  }
}
