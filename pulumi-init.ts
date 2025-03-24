#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

/**
 * 🚀 Pulumi S3 Project Initializer
 * 
 * A professional-grade CLI tool to initialize Pulumi projects with an S3 backend.
 * Features interactive prompts, smart defaults, and comprehensive secrets management.
 * 
 * 📋 Usage:
 *   deno run --allow-run --allow-read --allow-write --allow-env pulumi-init-s3.ts \
 *     --name=my-project \
 *     --bucket=my-pulumi-state-bucket \
 *     --region=us-west-2
 */

import { parse } from "https://deno.land/std/flags/mod.ts";
import { join, basename } from "https://deno.land/std/path/mod.ts";
import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import {
  bgGreen, bgBlue, bgYellow, bgRed, bgCyan,
  black, bold, italic, underline, dim, red, yellow, green, blue, cyan, magenta, white, gray
} from "https://deno.land/std/fmt/colors.ts";

// CLI progress bar implementation
import  Spinner  from "https://deno.land/x/cli_spinners@v0.0.3/mod.ts";

// =============================================================================
// CLI Configuration
// =============================================================================

// Get current directory name to use as default project name and bucket name
const currentDir = basename(Deno.cwd());
const defaultProjectName = currentDir.toLowerCase().replace(/[^a-z0-9-]/g, '-');
const statePrefix = "";
// Define command line arguments
const args = parse(Deno.args, {
  string: [
    "name", "description", "bucket", "region", "runtime", 
    "template", "stack", "dynamodb-table", "kms-alias", 
    "secrets-provider", "passphrase", "output-format"
  ],
  boolean: [
    "help", "verbose", "create-bucket", "create-dynamodb", 
    "create-kms", "quiet", "yes", "no-color", "interactive"
  ],
  alias: {
    h: "help",
    n: "name",
    b: "bucket",
    r: "region",
    d: "description",
    t: "template",
    s: "stack",
    p: "passphrase",
    a: "kms-alias",
    y: "yes",
    q: "quiet",
    i: "interactive",
    o: "output-format",
    v: "verbose"
  },
  default: {
    region: Deno.env.get("AWS_REGION") || "eu-west-3",
    runtime: "typescript",
    stack: "dev",
    "create-bucket": true,
    "create-dynamodb": false,
    "create-kms": true,
    "secrets-provider": "awskms",
    "kms-alias": "alias/pulumi-secrets",
    "interactive": true,
    "output-format": "pretty",
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
${bgBlue(black(" PULUMI "))}${bgCyan(black(" S3 "))}${bgGreen(black(" INITIALIZER "))} ${cyan("v1.0.0")}

${dim("A professional-grade tool to set up Pulumi projects with an S3 backend.")}
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
  } = {}
): Promise<{ output: string; success: boolean }> {
  const { 
    cwd = ".", 
    silent = false,
    showOutput = false,
    spinnerMessage,
    successMessage,
    errorMessage
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

    const process = Deno.run({
      cmd: command,
      cwd,
      stdout: "piped",
      stderr: "piped",
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
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-init-s3.ts [OPTIONS]

${bold("PROJECT OPTIONS:")}
  -n, --name=<name>        ${dim("Project name (default: current directory name)")}
  -d, --description=<desc> ${dim("Project description")}
  -t, --template=<temp>    ${dim("Pulumi template (default: typescript)")}
  -s, --stack=<name>       ${dim("Initial stack name (default: dev)")}

${bold("BACKEND OPTIONS:")}
  -b, --bucket=<name>      ${dim("S3 bucket name (default: derived from project name)")}
  -r, --region=<region>    ${dim("AWS region for resources (default: from AWS_REGION or us-west-2)")}
  --dynamodb-table=<name>  ${dim("DynamoDB table name for state locking")}
  --create-bucket          ${dim("Create S3 bucket if it doesn't exist (default: true)")}
  --create-dynamodb        ${dim("Create DynamoDB table if it doesn't exist (default: false)")}

${bold("SECRETS OPTIONS:")}
  --secrets-provider=<type> ${dim("Secrets provider type: 'awskms', 'passphrase', 'default' (default: awskms)")}
  -a, --kms-alias=<alias>   ${dim("KMS key alias for secrets (default: alias/pulumi-secrets)")}
  -p, --passphrase=<pass>   ${dim("Passphrase for secrets encryption when using passphrase provider")}
  --create-kms              ${dim("Create KMS key if it doesn't exist (default: true)")}

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
  ${green("# Basic initialization with interactive prompts")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-init-s3.ts

  ${green("# Specify project name and bucket")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-init-s3.ts \\
    --name=my-infra \\
    --bucket=my-pulumi-state \\
    --region=us-east-1

  ${green("# With DynamoDB state locking")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-init-s3.ts \\
    --name=my-infra \\
    --bucket=my-pulumi-state \\
    --dynamodb-table=pulumi-state-lock \\
    --create-dynamodb
`);
}

// Show help if requested
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
 * Get the current AWS user identity
 */
async function getCurrentAwsIdentity(): Promise<string | null> {
  try {
    const { success, output } = await executeCommand(
      ["aws", "sts", "get-caller-identity", "--query", "Arn", "--output", "text"],
      { silent: true }
    );
    
    if (success && output) {
      return output.trim();
    }
    return null;
  } catch (error) {
    logger.debug(`Failed to get AWS identity: ${error.message}`);
    return null;
  }
}

/**
 * Check if S3 bucket exists
 */
async function checkS3BucketExists(bucket: string, region: string): Promise<boolean> {
  try {
    const { success } = await executeCommand(
      ["aws", "s3api", "head-bucket", "--bucket", bucket, "--region", region],
      { silent: true }
    );
    return success;
  } catch (error) {
    return false;
  }
}

/**
 * Create S3 bucket with proper configuration for Pulumi state management
 */
async function createS3Bucket(bucket: string, region: string): Promise<boolean> {
  logger.startSpinner("create-bucket", `Creating S3 bucket "${bucket}" in ${region} for Pulumi state...`);
  
  try {
    // 1. Create S3 bucket
    let createBucketCmd = ["aws", "s3api", "create-bucket", "--bucket", bucket, "--region", region];
    
    // Handle special case for us-east-1 (doesn't use LocationConstraint)
    if (region !== "us-east-1") {
      createBucketCmd.push("--create-bucket-configuration", `LocationConstraint=${region}`);
    }
    
    const { success: bucketCreated } = await executeCommand(
      createBucketCmd,
      { 
        silent: true,
        errorMessage: `Failed to create S3 bucket "${bucket}"`
      }
    );
    
    if (!bucketCreated) {
      logger.errorSpinner("create-bucket", `Failed to create S3 bucket "${bucket}"`);
      return false;
    }
    
    logger.updateSpinner("create-bucket", `Configuring S3 bucket "${bucket}" for optimal settings...`);

    // 2. Enable versioning on the bucket
    const { success: versioningEnabled } = await executeCommand([
      "aws", "s3api", "put-bucket-versioning",
      "--bucket", bucket,
      "--versioning-configuration", "Status=Enabled",
      "--region", region
    ], { silent: true });
    
    if (!versioningEnabled) {
      logger.warningSpinner("create-bucket", `Created bucket but failed to enable versioning for "${bucket}"`);
      return true;
    }

    // 3. Enable default encryption on the bucket
    const { success: encryptionEnabled } = await executeCommand([
      "aws", "s3api", "put-bucket-encryption",
      "--bucket", bucket,
      "--server-side-encryption-configuration", '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}',
      "--region", region
    ], { silent: true });
    
    if (!encryptionEnabled) {
      logger.warningSpinner("create-bucket", `Created bucket but failed to enable encryption for "${bucket}"`);
      return true;
    }

    // 4. Add lifecycle policy to manage old versions
    const { success: lifecycleAdded } = await executeCommand([
      "aws", "s3api", "put-bucket-lifecycle-configuration",
      "--bucket", bucket,
      "--lifecycle-configuration", '{"Rules":[{"ID":"ExpireOldVersions","Status":"Enabled","NoncurrentVersionExpiration":{"NoncurrentDays":90}}]}',
      "--region", region
    ], { silent: true });
    
    if (!lifecycleAdded) {
      logger.warningSpinner("create-bucket", `Created bucket but failed to add lifecycle policy for "${bucket}"`);
      return true;
    }

    logger.successSpinner(
      "create-bucket", 
      `S3 bucket "${bucket}" created and configured for Pulumi state`
    );
    return true;
  } catch (error) {
    logger.errorSpinner("create-bucket", `Failed to create S3 bucket: ${error.message}`);
    return false;
  }
}

/**
 * Check and fix S3 bucket permissions for Pulumi state
 */
async function checkAndFixS3Permissions(bucket: string, region: string): Promise<boolean> {
  logger.startSpinner("fix-perms", `Checking S3 bucket permissions for "${bucket}"...`);
  
  // Get the current AWS identity
  const currentIdentity = await getCurrentAwsIdentity();
  if (!currentIdentity) {
    logger.errorSpinner(
      "fix-perms", 
      `Unable to determine your AWS identity. Please ensure you have the necessary permissions.`
    );
    return false;
  }
  
  logger.debug(`Current AWS identity: ${currentIdentity}`);
  
  // Create the new permission statement
  const newPolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowPulumiStateAccess",
        Effect: "Allow",
        Principal: {
          AWS: currentIdentity
        },
        Action: [
          "s3:GetObject",
          "s3:PutObject", 
          "s3:DeleteObject",
          "s3:ListBucket"
        ],
        Resource: [
          `arn:aws:s3:::${bucket}`,
          `arn:aws:s3:::${bucket}/*`
        ]
      }
    ]
  };
  
  logger.updateSpinner(
    "fix-perms", 
    `Setting bucket policy to ensure access for your AWS user...`
  );
  
  const policyString = JSON.stringify(newPolicy);
  const { success: putPolicySuccess } = await executeCommand(
    ["aws", "s3api", "put-bucket-policy", "--bucket", bucket, "--policy", policyString, "--region", region],
    { silent: true }
  );
  
  if (!putPolicySuccess) {
    logger.warningSpinner(
      "fix-perms", 
      `Failed to update bucket policy. You may need to update it manually.`
    );
    logger.info(`Ensure your AWS user has permissions: s3:GetObject, s3:PutObject, s3:DeleteObject, s3:ListBucket`);
    return false;
  }
  
  logger.successSpinner(
    "fix-perms", 
    `Set bucket policy to ensure your AWS user can access Pulumi state`
  );
  
  return true;
}

/**
 * Create DynamoDB table for state locking
 */
async function createDynamoDBTable(tableName: string, region: string): Promise<boolean> {
  logger.startSpinner(
    "create-dynamo", 
    `Creating DynamoDB table "${tableName}" for Pulumi state locking...`
  );
  
  try {
    // 1. Create DynamoDB table
    const { success: tableCreated } = await executeCommand([
      "aws", "dynamodb", "create-table",
      "--table-name", tableName,
      "--attribute-definitions", "AttributeName=LockID,AttributeType=S",
      "--key-schema", "AttributeName=LockID,KeyType=HASH",
      "--provisioned-throughput", "ReadCapacityUnits=5,WriteCapacityUnits=5",
      "--region", region
    ], { silent: true });
    
    if (!tableCreated) {
      logger.errorSpinner(
        "create-dynamo", 
        `Failed to create DynamoDB table "${tableName}"`
      );
      return false;
    }
    
    logger.updateSpinner(
      "create-dynamo", 
      `Enabling point-in-time recovery for "${tableName}"...`
    );

    // 2. Enable point-in-time recovery
    const { success: recoveryEnabled } = await executeCommand([
      "aws", "dynamodb", "update-continuous-backups",
      "--table-name", tableName,
      "--point-in-time-recovery-specification", "PointInTimeRecoveryEnabled=true",
      "--region", region
    ], { silent: true });
    
    if (!recoveryEnabled) {
      logger.warningSpinner(
        "create-dynamo", 
        `Created table but failed to enable point-in-time recovery for "${tableName}"`
      );
      return true;
    }

    logger.successSpinner(
      "create-dynamo", 
      `DynamoDB table "${tableName}" created with point-in-time recovery enabled`
    );
    return true;
  } catch (error) {
    logger.errorSpinner("create-dynamo", `Failed to create DynamoDB table: ${error.message}`);
    return false;
  }
}

/**
 * Check if DynamoDB table exists
 */
async function checkDynamoDBTableExists(tableName: string, region: string): Promise<boolean> {
  try {
    const { success } = await executeCommand(
      ["aws", "dynamodb", "describe-table", "--table-name", tableName, "--region", region],
      { silent: true }
    );
    return success;
  } catch (error) {
    return false;
  }
}

/**
 * Check if KMS alias exists
 */
async function checkKmsAliasExists(alias: string, region: string): Promise<boolean> {
  try {
    // Remove "alias/" prefix if it exists for the API call
    const aliasName = alias.startsWith("alias/") ? alias : `alias/${alias}`;
    
    const { success } = await executeCommand(
      ["aws", "kms", "describe-key", "--key-id", aliasName, "--region", region],
      { silent: true }
    );
    return success;
  } catch (error) {
    return false;
  }
}

/**
 * Create KMS key and alias for Pulumi secrets
 */
async function createKmsKeyAndAlias(alias: string, region: string): Promise<string | null> {
  logger.startSpinner(
    "create-kms", 
    `Creating KMS key and alias "${alias}" for Pulumi secrets...`
  );
  
  try {
    // 1. Create KMS key
    const { success: keyCreated, output: keyOutput } = await executeCommand([
      "aws", "kms", "create-key",
      "--description", "'Pulumi State Encryption Key'",
      "--tags", "TagKey=Purpose,TagValue=PulumiStateEncryption",
      "--region", region
    ], { silent: true });
    
    if (!keyCreated) {
      logger.errorSpinner("create-kms", `Failed to create KMS key`);
      return null;
    }
    
    // Parse key ID from output
    const keyData = JSON.parse(keyOutput);
    const keyId = keyData.KeyMetadata.KeyId;
    
    logger.updateSpinner(
      "create-kms", 
      `Creating alias "${alias}" for KMS key ${keyId.substring(0, 8)}...`
    );
    
    // 2. Create alias for the key
    const aliasName = alias.startsWith("alias/") ? alias.substring(6) : alias;
    
    const { success: aliasCreated } = await executeCommand([
      "aws", "kms", "create-alias",
      "--alias-name", `alias/${aliasName}`,
      "--target-key-id", keyId,
      "--region", region
    ], { silent: true });
    
    if (!aliasCreated) {
      logger.warningSpinner(
        "create-kms", 
        `Created key but failed to create alias. Key ID: ${keyId}`
      );
      return keyId;
    }
    
    logger.successSpinner(
      "create-kms", 
      `KMS key and alias "${alias}" created successfully`
    );
    return alias;
  } catch (error) {
    logger.errorSpinner("create-kms", `Error creating KMS resources: ${error.message}`);
    return null;
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
 * Initialize a new Pulumi project
 */
async function initPulumiProject(name: string, description: string = "", template: string = "typescript"): Promise<boolean> {
  logger.startSpinner(
    "init-project", 
    `Initializing Pulumi project "${name}" with ${template} template...`
  );
  
  const cmd = ["pulumi", "new", template, "--force", "--yes"];
  
  if (name) {
    cmd.push("--name", name);
  }
  
  if (description) {
    cmd.push("--description", description);
  }
  
  const { success, output } = await executeCommand(cmd, { silent: true });
  
  if (!success) {
    logger.errorSpinner(
      "init-project", 
      `Failed to initialize Pulumi project: ${output}`
    );
    return false;
  }
  
  logger.successSpinner(
    "init-project", 
    `Pulumi project "${name}" initialized successfully`
  );
  return true;
}

/**
 * Switch to S3 backend
 */
async function loginToS3Backend(bucket: string, region: string, dynamoDBTable?: string): Promise<boolean> {
  logger.startSpinner("s3-login", `Configuring S3 backend...`);
  
  await executeCommand(["pulumi", "logout"], { silent: true });

  let loginUrl = `s3://${bucket}\?region=${region}`;
  
  // Add DynamoDB table if specified
  if (dynamoDBTable) {
    loginUrl += `&dynamodb_table=${dynamoDBTable}`;
  }

  logger.updateSpinner("s3-login", `Logging into backend: ${loginUrl}...`);
  
  const { success, output } = await executeCommand(
    ["pulumi", "login", loginUrl],
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
    `Successfully configured S3 backend: ${loginUrl}`
  );
  return true;
}

/**
 * Create a new stack in the S3 backend
 */
async function createStack(
  stackName: string, 
  secretsProvider: string, 
  secretsConfig: { 
    passphrase?: string; 
    kmsAlias?: string; 
    region: string;
  }
): Promise<boolean> {
  logger.startSpinner(
    "create-stack", 
    `Creating stack "${stackName}"...`
  );
  
  // Prepare command
  const initCommand = ["pulumi", "stack", "init", stackName];
  
  // Configure secrets provider
  if (secretsProvider === "passphrase") {
    // For passphrase secrets provider
    if (secretsConfig.passphrase) {
      // Set environment variable for the child process
      Deno.env.set("PULUMI_CONFIG_PASSPHRASE", secretsConfig.passphrase);
      logger.debug(`Using passphrase for secrets encryption`);
    } else {
      logger.warning(`No passphrase provided for passphrase secrets provider. Expect prompts.`);
    }
  } else if (secretsProvider === "awskms") {
    // For AWS KMS secrets provider
    const kmsAlias = secretsConfig.kmsAlias || "alias/pulumi-secrets";
    const region = secretsConfig.region;
    
    // Build the awskms:// URL
    const kmsKeyId = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
    const secretsProviderUrl = `awskms://${kmsKeyId}?region=${region}`;
    
    initCommand.push("--secrets-provider", secretsProviderUrl);
    logger.debug(`Using AWS KMS for secrets encryption: ${secretsProviderUrl}`);
  } else if (secretsProvider !== "default") {
    // For any other provider specified
    initCommand.push("--secrets-provider", secretsProvider);
    logger.debug(`Using custom secrets provider: ${secretsProvider}`);
  }
  
  const { success, output } = await executeCommand(
    initCommand,
    { silent: true }
  );

  if (!success) {
    logger.errorSpinner(
      "create-stack", 
      `Failed to create stack: ${output}`
    );
    return false;
  }

  logger.successSpinner(
    "create-stack", 
    `Successfully created stack "${stackName}"`
  );
  return true;
}

/**
 * Main function to initialize a Pulumi project with S3 backend
 */
async function initializePulumiS3Project() {
  showBanner();
  
  // =========================================================================
  // Step 1: Initial checks
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
      logger.error("Initialization aborted.");
      Deno.exit(1);
    }
  } else {
    logger.successSpinner("check-aws", "AWS credentials are properly configured");
  }
  
  // =========================================================================
  // Step 2: Interactive project configuration
  // =========================================================================
  logger.section("PROJECT CONFIGURATION");
  
  // Check existing project
  const projectExists = await checkPulumiProjectExists();
  
  let projectName = args.name || "";
  let projectDescription = args.description || "";
  let projectTemplate = args.runtime || "typescript";
  let stackName = args.stack || "dev";
  let bucketName = args.bucket || "";
  let region = args.region || "eu-west-3";
  let dynamoDBTable = args["dynamodb-table"] || "";
  let secretsProvider = args["secrets-provider"] || "awskms";
  let kmsAlias = args["kms-alias"] || "alias/pulumi-secrets";
  let passphrase = args.passphrase || "";
  
  // Interactive configuration if project doesn't exist
  if (!projectExists) {
    // Project name (default: directory name)
    if (!projectName && args.interactive) {
      projectName = await logger.prompt("Project name", defaultProjectName);
    } else if (!projectName) {
      projectName = defaultProjectName;
    }
    
    // Project description
    if (!projectDescription && args.interactive) {
      projectDescription = await logger.prompt("Project description", "");
    }
    
    // Project template
    if (args.interactive) {
      const templates = ["typescript", "python", "go", "csharp", "nodejs"];
      projectTemplate = await logger.select(
        "Select project template", 
        templates, 
        templates.indexOf(projectTemplate)
      );
    }
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
  
  // Stack name
  if (args.interactive) {
    stackName = await logger.prompt("Stack name", stackName);
  }
  
  // =========================================================================
  // Step 3: Backend configuration
  // =========================================================================
  logger.section("BACKEND CONFIGURATION");
  
  // Bucket name (default: derived from project name)
  if (!bucketName) {
    const suggestedBucketName = `${statePrefix}${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    
    if (args.interactive) {
      bucketName = await logger.prompt("S3 bucket name for state storage", suggestedBucketName);
    } else {
      bucketName = suggestedBucketName;
      logger.info(`Using generated bucket name: ${bold(bucketName)}`);
    }
  }
  
  // Region
  if (args.interactive) {
    const regions = [
      "us-east-1", "us-east-2", "us-west-1", "us-west-2", 
      "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1",
      "ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2"
    ];
    region = await logger.select(
      "Select AWS region", 
      regions, 
      regions.indexOf(region) !== -1 ? regions.indexOf(region) : 0
    );
  }
  
  // DynamoDB for state locking
  if (!dynamoDBTable && args.interactive) {
    const useDynamoDB = await logger.confirm("Use DynamoDB for state locking?", false);
    if (useDynamoDB) {
      dynamoDBTable = await logger.prompt(
        "DynamoDB table name", 
        `pulumi-state-lock-${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
      );
    }
  }
  
  // Secrets provider
  if (args.interactive) {
    secretsProvider = await logger.select(
      "Select secrets provider", 
      ["awskms", "passphrase", "default"], 
      ["awskms", "passphrase", "default"].indexOf(secretsProvider)
    );
    
    if (secretsProvider === "awskms") {
      kmsAlias = await logger.prompt("KMS alias for secrets", kmsAlias);
    } else if (secretsProvider === "passphrase") {
      passphrase = await logger.prompt("Passphrase for secrets", "");
      if (passphrase) {
        Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
      }
    }
  }
  
  // =========================================================================
  // Step 4: Infrastructure setup
  // =========================================================================
  logger.section("INFRASTRUCTURE SETUP");
  
  // Check if S3 bucket exists and create if needed
  logger.startSpinner("check-bucket", `Checking if S3 bucket "${bucketName}" exists...`);
  const bucketExists = await checkS3BucketExists(bucketName, region);
  
  if (!bucketExists) {
    logger.warningSpinner("check-bucket", `S3 bucket "${bucketName}" doesn't exist`);
    
    if (args["create-bucket"]) {
      const bucketCreated = await createS3Bucket(bucketName, region);
      if (!bucketCreated) {
        logger.error(`Failed to create S3 bucket. Please create it manually or check your permissions.`);
        Deno.exit(1);
      }
      
      // Set bucket permissions
      await checkAndFixS3Permissions(bucketName, region);
    } else {
      logger.error(`S3 bucket "${bucketName}" doesn't exist and --create-bucket is disabled.`);
      logger.info(`Please create the bucket manually or enable automatic creation with --create-bucket.`);
      Deno.exit(1);
    }
  } else {
    logger.successSpinner("check-bucket", `S3 bucket "${bucketName}" already exists`);
    
    // Check and fix permissions for existing bucket
    await checkAndFixS3Permissions(bucketName, region);
  }
  
  // Check if DynamoDB table exists and create if needed
  if (dynamoDBTable) {
    logger.startSpinner("check-dynamo", `Checking if DynamoDB table "${dynamoDBTable}" exists...`);
    const tableExists = await checkDynamoDBTableExists(dynamoDBTable, region);
    
    if (!tableExists) {
      logger.warningSpinner("check-dynamo", `DynamoDB table "${dynamoDBTable}" doesn't exist`);
      
      if (args["create-dynamodb"]) {
        const tableCreated = await createDynamoDBTable(dynamoDBTable, region);
        if (!tableCreated) {
          logger.error(`Failed to create DynamoDB table. Please create it manually or check your permissions.`);
          logger.warning(`Continuing without state locking...`);
          dynamoDBTable = "";
        }
      } else {
        logger.warning(`DynamoDB table "${dynamoDBTable}" doesn't exist and --create-dynamodb is disabled.`);
        logger.warning(`Continuing without state locking...`);
        dynamoDBTable = "";
      }
    } else {
      logger.successSpinner("check-dynamo", `DynamoDB table "${dynamoDBTable}" already exists`);
    }
  }
  
  // Handle KMS key for secrets if using AWS KMS
  let finalKmsAlias = kmsAlias;
  if (secretsProvider === "awskms") {
    const aliasName = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
    
    logger.startSpinner("check-kms", `Checking if KMS alias "${aliasName}" exists...`);
    const kmsExists = await checkKmsAliasExists(aliasName, region);
    
    if (!kmsExists) {
      logger.warningSpinner("check-kms", `KMS alias "${aliasName}" doesn't exist`);
      
      if (args["create-kms"]) {
        const kmsCreated = await createKmsKeyAndAlias(aliasName, region);
        if (!kmsCreated) {
          logger.error(`Failed to create KMS key and alias. Please create them manually or check your permissions.`);
          logger.warning(`Continuing with default secrets provider...`);
          secretsProvider = "default";
        } else {
          finalKmsAlias = kmsCreated;
        }
      } else {
        logger.warning(`KMS alias "${aliasName}" doesn't exist and --create-kms is disabled.`);
        logger.warning(`Falling back to default secrets provider...`);
        secretsProvider = "default";
      }
    } else {
      logger.successSpinner("check-kms", `KMS alias "${aliasName}" already exists`);
    }
  } else if (secretsProvider === "passphrase" && passphrase) {
    // Set passphrase environment variable if using passphrase provider
    Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
  }
  
  // =========================================================================
  // Step 5: Project Initialization
  // =========================================================================
  logger.section("PROJECT INITIALIZATION");
  
  // Login to S3 backend
  const backendUrl = `s3://${bucketName}?region=${region}${dynamoDBTable ? `&dynamodb_table=${dynamoDBTable}` : ''}`;
  const s3LoginSuccess = await loginToS3Backend(bucketName, region, dynamoDBTable);
  
  if (!s3LoginSuccess) {
    logger.error(`Failed to configure S3 backend. Initialization aborted.`);
    Deno.exit(1);
  }
  
  // Initialize project if it doesn't exist
  if (!projectExists) {
    const projectInitialized = await initPulumiProject(projectName, projectDescription, projectTemplate);
    if (!projectInitialized) {
      logger.error(`Failed to initialize Pulumi project. Initialization aborted.`);
      Deno.exit(1);
    }
  }
  
  // Create stack
  const secretsConfig = {
    passphrase: passphrase,
    kmsAlias: finalKmsAlias,
    region: region
  };
  
  const stackCreated = await createStack(stackName, secretsProvider, secretsConfig);
  if (!stackCreated) {
    logger.error(`Failed to create Pulumi stack. Initialization aborted.`);
    Deno.exit(1);
  }
  
  // =========================================================================
  // Step 6: Success and next steps
  // =========================================================================
  logger.section("INITIALIZATION COMPLETE");
  
  logger.success(`Project "${projectName}" initialized with S3 backend: ${backendUrl}`);
  console.log();
  
  // Describe the secrets provider
  let secretsInfo = "";
  if (secretsProvider === "awskms") {
    secretsInfo = `\n   ${SYMBOLS.key} Your stack is using AWS KMS for secrets encryption with key: ${finalKmsAlias}`;
  } else if (secretsProvider === "passphrase") {
    secretsInfo = `\n   ${SYMBOLS.lock} Your stack is using passphrase encryption for secrets. Make sure to set PULUMI_CONFIG_PASSPHRASE in your environment.`;
  }
  
  // Final instructions
  console.log(`${bgGreen(black(" NEXT STEPS "))}

   ${SYMBOLS.bullet} ${bold("Edit your Pulumi program")} in the project directory

   ${SYMBOLS.bullet} ${bold("Run a preview")} to see the resources that would be created:
     ${green(`pulumi preview`)}

   ${SYMBOLS.bullet} ${bold("Deploy your infrastructure")} with:
     ${green(`pulumi up`)}

   ${SYMBOLS.bullet} ${bold("For CI/CD pipelines")}, use the backend URL:
     ${green(`pulumi login "${backendUrl}"`)}${secretsInfo}
`);
}

// Run the initialization
await initializePulumiS3Project();