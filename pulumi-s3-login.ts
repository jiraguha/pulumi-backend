#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

/**
 * 🚀 Pulumi Cloud Migration Tool
 * 
 * A professional-grade CLI tool to migrate Pulumi stacks from an S3 backend to Pulumi Cloud.
 * Features enhanced logging, progress tracking, and comprehensive secrets management.
 * 
 * 📋 Usage:
 *   deno run --allow-run --allow-read --allow-write --allow-env pulumi-cloud-migrate.ts \
 *     --stack=mystack \
 *     --backend=s3://my-pulumi-state-bucket?region=us-west-2 \
 *     --organization=my-org
 */

import { parse } from "https://deno.land/std/flags/mod.ts";
import { join, basename} from "https://deno.land/std/path/mod.ts";
import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import {
  bgGreen, bgBlue, bgYellow, bgRed, bgCyan,
  black, bold, italic, underline, dim, red, yellow, green, blue, cyan, magenta, white, gray
} from "https://deno.land/std/fmt/colors.ts";

// CLI progress bar implementation
import Spinner from "https://deno.land/x/cli_spinners@v0.0.3/mod.ts";

// =============================================================================
// CLI Configuration
// =============================================================================
const currentDir = basename(Deno.cwd());
const defaultProjectName = currentDir.toLowerCase().replace(/[^a-z0-9-]/g, '-');
const statePrefix = "";
const defaultRegion = Deno.env.get("AWS_REGION") || "eu-west-3";
// Define command line arguments
const args = parse(Deno.args, {
  string: [
  ],
  boolean: [
    "help", "verbose", "quiet",
    "yes", "no-color", "interactive"
  ],
  alias: {
    h: "help",
    v: "verbose",
    y: "yes",
    q: "quiet",
    i: "interactive",
  },
  default: {
    "interactive": true,
    "no-color": false,
    verbose: false,
    quiet: false
  }
});

// Disable colors if requested
if (args["no-color"]) {
  // Neutralize color functions
  const noColor = (str: string): string => str;
  Object.assign(
    { bgGreen, bgBlue, bgYellow, bgRed, bgCyan, 
      black, bold, italic, underline, dim, red, yellow, green, blue, cyan, magenta },
    Array(15).fill(noColor)
  );
}

// =============================================================================
// Symbols and UI Elements
// =============================================================================

const SYMBOLS = {
  info: blue("ℹ"),
  success: green("✓"),
  warning: yellow("⚠"),
  error: red("✗"),
  pending: yellow("⋯"),
  bullet: cyan("•"),
  arrow: cyan("→"),
  rocket: "🚀",
  gear: "⚙️",
  key: "🔑",
  lock: "🔒",
  cloud: "☁️",
  folder: "📁",
  download: "📥",
  upload: "📤",
  database: "🗄️",
  check: "✅"
};

// CLI Logo/Banner
function showBanner() {
  if (args.quiet) return;
  
  console.log(
    `
${bgBlue(black(" PULUMI "))}${bgCyan(black(" BACKEND "))}${bgGreen(black(" LOGIN "))} ${cyan("v1.0.0")}

${dim("Auto login pulumi to S3 backend.")}
`);
}

// =============================================================================
// Logging System
// =============================================================================

// Log level enum
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  SUCCESS = 2,
  WARNING = 3,
  ERROR = 4
}

// Current log level based on args
const currentLogLevel = args.quiet 
  ? LogLevel.ERROR
  : args.verbose 
    ? LogLevel.DEBUG 
    : LogLevel.INFO;

/**
 * Logger class for consistent, styled output
 */
class Logger {
  private logLevel: LogLevel;
  private spinners: Map<string, any> = new Map();
  private indentLevel: number = 0;
  private timestamps: Map<string, number> = new Map();

  constructor(logLevel: LogLevel = LogLevel.INFO) {
    this.logLevel = logLevel;
  }

  /**
   * Formats a message with the appropriate indentation and prefix
   */
  private formatMessage(message: string, symbol: string): string {
    const indent = "  ".repeat(this.indentLevel);
    return `${indent}${symbol} ${message}`;
  }

  /**
   * Logs a debug message (only when verbose is enabled)
   */
  debug(message: string): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      console.log(this.formatMessage(dim(message), dim("🔍")));
    }
  }

  /**
   * Logs an informational message
   */
  info(message: string): void {
    if (this.logLevel <= LogLevel.INFO) {
      console.log(this.formatMessage(message, SYMBOLS.info));
    }
  }

  /**
   * Logs a success message
   */
  success(message: string): void {
    if (this.logLevel <= LogLevel.SUCCESS) {
      console.log(this.formatMessage(green(message), SYMBOLS.success));
    }
  }

  /**
   * Logs a warning message
   */
  warning(message: string): void {
    if (this.logLevel <= LogLevel.WARNING) {
      console.log(this.formatMessage(yellow(message), SYMBOLS.warning));
    }
  }

  /**
   * Logs an error message
   */
  error(message: string): void {
    if (this.logLevel <= LogLevel.ERROR) {
      console.log(this.formatMessage(red(message), SYMBOLS.error));
    }
  }

  /**
   * Logs a section header
   */
  section(title: string): void {
    if (this.logLevel <= LogLevel.INFO) {
      console.log();
      console.log(
        this.formatMessage(
          bgBlue(black(` ${title.toUpperCase()} `)), 
          ""
        )
      );
    }
  }

  /**
   * Increases the indentation level
   */
  indent(): void {
    this.indentLevel++;
  }

  /**
   * Decreases the indentation level
   */
  outdent(): void {
    if (this.indentLevel > 0) {
      this.indentLevel--;
    }
  }

  /**
   * Start a timer for an operation
   */
  startTimer(id: string): void {
    this.timestamps.set(id, performance.now());
  }

  /**
   * End a timer and return the elapsed time in ms
   */
  endTimer(id: string): number {
    const start = this.timestamps.get(id);
    if (!start) return 0;
    
    const elapsed = performance.now() - start;
    this.timestamps.delete(id);
    return elapsed;
  }

  /**
   * Starts a spinner for a long-running operation
   */
  startSpinner(id: string, message: string): void {
    if (this.logLevel <= LogLevel.INFO && !args.quiet) {
      const spinner = new Spinner({
        message: this.formatMessage(message, ""),
        color: "cyan"
      });
      
      this.spinners.set(id, spinner);
      spinner.start();
    } else {
      // Just log the message without a spinner in quiet mode
      this.info(message);
    }
    
    // Start a timer regardless of spinner
    this.startTimer(id);
  }

  /**
   * Updates the message of an existing spinner
   */
  updateSpinner(id: string, message: string): void {
    if (this.logLevel <= LogLevel.INFO && !args.quiet) {
      const spinner = this.spinners.get(id);
      if (spinner) {
        spinner.message = this.formatMessage(message, "");
      }
    }
  }

  /**
   * Stops a spinner with a success message
   */
  successSpinner(id: string, message: string): void {
    const elapsed = this.endTimer(id);
    const elapsedText = elapsed ? ` ${dim(`(${(elapsed/1000).toFixed(1)}s)`)}` : '';
    
    if (this.logLevel <= LogLevel.SUCCESS && !args.quiet) {
      const spinner = this.spinners.get(id);
      if (spinner) {
        spinner.stop();
        this.spinners.delete(id);
        console.log(this.formatMessage(`${green(message)}${elapsedText}`, SYMBOLS.success));
      } else {
        this.success(`${message}${elapsedText}`);
      }
    }
  }

  /**
   * Stops a spinner with a warning message
   */
  warningSpinner(id: string, message: string): void {
    const elapsed = this.endTimer(id);
    const elapsedText = elapsed ? ` ${dim(`(${(elapsed/1000).toFixed(1)}s)`)}` : '';
    
    if (this.logLevel <= LogLevel.WARNING && !args.quiet) {
      const spinner = this.spinners.get(id);
      if (spinner) {
        spinner.stop();
        this.spinners.delete(id);
        console.log(this.formatMessage(`${yellow(message)}${elapsedText}`, SYMBOLS.warning));
      } else {
        this.warning(`${message}${elapsedText}`);
      }
    }
  }

  /**
   * Stops a spinner with an error message
   */
  errorSpinner(id: string, message: string): void {
    const elapsed = this.endTimer(id);
    const elapsedText = elapsed ? ` ${dim(`(${(elapsed/1000).toFixed(1)}s)`)}` : '';
    
    if (this.logLevel <= LogLevel.ERROR && !args.quiet) {
      const spinner = this.spinners.get(id);
      if (spinner) {
        spinner.stop();
        this.spinners.delete(id);
        console.log(this.formatMessage(`${red(message)}${elapsedText}`, SYMBOLS.error));
      } else {
        this.error(`${message}${elapsedText}`);
      }
    }
  }

  /**
   * Ask a yes/no question and get user input
   */
  async confirm(question: string, defaultYes = false): Promise<boolean> {
    if (args.yes) return true;
    if (!args.interactive) return defaultYes;
    
    const suffix = defaultYes ? " (Y/n): " : " (y/N): ";
    const response = prompt(this.formatMessage(question + suffix, SYMBOLS.pending));
    
    if (response === null || response === "") return defaultYes;
    return /^y(es)?$/i.test(response);
  }


  /**
   * Ask for text input with a default value
   */
  async prompt(question: string, defaultValue: string = ""): Promise<string> {
    if (!args.interactive) return defaultValue;

    const defaultText = defaultValue ? ` (default: ${defaultValue})` : '';
    const response = prompt(this.formatMessage(`${question}${defaultText}: `, SYMBOLS.pending));

    if (response === null || response === "") return defaultValue;
    return response;
  }

  /**
   * Ask to select from a list of options
   */
  async select(question: string, options: string[], defaultIndex: number = 0): Promise<string> {
    if (!args.interactive) return options[defaultIndex];

    console.log(this.formatMessage(`${question}:`, SYMBOLS.pending));
    this.indent();

    options.forEach((option, index) => {
      const indicator = index === defaultIndex ? `${green('>')} ` : '  ';
      console.log(this.formatMessage(`${indicator}${index + 1}. ${option}`, ""));
    });

    this.outdent();
    const response = prompt(this.formatMessage(`Enter selection (1-${options.length}) [${defaultIndex + 1}]: `, ""));

    if (response === null || response === "") return options[defaultIndex];

    const selectedIndex = parseInt(response) - 1;
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) {
      return options[defaultIndex];
    }

    return options[selectedIndex];
  }
}

// Create a global logger instance
const logger = new Logger(currentLogLevel);

// =============================================================================
// Command Execution
// =============================================================================

/**
 * Execute a shell command with improved output handling
 */
async function executeCommand(
  command: string[], 
  options: { 
    cwd?: string; 
    silent?: boolean;
    showOutput?: boolean;
    spinnerMessage?: string;
    successMessage?: string;
    errorMessage?: string;
    env?: Record<string, string>;
  } = {}
): Promise<{ output: string; success: boolean }> {
  const { 
    cwd = ".", 
    silent = false,
    showOutput = false,
    spinnerMessage,
    successMessage,
    errorMessage,
    env = {}
  } = options;
  
  const cmdString = command.join(" ");
  const spinnerId = `cmd-${Date.now()}`;
  
  try {
    if (!silent) {
      logger.debug(`Executing: ${cmdString}`);
      
      if (spinnerMessage) {
        logger.startSpinner(spinnerId, spinnerMessage);
      }
    }

    // Prepare environment variables
    const envVars: Record<string, string> = { ...Deno.env.toObject(), ...env };

    const process = Deno.run({
      cmd: command,
      cwd,
      stdout: "piped",
      stderr: "piped",
      env: envVars
    });

    const [status, stdout, stderr] = await Promise.all([
      process.status(),
      process.output(),
      process.stderrOutput(),
    ]);

    process.close();

    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    if (!status.success) {
      throw new Error(errorOutput || `Command exited with code ${status.code}`);
    }

    if (!silent) {
      if (spinnerMessage && successMessage) {
        logger.successSpinner(spinnerId, successMessage);
      }
      
      if (showOutput && output.trim()) {
        logger.indent();
        output.trim().split("\n").forEach(line => {
          logger.debug(line);
        });
        logger.outdent();
      }
      
      if (errorOutput && args.verbose) {
        logger.debug(`Command stderr: ${errorOutput}`);
      }
    }

    return { output: output.trim(), success: true };
  } catch (error) {
    if (!silent) {
      if (spinnerMessage) {
        logger.errorSpinner(
          spinnerId, 
          errorMessage || `Command failed: ${error.message}`
        );
      } else if (!silent) {
        logger.error(`Command failed: ${error.message}`);
      }
    }
    return { output: error.message, success: false };
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Display help information
 */
function showHelp() {
  showBanner();
  
  console.log(`
${bold("USAGE:")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-s3-login.ts [OPTIONS]

${bold("OUTPUT OPTIONS:")}
  -v, --verbose             ${dim("Enable verbose output")}
  -q, --quiet               ${dim("Minimal output, only errors")}
  --no-color                ${dim("Disable colored output")}
  -y, --yes                 ${dim("Answer yes to all prompts")}
  -i, --interactive         ${dim("Enable interactive prompts (default: true)")}

${bold("HELP:")}
  -h, --help                ${dim("Show this help message")}

${bold("EXAMPLES:")}
  ${green("# Basic migration")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-s3-login.ts
`);
}

// Show help if requested or missing required arguments
if (args.help) {
  showHelp();
  Deno.exit(0);
}

// =============================================================================
// Core Functionality
// =============================================================================

/**
 * Check if Pulumi CLI is installed
 */
async function checkPulumiInstalled(): Promise<boolean> {
  try {
    const { output, success } = await executeCommand(
      ["pulumi", "version"], 
      { silent: true }
    );
    
    if (success && args.verbose) {
      logger.debug(`Pulumi version: ${output}`);
    }
    
    return success;
  } catch (error) {
    return false;
  }
}

/**
 * Check if AWS CLI is correctly configured
 */
async function checkAwsConfiguration(): Promise<boolean> {
  try {
    const { success, output } = await executeCommand(
      ["aws", "sts", "get-caller-identity"], 
      { silent: true }
    );
    
    if (success && args.verbose) {
      logger.debug(`AWS identity: ${output}`);
    }
    
    return success;
  } catch (error) {
    return false;
  }
}
/**
 * Check if Pulumi project exists in the current directory
 */
async function checkPulumiProjectExists(): Promise<boolean> {
  try {
    await Deno.stat("Pulumi.yaml");
    return true;
  } catch {
    return false;
  }
}


/**
 * Login to S3 backend
 */
async function loginToS3Backend(backendUrl: string): Promise<boolean> {
  logger.startSpinner("s3-login", `Logging into S3 backend...`);
  
  // Ensure any existing session is logged out
  await executeCommand(["pulumi", "logout"], { silent: true });
  
  logger.updateSpinner("s3-login", `Logging into backend: ${backendUrl}...`);
  
  const { success, output } = await executeCommand(
    ["pulumi", "login", backendUrl],
    { silent: true }
  );

  if (!success) {
    logger.errorSpinner(
      "s3-login", 
      `Failed to login to S3 backend: ${output}`
    );
    return false;
  }

  logger.successSpinner(
    "s3-login", 
    `Successfully logged into S3 backend`
  );
  return true;
}


/**
 * Main migration function
 */
async function migrateStack() {
  showBanner();
  
  // =========================================================================
  // Step 1: Initial checks and setup
  // =========================================================================
  logger.section("PREREQUISITES");
  
  // Check Pulumi CLI
  logger.startSpinner("check-pulumi", "Checking Pulumi CLI installation...");
  const pulumiInstalled = await checkPulumiInstalled();
  
  if (!pulumiInstalled) {
    logger.errorSpinner("check-pulumi", "Pulumi CLI is not installed or not in PATH");
    logger.info(`Please install Pulumi CLI: https://www.pulumi.com/docs/install/`);
    Deno.exit(1);
  } else {
    logger.successSpinner("check-pulumi", "Pulumi CLI is installed and working");
  }
  
  // Check AWS credentials
  logger.startSpinner("check-aws", "Checking AWS credentials...");
  const awsConfigured = await checkAwsConfiguration();
  if (!awsConfigured) {
    logger.warningSpinner("check-aws", "AWS credentials are not properly configured");
    logger.info(`This might cause issues when accessing AWS resources. Make sure AWS credentials are set up correctly.`);
    
    const proceed = await logger.confirm("Do you want to continue anyway?", false);
    if (!proceed) {
      logger.error("Login aborted.");
      Deno.exit(1);
    }
  } else {
    logger.successSpinner("check-aws", "AWS credentials are properly configured");
  }


  logger.section("SELECTING BACKEND");
  let projectName = ""
  // Check existing project
  const projectExists = await checkPulumiProjectExists();
  // Interactive configuration if project doesn't exist
  if (!projectExists) {
    projectName = defaultProjectName;
  } else {
    logger.info(`Existing Pulumi project found in current directory`);

    // Try to get project name from existing Pulumi.yaml
    try {
      const pulumiYaml = await Deno.readTextFile("Pulumi.yaml");
      const nameMatch = pulumiYaml.match(/name:\s*(.*)/);
      if (nameMatch && nameMatch[1]) {
        projectName = nameMatch[1].trim();
        logger.info(`Using existing project name: ${bold(projectName)}`);
      }
    } catch (error) {
      logger.debug(`Error reading Pulumi.yaml: ${error.message}`);
    }

    if (!projectName) {
      projectName = defaultProjectName;
    }
  }
  // Bucket name (default: derived from project name)
  let backend = "";
  const suggestedBucketName = `${statePrefix}${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

  if (args.interactive) {
    let bucketName = await logger.prompt("S3 bucket name for state storage", suggestedBucketName);
    const regions = [
      "us-east-1", "us-east-2", "us-west-1", "us-west-2",
      "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1",
      "ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2"
    ];
    let region = await logger.select(
        "Select AWS region",
        regions,
        regions.indexOf(defaultRegion) !== -1 ? regions.indexOf(defaultRegion) : 0
    );
    backend = `s3://${bucketName}\?region=${region}`
  } else {
    let bucketName = suggestedBucketName;
    backend = `s3://${bucketName}`
    logger.info(`Using generated bucket name: ${bold(bucketName)}`);
  }



  // =========================================================================
  // Step 2: Login to S3 backend
  // =========================================================================
  logger.section("LOGIN BACKEND");
  
  // Login to S3 backend
  const s3LoginSuccess = await loginToS3Backend(backend);
  if (!s3LoginSuccess) {
    logger.error(`Failed to login to S3 backend. Migration aborted.`);
    logger.info(`Check your AWS credentials and the S3 backend URL.`);
    Deno.exit(1);
  }
  
  // Final instructions
  console.log(`${bgGreen(black(" NEXT STEPS "))}
   ${SYMBOLS.bullet} ${bold("Confirm your stack")} is working correctly:
     ${green(`pulumi stack ls`)}
  `);
}

// Run the migration
await migrateStack();