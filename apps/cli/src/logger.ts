import chalk from "chalk";

export class Logger {
  info(message: string, ...args: any[]): void {
    console.log(chalk.blue(`[INFO] ${message}`), ...args);
  }

  error(message: string, error?: Error | unknown): void {
    console.error(chalk.red(`[ERROR] ${message}`));
    if (error instanceof Error) {
      console.error(chalk.red(error.stack));
    } else {
      console.error(chalk.red(String(error)));
    }
  }

  warn(message: string, ...args: any[]): void {
    console.warn(chalk.yellow(`[WARN] ${message}`), ...args);
  }

  success(message: string, ...args: any[]): void {
    console.log(chalk.green(`[SUCCESS] ${message}`), ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[DEBUG] ${message}`), ...args);
    }
  }
}
