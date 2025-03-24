#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

/**
 * 🚀 Pulumi Stack Migration Tool
 *
 * A professional-grade CLI tool to migrate Pulumi stacks from Pulumi Cloud to an S3 backend.
 * Features enhanced logging, progress tracking, and comprehensive secrets management.
 *
 * 📋 Usage:
 *   deno run --allow-run --allow-read --allow-write --allow-env pulumi-migrate.ts \
 *     --stack=mystack \
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
    "stack", "bucket", "region", "workspace", "encryption-key", "dynamodb-table",
    "passphrase", "kms-alias", "secrets-provider", "output-format"
  ],
  boolean: [
    "help", "delete-source", "skip-verify", "verbose", "create-bucket", "create-dynamodb",
    "create-kms", "quiet", "yes", "no-color", "interactive"
  ],
  alias: {
    h: "help",
    s: "stack",
    b: "bucket",
    r: "region",
    w: "workspace",
    d: "delete-source",
    v: "verbose",
    k: "encryption-key",
    t: "dynamodb-table",
    p: "passphrase",
    a: "kms-alias",
    y: "yes",
    q: "quiet",
    i: "interactive",
    o: "output-format"
  },
  default: {
    region: Deno.env.get("AWS_REGION") || "eu-west-3",
    workspace: ".",
    "delete-source": false,
    "skip-verify": false,
    "create-bucket": true,
    "create-dynamodb": false,
    "create-kms": true,
    "kms-alias": "alias/pulumi-secrets",
    "secrets-provider": "awskms",
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
${bgBlue(black(" PULUMI "))}${bgCyan(black(" MIGRATION "))}${bgGreen(black(" TOOL "))} ${cyan("v1.0.0")}

${dim("A professional-grade tool to migrate Pulumi stacks from Pulumi Cloud to an S3 backend.")}
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
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-migrate.ts [OPTIONS]

${bold("REQUIRED OPTIONS:")}
  -s, --stack=<name>        ${dim("Stack name to migrate")}

${bold("BACKEND OPTIONS:")}
  -b, --bucket=<name>       ${dim("S3 bucket name for backend storage (default: generated from stack name)")}
  -r, --region=<region>     ${dim("AWS region for resources (default: from AWS_REGION or eu-west-3)")}
  -t, --dynamodb-table=<n>  ${dim("DynamoDB table name for state locking")}
  --create-bucket           ${dim("Create S3 bucket if it doesn't exist (default: true)")}
  --create-dynamodb         ${dim("Create DynamoDB table if it doesn't exist (default: false)")}
  --no-create-bucket        ${dim("Don't create S3 bucket if it doesn't exist")}

${bold("SECRETS OPTIONS:")}
  --secrets-provider=<type> ${dim("Secrets provider type: 'awskms', 'passphrase', 'default' (default: awskms)")}
  -a, --kms-alias=<alias>   ${dim("KMS key alias for secrets (default: alias/pulumi-secrets)")}
  -p, --passphrase=<pass>   ${dim("Passphrase for secrets encryption when using passphrase provider")}
  --create-kms              ${dim("Create KMS key if it doesn't exist (default: true)")}

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
  ${green("# Basic migration with auto-generated bucket name")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-migrate.ts \\
    --stack=dev \\
    --region=us-west-2

  ${green("# With specific bucket")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-migrate.ts \\
    --stack=dev \\
    --bucket=my-pulumi-state \\
    --region=us-west-2

  ${green("# With DynamoDB state locking")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-migrate.ts \\
    --stack=dev \\
    --dynamodb-table=pulumi-state-lock \\
    --create-dynamodb

  ${green("# Using passphrase for secrets")}
  deno run --allow-run --allow-read --allow-write --allow-env pulumi-migrate.ts \\
    --stack=dev \\
    --secrets-provider=passphrase \\
    --passphrase=my-secret-passphrase

  ${green("# Migrate all stacks in a project")}
  for STACK in $(pulumi stack ls --json | jq -r '.[].name'); do \\
    deno run --allow-run --allow-read --allow-write --allow-env pulumi-migrate.ts \\
      --stack=$STACK \\
      --yes
  done
`);
}
// Show help if requested or missing required arguments
if (args.help || !args.stack) {
  showHelp();
  if (args.help) {
    Deno.exit(0);
  } else {
    console.error(red("Error: Missing required argument (--stack)"));
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

  // Get the current bucket policy, if any
  const { success: getPolicySuccess, output: policyOutput } = await executeCommand(
    ["aws", "s3api", "get-bucket-policy", "--bucket", bucket, "--region", region, "--output", "json"],
    { silent: true }
  );

  let currentPolicy: any = {};
  let hasDenyPolicy = false;

  if (getPolicySuccess && policyOutput) {
    try {
      // The policy is returned as an escaped JSON string
      const policyString = JSON.parse(policyOutput).Policy;
      currentPolicy = JSON.parse(policyString);

      // Check if there's a deny policy affecting our user
      if (currentPolicy.Statement) {
        hasDenyPolicy = currentPolicy.Statement.some((statement: any) =>
          statement.Effect === "Deny" &&
          (statement.Principal === "*" ||
           (statement.Principal && statement.Principal.AWS &&
            (statement.Principal.AWS === "*" || statement.Principal.AWS.includes(currentIdentity))))
        );
      }
    } catch (error) {
      logger.debug(`Error parsing bucket policy: ${error.message}`);
    }
  }

  logger.updateSpinner(
    "fix-perms",
    `Updating bucket policy to ensure access for your AWS user...`
  );

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

  // If there's an existing policy, merge our statement into it
  if (currentPolicy.Statement) {
    // Remove any existing statement with the same Sid
    currentPolicy.Statement = currentPolicy.Statement.filter(
      (statement: any) => statement.Sid !== "AllowPulumiStateAccess"
    );

    // Add our new statement
    currentPolicy.Statement.push(newPolicy.Statement[0]);
    newPolicy.Statement = currentPolicy.Statement;
  }

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
    `Updated bucket policy to ensure your AWS user can access Pulumi state`
  );

  // Wait a moment for the policy to propagate
  if (hasDenyPolicy) {
    logger.startSpinner("propagate", "Waiting for permissions to propagate...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    logger.successSpinner("propagate", "Permissions should be active now");
  }

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
 * Change secrets provider for an existing stack
 */
async function changeSecretProvider(
  stack: string,
  workspacePath: string,
  secretsProvider: string,
  secretsConfig: {
    passphrase?: string;
    kmsAlias?: string;
    region: string;
  }
): Promise<string | null> {
  logger.startSpinner(
    "change-secrets",
    `Changing secrets provider for stack "${stack}"...`
  );

  const initCommand = ["pulumi", "stack", "change-secrets-provider"];

  if (secretsProvider === "passphrase") {
    // For passphrase secrets provider
    if (secretsConfig.passphrase) {
      // Set environment variable for the child process
      Deno.env.set("PULUMI_CONFIG_PASSPHRASE", secretsConfig.passphrase);
      logger.debug(`Using passphrase for secrets encryption`);
      initCommand.push("passphrase");
    } else {
      logger.errorSpinner(
        "change-secrets",
        `No passphrase provided for passphrase secrets provider`
      );
      return null;
    }
  } else if (secretsProvider === "awskms") {
    const kmsAlias = secretsConfig.kmsAlias || "alias/pulumi-secrets";
    const region = secretsConfig.region;

    // Build the awskms:// URL
    const kmsKeyId = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
    const secretsProviderUrl = `awskms://${kmsKeyId}?region=${region}`;

    initCommand.push(secretsProviderUrl);
    logger.debug(`Using AWS KMS for secrets encryption: ${secretsProviderUrl}`);
  } else {
    // For any other provider specified
    initCommand.push(secretsProvider);
  }

  initCommand.push("--stack", stack);

  const { success, output } = await executeCommand(
    initCommand,
    { cwd: workspacePath, silent: true }
  );

  if (!success) {
    logger.errorSpinner(
      "change-secrets",
      `Failed to change secrets provider: ${output}`
    );
    return null;
  }

  logger.successSpinner(
    "change-secrets",
    `Changed secrets provider to ${secretsProvider} for stack "${stack}"`
  );
  return secretsProvider;
}

/**
 * Export the stack state from Pulumi Cloud
 */
async function exportStackState(stack: string, workspacePath: string): Promise<string | null> {
  const tempDir = join(Deno.cwd(), ".pulumi-migrate-temp");
  await ensureDir(tempDir);

  const stackName = stack.replaceAll("/", "-");
  const statePath = join(tempDir, `${stackName}-state.json`);

  logger.startSpinner(
    "export-state",
    `Exporting stack state for "${stack}" to temporary file...`
  );

  const { success, output } = await executeCommand(
    ["pulumi", "stack", "export", "--show-secrets", "--stack", stack, "--file", statePath],
    { cwd: workspacePath, silent: true }
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
 * Switch to S3 backend
 */
async function loginToS3Backend(bucket: string, region: string, dynamoDBTable?: string): Promise<boolean> {
  logger.startSpinner("s3-login", `Switching to S3 backend...`);

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
    `Successfully logged into S3 backend: ${loginUrl}`
  );
  return true;
}

/**
 * Create a new stack in the S3 backend
 */
async function createStackInS3(
  stack: string,
  workspacePath: string,
  secretsProvider: string,
  secretsConfig: {
    passphrase?: string;
    kmsAlias?: string;
    region: string;
  }
): Promise<boolean> {
  const [orgName, stackName] = stack.split('/');
  const displayName = stackName || stack;

  logger.startSpinner(
    "create-stack",
    `Creating stack "${displayName}" in S3 backend...`
  );

  // Prepare command
  const initCommand = ["pulumi", "stack", "init"];

  // Use just the stack name part if org is present
  initCommand.push(stackName || stack);
  initCommand.push("--non-interactive");

  // Configure secrets provider
  if (secretsProvider === "passphrase") {
    // For passphrase secrets provider
    if (secretsConfig.passphrase) {
      // Set environment variable for the child process
      Deno.env.set("PULUMI_CONFIG_PASSPHRASE", secretsConfig.passphrase);
      logger.debug(`Using passphrase for secrets encryption`);
    } else {
      logger.warning(`No passphrase provided for passphrase secrets provider. Expect errors or prompts.`);
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

  // If org name is present, try to add organization flag
  if (orgName && stackName) {
    initCommand.push("--organization", orgName);
  }

  const { success, output } = await executeCommand(
    initCommand,
    { cwd: workspacePath, silent: true }
  );

  if (!success) {
    // If organization flag fails, try without it
    if (orgName && stackName) {
      logger.debug(`Failed to create stack with organization. Trying without organization flag...`);

      const fallbackCommand = ["pulumi", "stack", "init", stackName, "--non-interactive"];

      // Add the secrets provider if specified
      if (secretsProvider === "awskms") {
        const kmsAlias = secretsConfig.kmsAlias || "alias/pulumi-secrets";
        const region = secretsConfig.region;
        const kmsKeyId = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
        fallbackCommand.push("--secrets-provider", `awskms://${kmsKeyId}?region=${region}`);
      } else if (secretsProvider === "passphrase") {
        // Passphrase is handled via env var
      } else if (secretsProvider !== "default") {
        fallbackCommand.push("--secrets-provider", secretsProvider);
      }

      const { success: fallbackSuccess } = await executeCommand(
        fallbackCommand,
        { cwd: workspacePath, silent: true }
      );

      if (!fallbackSuccess) {
        logger.errorSpinner(
          "create-stack",
          `Failed to create stack in S3 backend: ${output}`
        );
        return false;
      }
    } else {
      logger.errorSpinner(
        "create-stack",
        `Failed to create stack in S3 backend: ${output}`
      );
      return false;
    }
  }

  logger.successSpinner(
    "create-stack",
    `Successfully created stack "${displayName}" in S3 backend`
  );
  return true;
}

/**
 * Import the stack state to the S3 backend
 */
async function importStackState(stack: string, statePath: string, workspacePath: string): Promise<boolean> {
  const [orgName, stackName] = stack.split('/');
  const displayName = stackName || stack;

  logger.startSpinner(
    "import-state",
    `Importing stack state to "${displayName}" in S3 backend...`
  );

  const { success, output } = await executeCommand(
    ["pulumi", "stack", "import", "--stack", stackName || stack, "--file", statePath],
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
    `Successfully imported stack state to "${displayName}"`
  );
  return true;
}

/**
 * Verify the migration by running pulumi up with no changes expected
 */
async function verifyMigration(stack: string, workspacePath: string): Promise<boolean> {
  const [orgName, stackName] = stack.split('/');
  const displayName = stackName || stack;

  logger.startSpinner(
    "verify",
    `Verifying stack migration (expecting no changes)...`
  );

  const { success, output } = await executeCommand(
    ["pulumi", "preview", "--stack", stackName || stack, "--diff"],
    { cwd: workspacePath, silent: true }
  );

  // More robust change detection
  const hasChanges = (
    // Check for direct change indicators
    // Also check newer format with resources summary section
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
 * Delete the source stack from Pulumi Cloud
 */
async function deleteSourceStack(stack: string, backendUrl: string ,workspacePath: string): Promise<boolean> {
  logger.startSpinner(
    "delete-source",
    `Preparing to delete original stack "${stack}" from Pulumi Cloud...`
  );

  // First, we need to log back into Pulumi Cloud
  await executeCommand(["pulumi", "logout"], { silent: true });
  await executeCommand(["pulumi", "login"], { silent: true });

  logger.updateSpinner(
    "delete-source",
    `Removing source stack "${stack}" from Pulumi Cloud...`
  );

  // Force deletion with --yes
  const { success, output } = await executeCommand(
    ["pulumi", "stack", "rm", "--stack", stack, "--force", "--yes"],
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
    `Successfully deleted source stack "${stack}" from Pulumi Cloud`
  );

  await executeCommand(["pulumi", "login", backendUrl], { silent: true });

  return true;
}

/**
 * Clean up temporary files
 */
async function cleanUpTempFiles(): Promise<void> {
  const tempDir = join(Deno.cwd(), ".pulumi-migrate-temp");
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
    bucket: providedBucket,
    region,
    workspace,
    "delete-source": deleteSource,
    "skip-verify": skipVerify,
    "create-bucket": createBucketIfNotExists,
    "create-dynamodb": createDynamoDBIfNotExists,
    "dynamodb-table": dynamoDBTable,
    "secrets-provider": secretsProvider,
    passphrase,
    "kms-alias": kmsAlias,
    "create-kms": createKmsIfNotExists,
    "fix-permissions": fixPermissions
  } = args;

  // Display migration plan
  logger.section("MIGRATION PLAN");

  logger.info(`Source stack: ${bold(stack)}`);
  if(providedBucket) {
    logger.info(`Target backend: ${bold(`s3://${providedBucket}?region=${region}${dynamoDBTable ? `&dynamodb_table=${dynamoDBTable}` : ''}`)}`);
  }
  logger.info(`Secrets provider: ${bold(secretsProvider)}`);
  logger.info(`Workspace path: ${bold(workspace)}`);

  // =========================================================================
  // Step 2: Interactive project configuration
  // =========================================================================
  let projectName = ""
  logger.section("PROJECT CONFIGURATION");
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

  let bucket = providedBucket;
  // Bucket name (default: derived from project name)
  if (!bucket) {
    const suggestedBucketName = `${statePrefix}${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

    if (args.interactive) {
      bucket = await logger.prompt("S3 bucket name for state storage", suggestedBucketName);
    } else {
      bucket = suggestedBucketName;
      logger.info(`Using generated bucket name: ${bold(bucket)}`);
    }
  }
  // =========================================================================
  // Step 2: Set up infrastructure if needed
  // =========================================================================
  logger.section("INFRASTRUCTURE SETUP");

  // Check if S3 bucket exists and create if needed
  logger.startSpinner("check-bucket", `Checking if S3 bucket "${bucket}" exists...`);
  const bucketExists = await checkS3BucketExists(bucket, region);

  if (!bucketExists) {
    logger.warningSpinner("check-bucket", `S3 bucket "${bucket}" doesn't exist`);

    if (createBucketIfNotExists) {
      const bucketCreated = await createS3Bucket(bucket, region);
      if (!bucketCreated) {
        logger.error(`Failed to create S3 bucket. Please create it manually or check your permissions.`);
        Deno.exit(1);
      }
    } else {
      logger.error(`S3 bucket "${bucket}" doesn't exist and --create-bucket is disabled.`);
      logger.info(`Please create the bucket manually or enable automatic creation with --create-bucket.`);
      Deno.exit(1);
    }
  } else {
    logger.successSpinner("check-bucket", `S3 bucket "${bucket}" already exists`);
  }

  // Fix S3 bucket permissions if enabled
  if (fixPermissions) {
    await checkAndFixS3Permissions(bucket, region);
  }

  // Check if DynamoDB table exists and create if needed
  if (dynamoDBTable) {
    logger.startSpinner("check-dynamo", `Checking if DynamoDB table "${dynamoDBTable}" exists...`);
    const tableExists = await checkDynamoDBTableExists(dynamoDBTable, region);

    if (!tableExists) {
      logger.warningSpinner("check-dynamo", `DynamoDB table "${dynamoDBTable}" doesn't exist`);

      if (createDynamoDBIfNotExists) {
        const tableCreated = await createDynamoDBTable(dynamoDBTable, region);
        if (!tableCreated) {
          logger.error(`Failed to create DynamoDB table. Please create it manually or check your permissions.`);
          logger.warning(`Continuing without state locking...`);
        }
      } else {
        logger.warning(`DynamoDB table "${dynamoDBTable}" doesn't exist and --create-dynamodb is disabled.`);
        logger.warning(`Continuing without state locking...`);
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

      if (createKmsIfNotExists) {
        const kmsCreated = await createKmsKeyAndAlias(aliasName, region);
        if (!kmsCreated) {
          logger.error(`Failed to create KMS key and alias. Please create them manually or check your permissions.`);
          logger.warning(`Continuing with default secrets provider...`);
          // Fall back to passphrase if provided, otherwise use environment variable
          if (passphrase) {
            logger.info(`Using provided passphrase as fallback`);
            Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
          } else {
            logger.warning(`No passphrase provided. Pulumi will prompt for one or use PULUMI_CONFIG_PASSPHRASE env var if set.`);
          }
        } else {
          finalKmsAlias = kmsCreated;
        }
      } else {
        logger.warning(`KMS alias "${aliasName}" doesn't exist and --create-kms is disabled.`);
        logger.warning(`Falling back to passphrase secrets provider...`);
        // Fall back to passphrase
        if (passphrase) {
          logger.info(`Using provided passphrase as fallback`);
          Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
        }
      }
    } else {
      logger.successSpinner("check-kms", `KMS alias "${aliasName}" already exists`);
    }
  } else if (secretsProvider === "passphrase" && passphrase) {
    // Set passphrase environment variable if using passphrase provider
    Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
  }

  // =========================================================================
  // Step 3: Prepare stack details
  // =========================================================================
  logger.section("STACK MIGRATION");

  // Migration steps
  let backendUrl = `s3://${bucket}?region=${region}`;
  if (dynamoDBTable) {
    backendUrl += `&dynamodb_table=${dynamoDBTable}`;
  }

  logger.info(`Starting migration of stack "${stack}" to backend: ${backendUrl}`);

  const secretsConfig = {
    passphrase: passphrase,
    kmsAlias: finalKmsAlias,
    region: region
  };

  // First, change the secrets provider for the stack
  await changeSecretProvider(stack, workspace, secretsProvider, secretsConfig);

  // 1. Export stack state
  const statePath = await exportStackState(stack, workspace);
  if (!statePath) {
    logger.error(`Failed to export stack state. Migration aborted.`);
    Deno.exit(1);
  }

  // 2. Login to S3 backend
  const s3LoginSuccess = await loginToS3Backend(bucket, region, dynamoDBTable);
  if (!s3LoginSuccess) {
    logger.error(`Failed to login to S3 backend. Migration aborted.`);
    Deno.exit(1);
  }

  // 3. Create stack in S3 with proper secrets configuration
  const stackCreateSuccess = await createStackInS3(stack, workspace, secretsProvider, secretsConfig);
  if (!stackCreateSuccess) {
    logger.error(`Failed to create stack in S3. Migration aborted.`);
    Deno.exit(1);
  }

  // 4. Import stack state
  const importSuccess = await importStackState(stack, statePath, workspace);
  if (!importSuccess) {
    logger.error(`Failed to import stack state. Migration aborted.`);
    Deno.exit(1);
  }

  // 5. Verify migration
  if (!skipVerify) {
    const verificationSuccess = await verifyMigration(stack, workspace);
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

  // 6. Delete source stack if requested
  if (deleteSource) {
    const shouldDelete = args.yes || await logger.confirm(
      `Are you sure you want to delete the source stack "${stack}" from Pulumi Cloud?`,
      false
    );

    if (shouldDelete) {
      const deleteSuccess = await deleteSourceStack(stack, backendUrl, workspace);
      if (!deleteSuccess) {
        logger.warning("Failed to delete source stack, but migration was successful");
      }
    } else {
      logger.info("Source stack deletion cancelled by user");
    }
  }

  // 7. Clean up
  logger.startSpinner("cleanup", "Cleaning up temporary files...");
  await cleanUpTempFiles();
  logger.successSpinner("cleanup", "Temporary files cleaned up");

  // Describe the secrets provider in the final message
  let secretsInfo = "";
  if (secretsProvider === "awskms") {
    secretsInfo = `\n   ${SYMBOLS.key} Your stack is using AWS KMS for secrets encryption with key: ${finalKmsAlias}`;
  } else if (secretsProvider === "passphrase") {
    secretsInfo = `\n   ${SYMBOLS.lock} Your stack is using passphrase encryption for secrets. Make sure to set PULUMI_CONFIG_PASSPHRASE in your environment.`;
  }

  // =========================================================================
  // Step 8: Success and next steps
  // =========================================================================
  const [orgName, stackName] = stack.split('/');
  logger.section("MIGRATION COMPLETE");

  logger.success(`Stack "${stack}" successfully migrated to backend: ${backendUrl}`);
  console.log();

  // Final instructions
  console.log(`${bgGreen(black(" NEXT STEPS "))}

   ${SYMBOLS.bullet} ${bold("Confirm your stack")} is working correctly:
     ${green(`pulumi stack select ${stack.includes('/') ? stackName : stack}`)}

   ${SYMBOLS.bullet} ${bold("Verify your infrastructure")} with:
     ${green(`pulumi preview`)}

   ${SYMBOLS.bullet} ${bold("Update any CI/CD pipelines")} to use the new backend URL:
     ${green(`pulumi login "${backendUrl}"`)}${secretsInfo}
`);
}

// Run the migration
await migrateStack();