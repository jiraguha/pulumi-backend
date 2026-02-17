import type { AppContext } from "../types.ts";

export async function checkKmsAliasExists(
  ctx: AppContext,
  alias: string,
  region: string,
): Promise<boolean> {
  try {
    const aliasName = alias.startsWith("alias/") ? alias : `alias/${alias}`;
    const { success } = await ctx.exec(
      ["aws", "kms", "describe-key", "--key-id", aliasName, "--region", region],
      { silent: true },
    );
    return success;
  } catch {
    return false;
  }
}

export async function createKmsKeyAndAlias(
  ctx: AppContext,
  alias: string,
  region: string,
): Promise<string | null> {
  const { logger, exec } = ctx;
  logger.startSpinner("create-kms", `Creating KMS key and alias "${alias}" for Pulumi secrets...`);

  try {
    // 1. Create KMS key
    const { success: keyCreated, output: keyOutput } = await exec([
      "aws", "kms", "create-key",
      "--description", "'Pulumi State Encryption Key'",
      "--tags", "TagKey=Purpose,TagValue=PulumiStateEncryption",
      "--region", region,
    ], { silent: true });

    if (!keyCreated) {
      logger.errorSpinner("create-kms", "Failed to create KMS key");
      return null;
    }

    const keyData = JSON.parse(keyOutput);
    const keyId = keyData.KeyMetadata.KeyId;

    logger.updateSpinner("create-kms", `Creating alias "${alias}" for KMS key ${keyId.substring(0, 8)}...`);

    // 2. Create alias for the key
    const aliasName = alias.startsWith("alias/") ? alias.substring(6) : alias;

    const { success: aliasCreated } = await exec([
      "aws", "kms", "create-alias",
      "--alias-name", `alias/${aliasName}`,
      "--target-key-id", keyId,
      "--region", region,
    ], { silent: true });

    if (!aliasCreated) {
      logger.warningSpinner("create-kms", `Created key but failed to create alias. Key ID: ${keyId}`);
      return keyId;
    }

    logger.successSpinner("create-kms", `KMS key and alias "${alias}" created successfully`);
    return alias;
  } catch (error) {
    logger.errorSpinner("create-kms", `Error creating KMS resources: ${(error as Error).message}`);
    return null;
  }
}
