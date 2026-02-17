import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { AppContext, SecretsConfig } from "../types.ts";

export async function exportStackState(
  ctx: AppContext,
  stack: string,
  workspacePath: string,
  env?: Record<string, string>,
): Promise<string | null> {
  const { logger, exec } = ctx;
  const tempDir = join(Deno.cwd(), ".pulumi-migrate-temp");
  await ensureDir(tempDir);

  const stackName = stack.replaceAll("/", "-");
  const statePath = join(tempDir, `${stackName}-state.json`);

  logger.startSpinner("export-state", `Exporting stack state for "${stack}" to temporary file...`);

  const { success, output } = await exec(
    ["pulumi", "stack", "export", "--show-secrets", "--stack", stack, "--file", statePath],
    { cwd: workspacePath, silent: true, env },
  );

  if (!success) {
    logger.errorSpinner("export-state", `Failed to export stack state: ${output}`);
    return null;
  }

  try {
    const fileInfo = await Deno.stat(statePath);
    const fileSizeKB = Math.round(fileInfo.size / 1024);
    logger.successSpinner("export-state", `Successfully exported stack state (${fileSizeKB} KB) to ${statePath}`);
  } catch {
    logger.successSpinner("export-state", `Successfully exported stack state to ${statePath}`);
  }

  return statePath;
}

export async function importStackState(
  ctx: AppContext,
  stack: string,
  statePath: string,
  workspacePath: string,
): Promise<boolean> {
  const { logger, exec } = ctx;
  const stackName = stack.includes("/") ? stack.split("/")[1] : stack;
  const displayName = stackName || stack;

  logger.startSpinner("import-state", `Importing stack state to "${displayName}"...`);

  const { success, output } = await exec(
    ["pulumi", "stack", "import", "--stack", stackName || stack, "--file", statePath],
    { cwd: workspacePath, silent: true },
  );

  if (!success) {
    logger.errorSpinner("import-state", `Failed to import stack state: ${output}`);
    return false;
  }

  logger.successSpinner("import-state", `Successfully imported stack state to "${displayName}"`);
  return true;
}

export async function createStackInS3(
  ctx: AppContext,
  stack: string,
  workspacePath: string,
  secretsProvider: string,
  secretsConfig: SecretsConfig,
): Promise<boolean> {
  const { logger, exec } = ctx;
  const [orgName, stackName] = stack.split("/");
  const displayName = stackName || stack;

  logger.startSpinner("create-stack", `Creating stack "${displayName}" in S3 backend...`);

  const initCommand = ["pulumi", "stack", "init"];
  initCommand.push(stackName || stack);
  initCommand.push("--non-interactive");

  if (secretsProvider === "passphrase") {
    if (secretsConfig.passphrase) {
      Deno.env.set("PULUMI_CONFIG_PASSPHRASE", secretsConfig.passphrase);
      logger.debug("Using passphrase for secrets encryption");
    } else {
      logger.warning("No passphrase provided for passphrase secrets provider. Expect errors or prompts.");
    }
  } else if (secretsProvider === "awskms") {
    const kmsAlias = secretsConfig.kmsAlias || "alias/pulumi-secrets";
    const kmsKeyId = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
    const secretsProviderUrl = `awskms://${kmsKeyId}?region=${secretsConfig.region}`;
    initCommand.push("--secrets-provider", secretsProviderUrl);
    logger.debug(`Using AWS KMS for secrets encryption: ${secretsProviderUrl}`);
  } else if (secretsProvider !== "default") {
    initCommand.push("--secrets-provider", secretsProvider);
    logger.debug(`Using custom secrets provider: ${secretsProvider}`);
  }

  if (orgName && stackName) {
    initCommand.push("--organization", orgName);
  }

  const { success, output } = await exec(initCommand, { cwd: workspacePath, silent: true });

  if (!success) {
    // Fallback: try without organization flag
    if (orgName && stackName) {
      logger.debug("Failed to create stack with organization. Trying without organization flag...");

      const fallbackCommand = ["pulumi", "stack", "init", stackName, "--non-interactive"];
      if (secretsProvider === "awskms") {
        const kmsAlias = secretsConfig.kmsAlias || "alias/pulumi-secrets";
        const kmsKeyId = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
        fallbackCommand.push("--secrets-provider", `awskms://${kmsKeyId}?region=${secretsConfig.region}`);
      } else if (secretsProvider !== "default" && secretsProvider !== "passphrase") {
        fallbackCommand.push("--secrets-provider", secretsProvider);
      }

      const { success: fallbackSuccess } = await exec(fallbackCommand, { cwd: workspacePath, silent: true });
      if (!fallbackSuccess) {
        logger.errorSpinner("create-stack", `Failed to create stack in S3 backend: ${output}`);
        return false;
      }
    } else {
      logger.errorSpinner("create-stack", `Failed to create stack in S3 backend: ${output}`);
      return false;
    }
  }

  logger.successSpinner("create-stack", `Successfully created stack "${displayName}" in S3 backend`);
  return true;
}

export async function createStackInPulumiCloud(
  ctx: AppContext,
  stack: string,
  workspacePath: string,
  organization?: string,
): Promise<boolean> {
  const { logger, exec } = ctx;
  const orgFromStack = stack.includes("/") ? stack.split("/")[0] : null;
  const stackName = stack.includes("/") ? stack.split("/")[1] : stack;
  const targetOrg = organization || orgFromStack;
  const displayName = targetOrg ? `${targetOrg}/${stackName}` : stackName;

  logger.startSpinner("create-stack", `Creating stack "${displayName}" in Pulumi Cloud...`);

  const initCommand = ["pulumi", "stack", "init"];
  if (targetOrg) {
    initCommand.push(`${targetOrg}/${stackName}`);
  } else {
    initCommand.push(stack);
  }
  initCommand.push("--non-interactive");

  const { success, output } = await exec(initCommand, { cwd: workspacePath, silent: true });

  if (!success) {
    logger.errorSpinner("create-stack", `Failed to create stack in Pulumi Cloud: ${output}`);
    return false;
  }

  logger.successSpinner("create-stack", `Successfully created stack "${displayName}" in Pulumi Cloud`);
  return true;
}

export async function createStack(
  ctx: AppContext,
  stackName: string,
  secretsProvider: string,
  secretsConfig: SecretsConfig,
): Promise<boolean> {
  const { logger, exec } = ctx;
  logger.startSpinner("create-stack", `Creating stack "${stackName}"...`);

  const initCommand = ["pulumi", "stack", "init", stackName];

  if (secretsProvider === "passphrase") {
    if (secretsConfig.passphrase) {
      Deno.env.set("PULUMI_CONFIG_PASSPHRASE", secretsConfig.passphrase);
      logger.debug("Using passphrase for secrets encryption");
    } else {
      logger.warning("No passphrase provided for passphrase secrets provider. Expect prompts.");
    }
  } else if (secretsProvider === "awskms") {
    const kmsAlias = secretsConfig.kmsAlias || "alias/pulumi-secrets";
    const kmsKeyId = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
    const secretsProviderUrl = `awskms://${kmsKeyId}?region=${secretsConfig.region}`;
    initCommand.push("--secrets-provider", secretsProviderUrl);
    logger.debug(`Using AWS KMS for secrets encryption: ${secretsProviderUrl}`);
  } else if (secretsProvider !== "default") {
    initCommand.push("--secrets-provider", secretsProvider);
    logger.debug(`Using custom secrets provider: ${secretsProvider}`);
  }

  const { success, output } = await exec(initCommand, { silent: true });

  if (!success) {
    logger.errorSpinner("create-stack", `Failed to create stack: ${output}`);
    return false;
  }

  logger.successSpinner("create-stack", `Successfully created stack "${stackName}"`);
  return true;
}

export async function verifyMigration(
  ctx: AppContext,
  stack: string,
  workspacePath: string,
  organization?: string,
): Promise<boolean> {
  const { logger, exec } = ctx;
  const orgFromStack = stack.includes("/") ? stack.split("/")[0] : null;
  const stackName = stack.includes("/") ? stack.split("/")[1] : stack;
  const targetOrg = organization || orgFromStack;
  const targetStack = targetOrg ? `${targetOrg}/${stackName}` : stackName;

  logger.startSpinner("verify", "Verifying stack migration (expecting no changes)...");

  const { success, output } = await exec(
    ["pulumi", "preview", "--stack", targetStack, "--diff"],
    { cwd: workspacePath, silent: true },
  );

  const hasChanges =
    (output.includes("+ ") && output.match(/\+\s+\d+\s+to create/)) ||
    (output.includes("~ ") && output.match(/~\s+\d+\s+to update/)) ||
    (output.includes("- ") && output.match(/-\s+\d+\s+to delete/));

  if (!success || hasChanges) {
    logger.errorSpinner("verify", "Verification failed: changes detected in the stack");

    if (ctx.args.verbose) {
      logger.info("Preview output:");
      logger.indent();
      output.trim().split("\n").forEach((line) => logger.info(line));
      logger.outdent();
    } else {
      logger.info("Run with --verbose to see details of the detected changes");
    }

    return false;
  }

  logger.successSpinner("verify", "Verification successful: no changes detected in the stack");
  return true;
}

export async function deleteSourceStack(
  ctx: AppContext,
  stack: string,
  switchBackUrl: string,
  workspacePath: string,
  switchToCloud = true,
): Promise<boolean> {
  const { logger, exec } = ctx;
  logger.startSpinner("delete-source", `Preparing to delete original stack "${stack}"...`);

  // Log into the source backend
  await exec(["pulumi", "logout"], { silent: true });
  if (switchToCloud) {
    await exec(["pulumi", "login"], { silent: true });
  } else {
    const loginResult = await exec(["pulumi", "login", switchBackUrl], { silent: true });
    if (!loginResult.success) {
      logger.errorSpinner("delete-source", `Failed to log back into backend: ${loginResult.output}`);
      return false;
    }
  }

  logger.updateSpinner("delete-source", `Removing source stack "${stack}"...`);

  const { success, output } = await exec(
    ["pulumi", "stack", "rm", "--stack", stack, "--force", "--yes"],
    { cwd: workspacePath, silent: true },
  );

  if (!success) {
    logger.errorSpinner("delete-source", `Failed to delete source stack: ${output}`);
    return false;
  }

  logger.successSpinner("delete-source", `Successfully deleted source stack "${stack}"`);

  // Switch back to the target backend
  await exec(["pulumi", "logout"], { silent: true });
  if (switchToCloud) {
    await exec(["pulumi", "login", switchBackUrl], { silent: true });
  } else {
    await exec(["pulumi", "login"], { silent: true });
  }

  return true;
}

export async function cleanUpTempFiles(ctx: AppContext, dirName = ".pulumi-migrate-temp"): Promise<void> {
  const tempDir = join(Deno.cwd(), dirName);
  try {
    await Deno.remove(tempDir, { recursive: true });
    ctx.logger.debug(`Cleaned up temporary directory: ${tempDir}`);
  } catch (error) {
    ctx.logger.debug(`Failed to clean up temporary directory: ${(error as Error).message}`);
  }
}
