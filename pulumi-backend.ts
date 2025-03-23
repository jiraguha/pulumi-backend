#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

/**
 * 🚀 Pulumi Backend Management CLI
 * 
 * A unified command-line interface for managing Pulumi backends.
 * Supports multiple operations:
 * - Cloud to S3: `pulumi-backend cloudToS3 [options]`
 * - S3 to Cloud: `pulumi-backend s3ToCloud [options]`
 * - Initialize: `pulumi-backend init [options]`
 * - Self-update: `pulumi-backend self-update`
 * 
 * 📋 Usage:
 *   pulumi-backend <command> [options]
 */

import { join, dirname } from "https://deno.land/std/path/mod.ts";
import { parse } from "https://deno.land/std/flags/mod.ts";
import { bold, red, green, blue, yellow, cyan, bgBlue, bgGreen, bgCyan, black, dim } from "https://deno.land/std/fmt/colors.ts";
import { ensureDir, exists } from "https://deno.land/std/fs/mod.ts";

// Get the current script directory
const scriptPath = new URL(import.meta.url).pathname;
const scriptDir = dirname(scriptPath);

// Define the version
const VERSION = "1.0.0";
const REPO_DIR = `${Deno.env.get("HOME")}/.pulumi-backend`;

// Define commands and their scripts
const COMMANDS = {
  "cloudToS3": {
    script: join(REPO_DIR, "pulumi-cloud-to-s3.ts"),
    description: "Migrate Pulumi stack from Pulumi Cloud to an S3 backend",
    help: "pulumi-backend cloudToS3 --stack=mystack --bucket=my-pulumi-state [options]"
  },
  "s3ToCloud": {
    script: join(REPO_DIR, "pulumi-s3-to-cloud.ts"),
    description: "Migrate Pulumi stack from an S3 backend to Pulumi Cloud",
    help: "pulumi-backend s3ToCloud --stack=mystack --backend=s3://my-bucket?region=us-west-2 [options]"
  },
  "init": {
    script: join(REPO_DIR, "pulumi-init.ts"),
    description: "Initialize a new Pulumi project with an S3 backend",
    help: "pulumi-backend init --name=my-project --bucket=my-pulumi-state [options]"
  },
  "self-update": {
    script: "",  // Special handling
    description: "Update the Pulumi Backend Management Tool to the latest version",
    help: "pulumi-backend self-update [--tag <version>]"
  }
};

// Extract command and arguments
const args = Deno.args;
const command = args[0]
const commandArgs = args.slice(1);

// Show banner
function showBanner() {
  console.log(`
${bgBlue(black(" PULUMI "))}${bgCyan(black(" BACKEND "))}${bgGreen(black(" MANAGEMENT "))} ${cyan(`v${VERSION}`)}

${dim("A unified tool for managing Pulumi backends and migrations")}
`);
}

// Show help information
function showHelp() {
  showBanner();
  
  console.log(`
${bold("USAGE:")}
  pulumi-backend <command> [options]

${bold("COMMANDS:")}
  cloudToS3    ${dim("Migrate from Pulumi Cloud to an S3 backend")}
  s3ToCloud    ${dim("Migrate from an S3 backend to Pulumi Cloud")}
  init         ${dim("Initialize a new Pulumi project with an S3 backend")}
  self-update  ${dim("Update the Pulumi Backend Management Tool to the latest version")}
  help         ${dim("Show this help information")}

${bold("EXAMPLES:")}
  ${green("# Migrate from Pulumi Cloud to S3")}
  pulumi-backend cloudToS3 --stack=mystack --bucket=my-bucket --region=us-west-2

  ${green("# Migrate from S3 to Pulumi Cloud")}
  pulumi-backend s3ToCloud --stack=mystack --backend=s3://my-bucket?region=us-west-2

  ${green("# Initialize a new project with S3 backend")}
  pulumi-backend init --name=my-project --bucket=my-pulumi-state

  ${green("# Update the tool to the latest version")}
  pulumi-backend self-update

${bold("OPTIONS:")}
  For command-specific options, run:
  pulumi-backend <command> --help
`);
}

/**
 * Execute a shell command with improved error handling and output
 */
async function executeCommand(command: string[], options: { cwd?: string } = {}): Promise<{ output: string; success: boolean }> {
  try {
    const process = Deno.run({
      cmd: command,
      cwd: options.cwd,
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

    return { output: output.trim(), success: true };
  } catch (error) {
    return { output: error.message, success: false };
  }
}

/**
 * Check if a command exists on the system
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const command = Deno.build.os === 'windows' ? ['where', cmd] : ['which', cmd];
    const process = Deno.run({
      cmd: command,
      stdout: "null",
      stderr: "null"
    });
    const status = await process.status();
    process.close();
    return status.success;
  } catch (_) {
    return false;
  }
}

/**
 * Self-update the Pulumi Backend Management Tool
 */
async function selfUpdate(updateArgs: string[]): Promise<boolean> {
  console.log(bold(blue("Updating Pulumi Backend Management Tool...")));
  
  // Parse update arguments
  const updateOptions = parse(updateArgs, {
    string: ["tag", "branch", "ref"],
    boolean: ["help"],
    alias: {
      t: "tag",
      b: "branch",
      r: "ref",
      h: "help"
    },
    default: {}
  });
  
  // Show help if requested
  if (updateOptions.help) {
    console.log(`
${bold("USAGE:")}
  pulumi-backend self-update [options]

${bold("OPTIONS:")}
  --tag TAG        Update to a specific tagged version
  --branch BRANCH  Update to a specific branch
  --ref REF        Update to a specific Git reference
  --help           Show this help message
`);
    return true;
  }
  
  // Check if Git is installed
  if (!await commandExists("git")) {
    console.error(red("Error: Git is not installed. Please install Git to use self-update."));
    return false;
  }
  
  // Check if repository directory exists
  if (!await exists(REPO_DIR)) {
    console.error(red(`Error: Repository directory ${REPO_DIR} does not exist.`));
    console.error(yellow("Please reinstall the tool using the installer script."));
    return false;
  }
  
  try {
    console.log(dim(`Updating repository in ${REPO_DIR}...`));
    
    // Determine Git reference to use (tag, branch, ref, or default to current branch)
    let gitRef = "";
    if (updateOptions.tag) {
      gitRef = updateOptions.tag;
      console.log(`Updating to tag: ${cyan(gitRef)}`);
    } else if (updateOptions.branch) {
      gitRef = updateOptions.branch;
      console.log(`Updating to branch: ${cyan(gitRef)}`);
    } else if (updateOptions.ref) {
      gitRef = updateOptions.ref;
      console.log(`Updating to reference: ${cyan(gitRef)}`);
    }
    
    // If a specific ref was requested, checkout that ref
    if (gitRef) {
      const { success, output } = await executeCommand(["git", "fetch"], { cwd: REPO_DIR });
      if (!success) {
        console.error(red(`Failed to fetch repository updates: ${output}`));
        return false;
      }
      
      const { success: checkoutSuccess, output: checkoutOutput } = await executeCommand(["git", "checkout", gitRef], { cwd: REPO_DIR });
      if (!checkoutSuccess) {
        console.error(red(`Failed to checkout ${gitRef}: ${checkoutOutput}`));
        return false;
      }
    }
    
    // Pull latest changes
    const { success: pullSuccess, output: pullOutput } = await executeCommand(["git", "pull", "--force"], { cwd: REPO_DIR });
    if (!pullSuccess) {
      console.error(red(`Failed to pull updates: ${pullOutput}`));
      return false;
    }
    
    // Get current script installation directory
    const installDir = dirname(scriptPath);
    
    // Required files to copy
    const requiredFiles = [
      "pulumi-backend.ts",
      "pulumi-cloud-to-s3.ts",
      "pulumi-s3-to-cloud.ts",
      "pulumi-init.ts"
    ];
    
    // Copy updated files to installation directory
    console.log(dim(`Updating installed scripts in ${installDir}...`));
    
    for (const file of requiredFiles) {
      const sourcePath = join(REPO_DIR, file);
      const destPath = join(installDir, file);
      
      // Check if source file exists
      if (!await exists(sourcePath)) {
        console.error(red(`Error: Required file ${file} not found in repository.`));
        return false;
      }
      
      // Copy file
      try {
        await Deno.copyFile(sourcePath, destPath);
        await Deno.chmod(destPath, 0o755); // Make executable
        console.log(`${green("✓")} Updated ${file}`);
      } catch (error) {
        console.error(red(`Failed to update ${file}: ${error.message}`));
        console.error(yellow("You may need sudo privileges to update the files."));
        return false;
      }
    }
    
    // Create symlink (if it doesn't already exist or points to wrong location)
    const symlinkPath = join(installDir, "pulumi-backend");
    const symlinkTarget = join(installDir, "pulumi-backend.ts");
    
    try {
      const symlinkInfo = await Deno.lstat(symlinkPath);
      if (!symlinkInfo.isSymlink) {
        await Deno.remove(symlinkPath);
        await Deno.symlink(symlinkTarget, symlinkPath);
      }
    } catch {
      // Symlink doesn't exist or couldn't be checked, try to create it
      try {
        await Deno.symlink(symlinkTarget, symlinkPath);
      } catch (error) {
        console.error(yellow(`Note: Failed to create symlink: ${error.message}`));
        console.log(yellow("This is not critical, you can still use pulumi-backend.ts directly."));
      }
    }
    
    // Get current git commit to show version
    const { output: commitHash } = await executeCommand(["git", "rev-parse", "--short", "HEAD"], { cwd: REPO_DIR });
    const { output: branchName } = await executeCommand(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: REPO_DIR });
    
    console.log(green(bold("\nUpdate successful!")));
    console.log(`${bold("Current version:")} ${branchName} (${commitHash})`);
    
    return true;
  } catch (error) {
    console.error(red(`Error during self-update: ${error.message}`));
    return false;
  }
}

// Main function
async function main() {
  // Show help if no command or help command
  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    Deno.exit(0);
  }
  
  // Check if command exists
  if (!COMMANDS[command]) {
    console.error(red(`Error: Unknown command '${command}'`));
    console.log(`Run ${bold("pulumi-backend help")} for usage information.`);
    Deno.exit(1);
  }
  
  // Handle self-update command
  if (command === "self-update") {
    const success = await selfUpdate(commandArgs);
    Deno.exit(success ? 0 : 1);
  }
  
  // Get command info
  const { script, description } = COMMANDS[command];
  
  // Check if script exists
  try {
    await Deno.stat(script);
  } catch (error) {
    console.error(red(`Error: Script not found: ${script}`));
    console.error(yellow(`Make sure the repository in ${REPO_DIR} is properly set up.`));
    console.error(yellow("You can run 'pulumi-backend self-update' to fix missing files."));
    Deno.exit(1);
  }
  
  // Execute the appropriate script with all arguments
  console.log(blue(`${description}...`));
  
  const process = Deno.run({
    cmd: ["deno", "run", "--allow-run", "--allow-read", "--allow-write", "--allow-env", script, ...commandArgs],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  
  const status = await process.status();
  process.close();
  
  Deno.exit(status.code);
}

// Run the script
await main();
