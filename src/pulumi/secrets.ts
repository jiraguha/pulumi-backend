import type { AppContext, SecretsConfig } from "../types.ts";

export async function changeSecretProvider(
  ctx: AppContext,
  stack: string,
  workspacePath: string,
  secretsProvider: string,
  secretsConfig: SecretsConfig,
): Promise<string | null> {
  const { logger, exec } = ctx;
  logger.startSpinner("change-secrets", `Changing secrets provider for stack "${stack}"...`);

  const initCommand = ["pulumi", "stack", "change-secrets-provider"];

  if (secretsProvider === "passphrase") {
    if (secretsConfig.passphrase) {
      Deno.env.set("PULUMI_CONFIG_PASSPHRASE", secretsConfig.passphrase);
      logger.debug("Using passphrase for secrets encryption");
      initCommand.push("passphrase");
    } else {
      logger.errorSpinner("change-secrets", "No passphrase provided for passphrase secrets provider");
      return null;
    }
  } else if (secretsProvider === "awskms") {
    const kmsAlias = secretsConfig.kmsAlias || "alias/pulumi-secrets";
    const kmsKeyId = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
    const secretsProviderUrl = `awskms://${kmsKeyId}?region=${secretsConfig.region}`;
    initCommand.push(secretsProviderUrl);
    logger.debug(`Using AWS KMS for secrets encryption: ${secretsProviderUrl}`);
  } else {
    initCommand.push(secretsProvider);
  }

  initCommand.push("--stack", stack);

  const { success, output } = await exec(initCommand, { cwd: workspacePath, silent: true });

  if (!success) {
    logger.errorSpinner("change-secrets", `Failed to change secrets provider: ${output}`);
    return null;
  }

  logger.successSpinner("change-secrets", `Changed secrets provider to ${secretsProvider} for stack "${stack}"`);
  return secretsProvider;
}

export async function changeSecretsProviderToDefault(
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

  logger.startSpinner("change-secrets", `Changing secrets provider to default for stack "${targetStack}"...`);

  const { success, output } = await exec(
    ["pulumi", "stack", "change-secrets-provider", "default", "--stack", targetStack],
    { cwd: workspacePath, silent: true },
  );

  if (!success) {
    logger.errorSpinner("change-secrets", `Failed to change secrets provider: ${output}`);
    return false;
  }

  logger.successSpinner("change-secrets", `Successfully changed secrets provider to default for stack "${targetStack}"`);
  return true;
}
