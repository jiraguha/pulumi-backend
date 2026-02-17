import Spinner from "cli_spinners";
import { bgBlue, black, bold, dim, green, yellow, red } from "./colors.ts";
import { SYMBOLS } from "./symbols.ts";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  SUCCESS = 2,
  WARNING = 3,
  ERROR = 4,
}

export interface LoggerConfig {
  logLevel: LogLevel;
  quiet: boolean;
  interactive: boolean;
  yes: boolean;
}

export class Logger {
  private logLevel: LogLevel;
  private quiet: boolean;
  private interactive: boolean;
  private yes: boolean;
  private activeSpinners: Set<string> = new Set();
  private spinner: Spinner = Spinner.getInstance();
  private indentLevel = 0;
  private timestamps: Map<string, number> = new Map();

  constructor(config: LoggerConfig) {
    this.logLevel = config.logLevel;
    this.quiet = config.quiet;
    this.interactive = config.interactive;
    this.yes = config.yes;
  }

  private formatMessage(message: string, symbol: string): string {
    const indent = "  ".repeat(this.indentLevel);
    return `${indent}${symbol} ${message}`;
  }

  debug(message: string): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      console.log(this.formatMessage(dim(message), dim("🔍")));
    }
  }

  info(message: string): void {
    if (this.logLevel <= LogLevel.INFO) {
      console.log(this.formatMessage(message, SYMBOLS.info));
    }
  }

  success(message: string): void {
    if (this.logLevel <= LogLevel.SUCCESS) {
      console.log(this.formatMessage(green(message), SYMBOLS.success));
    }
  }

  warning(message: string): void {
    if (this.logLevel <= LogLevel.WARNING) {
      console.log(this.formatMessage(yellow(message), SYMBOLS.warning));
    }
  }

  error(message: string): void {
    if (this.logLevel <= LogLevel.ERROR) {
      console.log(this.formatMessage(red(message), SYMBOLS.error));
    }
  }

  section(title: string): void {
    if (this.logLevel <= LogLevel.INFO) {
      console.log();
      console.log(this.formatMessage(bgBlue(black(` ${title.toUpperCase()} `)), ""));
    }
  }

  indent(): void {
    this.indentLevel++;
  }

  outdent(): void {
    if (this.indentLevel > 0) {
      this.indentLevel--;
    }
  }

  startTimer(id: string): void {
    this.timestamps.set(id, performance.now());
  }

  endTimer(id: string): number {
    const start = this.timestamps.get(id);
    if (!start) return 0;
    const elapsed = performance.now() - start;
    this.timestamps.delete(id);
    return elapsed;
  }

  startSpinner(id: string, message: string): void {
    if (this.logLevel <= LogLevel.INFO && !this.quiet) {
      this.activeSpinners.add(id);
      this.spinner.start(this.formatMessage(message, ""));
    } else {
      this.info(message);
    }
    this.startTimer(id);
  }

  updateSpinner(id: string, message: string): void {
    if (this.logLevel <= LogLevel.INFO && !this.quiet && this.activeSpinners.has(id)) {
      this.spinner.setText(this.formatMessage(message, ""));
    }
  }

  private formatElapsed(elapsed: number): string {
    return elapsed ? ` ${dim(`(${(elapsed / 1000).toFixed(1)}s)`)}` : "";
  }

  private stopSpinnerById(id: string): boolean {
    if (this.activeSpinners.has(id)) {
      this.spinner.stop();
      this.activeSpinners.delete(id);
      return true;
    }
    return false;
  }

  successSpinner(id: string, message: string): void {
    const elapsed = this.endTimer(id);
    const elapsedText = this.formatElapsed(elapsed);

    if (this.logLevel <= LogLevel.SUCCESS && !this.quiet) {
      if (this.stopSpinnerById(id)) {
        console.log(this.formatMessage(`${green(message)}${elapsedText}`, SYMBOLS.success));
      } else {
        this.success(`${message}${elapsedText}`);
      }
    }
  }

  warningSpinner(id: string, message: string): void {
    const elapsed = this.endTimer(id);
    const elapsedText = this.formatElapsed(elapsed);

    if (this.logLevel <= LogLevel.WARNING && !this.quiet) {
      if (this.stopSpinnerById(id)) {
        console.log(this.formatMessage(`${yellow(message)}${elapsedText}`, SYMBOLS.warning));
      } else {
        this.warning(`${message}${elapsedText}`);
      }
    }
  }

  errorSpinner(id: string, message: string): void {
    const elapsed = this.endTimer(id);
    const elapsedText = this.formatElapsed(elapsed);

    if (this.logLevel <= LogLevel.ERROR && !this.quiet) {
      if (this.stopSpinnerById(id)) {
        console.log(this.formatMessage(`${red(message)}${elapsedText}`, SYMBOLS.error));
      } else {
        this.error(`${message}${elapsedText}`);
      }
    }
  }

  table(headers: string[], rows: string[][]): void {
    if (this.logLevel <= LogLevel.INFO) {
      const colWidths = headers.map((h, i) => {
        const values = [h.length, ...rows.map((r) => r[i]?.length || 0)];
        return Math.max(...values);
      });

      const header = headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ");
      console.log(this.formatMessage(bold(header), " "));

      const separator = colWidths.map((w) => "─".repeat(w)).join("─┼─");
      console.log(this.formatMessage(`${separator}`, " "));

      for (const row of rows) {
        const formattedRow = row.map((cell, i) => (cell || "").padEnd(colWidths[i])).join(" | ");
        console.log(this.formatMessage(formattedRow, " "));
      }
      console.log();
    }
  }

  async confirm(question: string, defaultYes = false): Promise<boolean> {
    if (this.yes) return true;
    if (!this.interactive) return defaultYes;

    const suffix = defaultYes ? " (Y/n): " : " (y/N): ";
    const response = prompt(this.formatMessage(question + suffix, SYMBOLS.pending));

    if (response === null || response === "") return defaultYes;
    return /^y(es)?$/i.test(response);
  }

  async prompt(question: string, defaultValue = ""): Promise<string> {
    if (!this.interactive) return defaultValue;

    const defaultText = defaultValue ? ` (default: ${defaultValue})` : "";
    const response = prompt(this.formatMessage(`${question}${defaultText}: `, SYMBOLS.pending));

    if (response === null || response === "") return defaultValue;
    return response;
  }

  async select(question: string, options: string[], defaultIndex = 0): Promise<string> {
    if (!this.interactive) return options[defaultIndex];

    console.log(this.formatMessage(`${question}:`, SYMBOLS.pending));
    this.indent();

    options.forEach((option, index) => {
      const indicator = index === defaultIndex ? `${green(">")} ` : "  ";
      console.log(this.formatMessage(`${indicator}${index + 1}. ${option}`, ""));
    });

    this.outdent();
    const response = prompt(
      this.formatMessage(`Enter selection (1-${options.length}) [${defaultIndex + 1}]: `, ""),
    );

    if (response === null || response === "") return options[defaultIndex];

    const selectedIndex = parseInt(response) - 1;
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) {
      return options[defaultIndex];
    }

    return options[selectedIndex];
  }
}
