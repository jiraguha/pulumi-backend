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
    "stack", "backend", "region", "workspace", "dynamodb-table", 
    "passphrase", "kms-key", "secrets-provider", "output-format",
    "organization", "access-token"
  ],
  boolean: [
    "help", "delete-source", "skip-verify", "verbose", "quiet", 
    "yes", "no-color", "interactive"
  ],
  alias: {
    h: "help",
    s: "stack",
    b: "backend",
    r: "region",
    w: "workspace",
    d: "delete-source",
    v: "verbose",
    p: "passphrase",
    k: "kms-key",
    y: "yes",
    q: "quiet",
    i: "interactive",
    o: "output-format",
    t: "access-token",
    g: "organization"
  },
  default: {
    region: Deno.env.get("AWS_REGION") || "us-west-2",
    workspace: ".",
    "delete-source": false,
    "skip-verify": false,
    "interactive": true,
    "output-format": "pretty",
    "no-color": false,
    "secrets-provider": "service",
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
${bgBlue(black(" PULUMI "))}${bgCyan(black(" CLOUD "))}${bgGreen(black(" MIGRATION "))} ${cyan("v1.0.0")}

${dim("Migrate Pulumi stacks from S3 backend to Pulumi Cloud.")}
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
   * Display a table of information
   */
  table(headers: string[], rows: string[][]): void {
    if (this.logLevel <= LogLevel.INFO) {
      // Calculate column widths
      const colWidths = headers.map((h, i) => {
        const values = [h.length, ...rows.map(r => r[i]?.length || 0)];
        return Math.max(...values);
      });
      
      // Print header
      const header = headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ");
      console.log(this.formatMessage(bold(header), " "));
      
      // Print separator
      const separator = colWidths.map(w => "─".repeat(w)).join("─┼─");
      console.log(this.formatMessage(`${separator}`, " "));
      
      // Print rows
      for (const row of rows) {
        const formattedRow = row.map((cell, i) => 
          (cell || "").padEnd(colWidths[i])
        ).join(" | ");
        console.log(this.formatMessage(formattedRow, " "));
      }
      console.log();
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
 * Parse S3 backend URL into components
 */
function parseS3BackendUrl(backendUrl: string): {
  bucket: string;
  region: string;
  dynamoDBTable?: string;
} {
  try {
    // Handle s3:// URL format
    if (!backendUrl.startsWith('s3://')) {
      throw new Error('Backend URL must start with s3://');
    }
    
    // Extract bucket and query params
    const urlWithoutProtocol = backendUrl.substring(5);
    const [bucket, queryString] = urlWithoutProtocol.split('?');
    
    if (!bucket) {
      throw new Error('No bucket specified in S3 backend URL');
    }
    
    // Parse query params
    const params = new URLSearchParams(queryString || '');
    const region = params.get('region') || args.region;
    const dynamoDBTable = params.get('dynamodb_table') || undefined;
    
    return { bucket, region, dynamoDBTable };
  } catch (error) {
    logger.error(`Invalid S3 backend URL format: ${error.message}`);
    Deno.exit(1);
  }
}

/**
 * Display help information
 */
function showHelp() {
  showBanner();
  
  console.log(`
${bold("USAGE:")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-cloud-migrate.ts [OPTIONS]

${bold("REQUIRED OPTIONS:")}
  -s, --stack=<n>         ${dim("Stack name to migrate")}
  -b, --backend=<url>     ${dim("S3 backend URL (e.g., s3://my-bucket?region=us-west-2)")}

${bold("PULUMI CLOUD OPTIONS:")}
  -g, --organization=<org>  ${dim("Pulumi Cloud organization (optional)")}
  -t, --access-token=<token>${dim("Pulumi access token (will use stored credentials if not specified)")}

${bold("SECRETS OPTIONS:")}
  --secrets-provider=<type> ${dim("Target secrets provider: 'service' (default), 'passphrase', 'awskms'")}
  -p, --passphrase=<pass>   ${dim("Source passphrase for decrypting secrets")}
  -k, --kms-key=<keyid>     ${dim("Source KMS key for decrypting secrets")}

${bold("MIGRATION OPTIONS:")}
  -w, --workspace=<path>    ${dim("Path to Pulumi project (default: current directory)")}
  -d, --delete-source       ${dim("Delete the source stack after successful migration")}
  --skip-verify             ${dim("Skip verification step")}

${bold("OUTPUT OPTIONS:")}
  -v, --verbose             ${dim("Enable verbose output")}
  -q, --quiet               ${dim("Minimal output, only errors")}
  --no-color                ${dim("Disable colored output")}
  -y, --yes                 ${dim("Answer yes to all prompts")}
  -i, --interactive         ${dim("Enable interactive prompts (default: true)")}
  -o, --output-format       ${dim("Output format: 'pretty', 'json', 'minimal' (default: pretty)")}

${bold("HELP:")}
  -h, --help                ${dim("Show this help message")}

${bold("EXAMPLES:")}
  ${green("# Basic migration")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-cloud-migrate.ts \\
    --stack=dev \\
    --organization=acme-corp

  ${green("# With backend specified")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-cloud-migrate.ts \\
    --stack=dev \\
    --organization=acme-corp \\
    --backend=s3://my-pulumi-state?region=us-west-2

  ${green("# With passphrase for decrypting source secrets")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-cloud-migrate.ts \\
    --stack=dev \\
    --organization=acme-corp
    --passphrase=my-secret-passphrase
`);
}

// Show help if requested or missing required arguments
if (args.help || !args.stack || !args.organization) {
  showHelp();
  if (args.help) {
    Deno.exit(0);
  } else {
    console.error(red("Error: Missing required arguments (--stack and --organization)"));
    Deno.exit(1);
  }
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
 * Login to Pulumi Cloud
 */
async function loginToPulumiCloud(accessToken?: string): Promise<boolean> {
  logger.startSpinner("cloud-login", `Logging into Pulumi Cloud...`);
  
  // Ensure any existing session is logged out
  await executeCommand(["pulumi", "logout"], { silent: true });
  
  // If access token is provided, use it to login
  let loginCommand = ["pulumi", "login"];
  let env = {};
  
  if (accessToken) {
    env = { PULUMI_ACCESS_TOKEN: accessToken };
    logger.debug(`Using provided access token for Pulumi Cloud login`);
  }
  
  const { success, output } = await executeCommand(
    loginCommand,
    { silent: true, env }
  );

  if (!success) {
    logger.errorSpinner(
      "cloud-login", 
      `Failed to login to Pulumi Cloud: ${output}`
    );
    return false;
  }

  // Verify we're logged in by getting the current user
  const { success: whoamiSuccess, output: whoamiOutput } = await executeCommand(
    ["pulumi", "whoami"],
    { silent: true }
  );
  
  if (!whoamiSuccess) {
    logger.errorSpinner(
      "cloud-login", 
      `Failed to verify Pulumi Cloud login: ${whoamiOutput}`
    );
    return false;
  }

  logger.successSpinner(
    "cloud-login", 
    `Successfully logged into Pulumi Cloud as ${whoamiOutput}`
  );
  return true;
}

/**
 * Export the stack state from S3 backend
 */
async function exportStackState(stack: string, workspacePath: string): Promise<string | null> {
  const tempDir = join(Deno.cwd(), ".pulumi-cloud-migrate-temp");
  await ensureDir(tempDir);

  const stackName = stack.replaceAll("/", "-");
  const statePath = join(tempDir, `${stackName}-state.json`);
  
  // Prepare environment variables for secrets
  const env: Record<string, string> = {};
  if (args.passphrase) {
    env.PULUMI_CONFIG_PASSPHRASE = args.passphrase;
  }
  
  logger.startSpinner(
    "export-state", 
    `Exporting stack state for "${stack}" from S3 backend...`
  );
  
  const { success, output } = await executeCommand(
    ["pulumi", "stack", "export", "--show-secrets", "--stack", stack, "--file", statePath],
    { cwd: workspacePath, silent: true, env }
  );

  if (!success) {
    logger.errorSpinner(
      "export-state", 
      `Failed to export stack state: ${output}`
    );
    return null;
  }

  // Try to get state size for reporting
  try {
    const fileInfo = await Deno.stat(statePath);
    const fileSizeKB = Math.round(fileInfo.size / 1024);
    logger.successSpinner(
      "export-state", 
      `Successfully exported stack state (${fileSizeKB} KB) to ${statePath}`
    );
  } catch {
    logger.successSpinner(
      "export-state", 
      `Successfully exported stack state to ${statePath}`
    );
  }

  return statePath;
}

/**
 * Create a new stack in Pulumi Cloud
 */
async function createStackInPulumiCloud(
  stack: string, 
  workspacePath: string, 
  organization?: string
): Promise<boolean> {
  // Handle org/stack name format
  const orgFromStack = stack.includes('/') ? stack.split('/')[0] : null;
  const stackName = stack.includes('/') ? stack.split('/')[1] : stack;

  // Determine which organization to use
  const targetOrg = organization || orgFromStack;
  const displayName = targetOrg ? `${targetOrg}/${stackName}` : stackName;
  
  logger.startSpinner(
    "create-stack", 
    `Creating stack "${displayName}" in Pulumi Cloud...`
  );
  
  // Prepare command
  const initCommand = ["pulumi", "stack", "init"];
  
  // Handle organization if provided
  if (targetOrg) {
    initCommand.push(targetOrg+"/"+stackName);
  } else {
    initCommand.push(stack);
  }
  
  initCommand.push("--non-interactive");
  
  const { success, output } = await executeCommand(
    initCommand,
    { cwd: workspacePath, silent: true }
  );

  if (!success) {
    logger.errorSpinner(
      "create-stack", 
      `Failed to create stack in Pulumi Cloud: ${output}`
    );
    return false;
  }

  logger.successSpinner(
    "create-stack", 
    `Successfully created stack "${displayName}" in Pulumi Cloud`
  );
  return true;
}

/**
 * Import the stack state to Pulumi Cloud
 */
async function importStackState(
  stack: string, 
  statePath: string, 
  workspacePath: string,
  organization?: string
): Promise<boolean> {
  // Determine the proper stack name
  const orgFromStack = stack.includes('/') ? stack.split('/')[0] : null;
  const stackName = stack.includes('/') ? stack.split('/')[1] : stack;
  const targetOrg = organization || orgFromStack;
  const targetStack = targetOrg ? `${targetOrg}/${stackName}` : stackName;
  
  logger.startSpinner(
    "import-state", 
    `Importing stack state to "${targetStack}" in Pulumi Cloud...`
  );
  
  const { success, output } = await executeCommand(
    ["pulumi", "stack", "import", "--stack", targetStack, "--file", statePath],
    { cwd: workspacePath, silent: true }
  );

  if (!success) {
    logger.errorSpinner(
      "import-state", 
      `Failed to import stack state: ${output}`
    );
    return false;
  }

  logger.successSpinner(
    "import-state", 
    `Successfully imported stack state to "${targetStack}"`
  );
  return true;
}

/**
 * Change the secrets provider for a stack
 */
async function changeSecretsProvider(
  stack: string,
  workspacePath: string,
  organization?: string
): Promise<boolean> {
  
  // Determine the proper stack name
  const orgFromStack = stack.includes('/') ? stack.split('/')[0] : null;
  const stackName = stack.includes('/') ? stack.split('/')[1] : stack;
  const targetOrg = organization || orgFromStack;
  const targetStack = targetOrg ? `${targetOrg}/${stackName}` : stackName;
  
  logger.startSpinner(
    "change-secrets", 
    `Changing secrets provider to default for stack "${targetStack}"...`
  );
  
  const { success, output } = await executeCommand(
    ["pulumi", "stack", "change-secrets-provider", "default", "--stack", targetStack],
    { cwd: workspacePath, silent: true }
  );
  
  if (!success) {
    logger.errorSpinner(
      "change-secrets", 
      `Failed to change secrets provider: ${output}`
    );
    return false;
  }
  
  logger.successSpinner(
    "change-secrets", 
    `Successfully changed secrets provider to default for stack "${targetStack}"`
  );
  return true;
}

/**
 * Verify the migration by running pulumi up with no changes expected
 */
async function verifyMigration(
  stack: string, 
  workspacePath: string,
  organization?: string
): Promise<boolean> {
  // Determine the proper stack name
  const orgFromStack = stack.includes('/') ? stack.split('/')[0] : null;
  const stackName = stack.includes('/') ? stack.split('/')[1] : stack;
  const targetOrg = organization || orgFromStack;
  const targetStack = targetOrg ? `${targetOrg}/${stackName}` : stackName;
  
  logger.startSpinner(
    "verify", 
    `Verifying stack migration (expecting no changes)...`
  );
  
  const { success, output } = await executeCommand(
    ["pulumi", "preview", "--stack", targetStack, "--diff"],
    { cwd: workspacePath, silent: true }
  );

  // More robust change detection
  const hasChanges = (
    // Check for direct change indicators
    output.includes("+ ") && output.match(/\+\s+\d+\s+to create/) ||
    output.includes("~ ") && output.match(/~\s+\d+\s+to update/) ||
    output.includes("- ") && output.match(/-\s+\d+\s+to delete/)
  );

  if (!success || hasChanges) {
    logger.errorSpinner(
      "verify", 
      `Verification failed: changes detected in the stack`
    );
    
    // Print the changes if in verbose mode
    if (args.verbose) {
      logger.info(`Preview output:`);
      logger.indent();
      output.trim().split("\n").forEach(line => {
        logger.info(line);
      });
      logger.outdent();
    } else {
      logger.info(`Run with --verbose to see details of the detected changes`);
    }
    
    return false;
  }

  logger.successSpinner(
    "verify", 
    `Verification successful: no changes detected in the stack`
  );
  return true;
}

/**
 * Delete the source stack from S3 backend
 */
async function deleteSourceStack(
  stack: string, 
  backendUrl: string,
  workspacePath: string
): Promise<boolean> {
  logger.startSpinner(
    "delete-source", 
    `Preparing to delete source stack "${stack}" from S3 backend...`
  );
  
  // First, log back into the S3 backend
  await executeCommand(["pulumi", "logout"], { silent: true });
  const loginResult = await executeCommand(
    ["pulumi", "login", backendUrl], 
    { silent: true }
  );
  
  if (!loginResult.success) {
    logger.errorSpinner(
      "delete-source", 
      `Failed to log back into S3 backend: ${loginResult.output}`
    );
    return false;
  }
  
  logger.updateSpinner(
    "delete-source", 
    `Removing source stack "${stack}" from S3 backend...`
  );
  
  // Force deletion with --yes
  const { success, output } = await executeCommand(
    ["pulumi", "stack", "rm", "--stack", stack,"--force", "--yes"],
    { cwd: workspacePath, silent: true }
  );

  if (!success) {
    logger.errorSpinner(
      "delete-source", 
      `Failed to delete source stack: ${output}`
    );
    return false;
  }

  logger.successSpinner(
    "delete-source", 
    `Successfully deleted source stack "${stack}" from S3 backend`
  );

  await executeCommand(["pulumi", "logout"], { silent: true });
  await executeCommand(["pulumi", "login"], { silent: true });

  return true;
}

/**
 * Clean up temporary files
 */
async function cleanUpTempFiles(): Promise<void> {
  const tempDir = join(Deno.cwd(), ".pulumi-cloud-migrate-temp");
  try {
    await Deno.remove(tempDir, { recursive: true });
    logger.debug(`Cleaned up temporary directory: ${tempDir}`);
  } catch (error) {
    logger.debug(`Failed to clean up temporary directory: ${error.message}`);
  }
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
      logger.error("Migration aborted.");
      Deno.exit(1);
    }
  } else {
    logger.successSpinner("check-aws", "AWS credentials are properly configured");
  }

  // Extract arguments
  const { 
    stack, 
    backend : providedBackend,
    workspace, 
    "delete-source": deleteSource, 
    "skip-verify": skipVerify,
    passphrase,
    organization,
    "access-token": accessToken
  } = args;
  let backend = providedBackend;
  // Parse the S3 backend URL

  // Display migration plan
  logger.section("MIGRATION PLAN");
  if (backend) {
    parseS3BackendUrl(backend);
    logger.info(`Source backend: ${bold(backend)}`);
  }
  logger.info(`Source stack: ${bold(stack)}`);
  logger.info(`Target backend: ${bold("Pulumi Cloud")}`);
  logger.info(`Target organization: ${bold(organization || "Default")}`);
  logger.info(`Workspace path: ${bold(workspace)}`);

  // =========================================================================
  // Step 3: Select Backend
  // =========================================================================
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
  if (!backend) {
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
  }



  // =========================================================================
  // Step 2: Login to S3 backend
  // =========================================================================
  logger.section("SOURCE BACKEND");
  
  // Login to S3 backend
  const s3LoginSuccess = await loginToS3Backend(backend);
  if (!s3LoginSuccess) {
    logger.error(`Failed to login to S3 backend. Migration aborted.`);
    logger.info(`Check your AWS credentials and the S3 backend URL.`);
    Deno.exit(1);
  }
  
  // Export stack state
  const statePath = await exportStackState(stack, workspace);
  if (!statePath) {
    logger.error(`Failed to export stack state. Migration aborted.`);
    logger.info(`Make sure the stack "${stack}" exists and you have access to it.`);
    
    // If passphrase was not provided, suggest it might be needed
    if (!passphrase && !args["kms-key"]) {
      logger.info(`If the stack uses encrypted secrets, try providing --passphrase or --kms-key.`);
    }
    
    Deno.exit(1);
  }
  
  // =========================================================================
  // Step 3: Switch to Pulumi Cloud
  // =========================================================================
  logger.section("TARGET BACKEND");
  
  // Login to Pulumi Cloud
  const cloudLoginSuccess = await loginToPulumiCloud(accessToken);
  if (!cloudLoginSuccess) {
    logger.error(`Failed to login to Pulumi Cloud. Migration aborted.`);
    
    if (accessToken) {
      logger.info(`Check that your access token is valid.`);
    } else {
      logger.info(`You might need to login first with 'pulumi login' or provide an access token.`);
    }
    
    Deno.exit(1);
  }
  
  // Create stack in Pulumi Cloud
  const stackCreateSuccess = await createStackInPulumiCloud(
    stack, 
    workspace, 
    organization
  );
  
  if (!stackCreateSuccess) {
    logger.error(`Failed to create stack in Pulumi Cloud. Migration aborted.`);
    Deno.exit(1);
  }
  
  // Import stack state
  const importSuccess = await importStackState(stack, statePath, workspace, organization);
  if (!importSuccess) {
    logger.error(`Failed to import stack state. Migration aborted.`);
    Deno.exit(1);
  }
  
   // Change secrets provider if set to default
  const changeSecretsSuccess = await changeSecretsProvider(stack, workspace, organization);
  if (!changeSecretsSuccess) {
    logger.error(`Failed to change secrets provider to default. Migration may be incomplete.`);
    
    const proceed = await logger.confirm("Do you want to continue with the migration anyway?", false);
    if (!proceed) {
      logger.error("Migration aborted by user");
      await cleanUpTempFiles();
      Deno.exit(1);
    }
  }

  // =========================================================================
  // Step 4: Verify migration
  // =========================================================================
  if (!skipVerify) {
    logger.section("VERIFICATION");
    
    const verificationSuccess = await verifyMigration(stack, workspace, organization);
    if (!verificationSuccess) {
      logger.warning("⚠️ Migration verification failed. The stack state may not be identical.");
      logger.warning("You can still proceed but may need to manually resolve any discrepancies.");
      
      // Ask for confirmation to continue
      const proceed = await logger.confirm("Do you want to continue with the migration?", false);
      if (!proceed) {
        logger.error("Migration aborted by user");
        await cleanUpTempFiles();
        Deno.exit(1);
      }
    } else {
      logger.success("✅ Migration verification successful");
    }
  } else {
    logger.warning("Skipping verification step as requested with --skip-verify flag");
  }
  
  // =========================================================================
  // Step 5: Delete source stack if requested
  // =========================================================================
  if (deleteSource) {
    logger.section("CLEANUP");
    
    const shouldDelete = args.yes || await logger.confirm(
      `Are you sure you want to delete the source stack "${stack}" from the S3 backend?`,
      false
    );
    
    if (shouldDelete) {
      const deleteSuccess = await deleteSourceStack(stack, backend, workspace);
      if (!deleteSuccess) {
        logger.warning("Failed to delete source stack, but migration was successful");
      }
    } else {
      logger.info("Source stack deletion cancelled by user");
    }
  }
  
  // Clean up
  logger.startSpinner("cleanup", "Cleaning up temporary files...");
  await cleanUpTempFiles();
  logger.successSpinner("cleanup", "Temporary files cleaned up");
  
  // =========================================================================
  // Step 6: Success and next steps
  // =========================================================================
  logger.section("MIGRATION COMPLETE");
  
  // Determine the proper final stack name
  const orgFromStack = stack.includes('/') ? stack.split('/')[0] : null;
  const stackName = stack.includes('/') ? stack.split('/')[1] : stack;
  const targetOrg = organization || orgFromStack;
  const targetStack = targetOrg ? `${targetOrg}/${stackName}` : stackName;
  
  logger.success(`Stack "${stack}" successfully migrated to Pulumi Cloud as "${targetStack}"`);
  console.log();
  
  // Final instructions
  console.log(`${bgGreen(black(" NEXT STEPS "))}

   ${SYMBOLS.bullet} ${bold("Confirm your stack")} is working correctly:
     ${green(`pulumi stack select ${targetStack}`)}

   ${SYMBOLS.bullet} ${bold("Verify your infrastructure")} with:
     ${green(`pulumi preview`)}

   ${SYMBOLS.bullet} ${bold("Update any CI/CD pipelines")} to use Pulumi Cloud:
     ${green(`pulumi login`)}${targetOrg ? `\n     ${green(`pulumi stack select ${targetOrg}/${stackName}`)}` : ''}
`);
}

// Run the migration
await migrateStack();