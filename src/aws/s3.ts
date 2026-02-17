import type { AppContext } from "../types.ts";
import { getCurrentAwsIdentity } from "./identity.ts";

export async function checkS3BucketExists(
  ctx: AppContext,
  bucket: string,
  region: string,
): Promise<boolean> {
  try {
    const { success } = await ctx.exec(
      ["aws", "s3api", "head-bucket", "--bucket", bucket, "--region", region],
      { silent: true },
    );
    return success;
  } catch {
    return false;
  }
}

export async function createS3Bucket(
  ctx: AppContext,
  bucket: string,
  region: string,
): Promise<boolean> {
  const { logger, exec } = ctx;
  logger.startSpinner("create-bucket", `Creating S3 bucket "${bucket}" in ${region} for Pulumi state...`);

  try {
    // 1. Create S3 bucket
    const createBucketCmd = ["aws", "s3api", "create-bucket", "--bucket", bucket, "--region", region];
    if (region !== "us-east-1") {
      createBucketCmd.push("--create-bucket-configuration", `LocationConstraint=${region}`);
    }

    const { success: bucketCreated } = await exec(createBucketCmd, { silent: true });
    if (!bucketCreated) {
      logger.errorSpinner("create-bucket", `Failed to create S3 bucket "${bucket}"`);
      return false;
    }

    logger.updateSpinner("create-bucket", `Configuring S3 bucket "${bucket}" for optimal settings...`);

    // 2. Enable versioning
    const { success: versioningEnabled } = await exec([
      "aws", "s3api", "put-bucket-versioning",
      "--bucket", bucket,
      "--versioning-configuration", "Status=Enabled",
      "--region", region,
    ], { silent: true });

    if (!versioningEnabled) {
      logger.warningSpinner("create-bucket", `Created bucket but failed to enable versioning for "${bucket}"`);
      return true;
    }

    // 3. Enable default encryption
    const { success: encryptionEnabled } = await exec([
      "aws", "s3api", "put-bucket-encryption",
      "--bucket", bucket,
      "--server-side-encryption-configuration",
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}',
      "--region", region,
    ], { silent: true });

    if (!encryptionEnabled) {
      logger.warningSpinner("create-bucket", `Created bucket but failed to enable encryption for "${bucket}"`);
      return true;
    }

    // 4. Add lifecycle policy
    const { success: lifecycleAdded } = await exec([
      "aws", "s3api", "put-bucket-lifecycle-configuration",
      "--bucket", bucket,
      "--lifecycle-configuration",
      '{"Rules":[{"ID":"ExpireOldVersions","Status":"Enabled","NoncurrentVersionExpiration":{"NoncurrentDays":90}}]}',
      "--region", region,
    ], { silent: true });

    if (!lifecycleAdded) {
      logger.warningSpinner("create-bucket", `Created bucket but failed to add lifecycle policy for "${bucket}"`);
      return true;
    }

    logger.successSpinner("create-bucket", `S3 bucket "${bucket}" created and configured for Pulumi state`);
    return true;
  } catch (error) {
    logger.errorSpinner("create-bucket", `Failed to create S3 bucket: ${(error as Error).message}`);
    return false;
  }
}

export async function checkAndFixS3Permissions(
  ctx: AppContext,
  bucket: string,
  region: string,
): Promise<boolean> {
  const { logger, exec } = ctx;
  logger.startSpinner("fix-perms", `Checking S3 bucket permissions for "${bucket}"...`);

  const currentIdentity = await getCurrentAwsIdentity(ctx);
  if (!currentIdentity) {
    logger.errorSpinner("fix-perms", "Unable to determine your AWS identity. Please ensure you have the necessary permissions.");
    return false;
  }

  logger.debug(`Current AWS identity: ${currentIdentity}`);

  // Get the current bucket policy, if any
  const { success: getPolicySuccess, output: policyOutput } = await exec(
    ["aws", "s3api", "get-bucket-policy", "--bucket", bucket, "--region", region, "--output", "json"],
    { silent: true },
  );

  let currentPolicy: { Statement?: Array<{ Sid?: string; Effect?: string; Principal?: unknown }> } = {};
  let hasDenyPolicy = false;

  if (getPolicySuccess && policyOutput) {
    try {
      const policyString = JSON.parse(policyOutput).Policy;
      currentPolicy = JSON.parse(policyString);

      if (currentPolicy.Statement) {
        hasDenyPolicy = currentPolicy.Statement.some(
          // deno-lint-ignore no-explicit-any
          (statement: any) =>
            statement.Effect === "Deny" &&
            (statement.Principal === "*" ||
              (statement.Principal?.AWS &&
                (statement.Principal.AWS === "*" || statement.Principal.AWS.includes(currentIdentity)))),
        );
      }
    } catch (error) {
      logger.debug(`Error parsing bucket policy: ${(error as Error).message}`);
    }
  }

  logger.updateSpinner("fix-perms", "Updating bucket policy to ensure access for your AWS user...");

  const newPolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowPulumiStateAccess",
        Effect: "Allow",
        Principal: { AWS: currentIdentity },
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
        Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
      },
    ],
  };

  // Merge with existing policy
  if (currentPolicy.Statement) {
    currentPolicy.Statement = currentPolicy.Statement.filter(
      // deno-lint-ignore no-explicit-any
      (statement: any) => statement.Sid !== "AllowPulumiStateAccess",
    );
    currentPolicy.Statement.push(newPolicy.Statement[0]);
    newPolicy.Statement = currentPolicy.Statement as typeof newPolicy.Statement;
  }

  const policyString = JSON.stringify(newPolicy);
  const { success: putPolicySuccess } = await exec(
    ["aws", "s3api", "put-bucket-policy", "--bucket", bucket, "--policy", policyString, "--region", region],
    { silent: true },
  );

  if (!putPolicySuccess) {
    logger.warningSpinner("fix-perms", "Failed to update bucket policy. You may need to update it manually.");
    logger.info("Ensure your AWS user has permissions: s3:GetObject, s3:PutObject, s3:DeleteObject, s3:ListBucket");
    return false;
  }

  logger.successSpinner("fix-perms", "Updated bucket policy to ensure your AWS user can access Pulumi state");

  if (hasDenyPolicy) {
    logger.startSpinner("propagate", "Waiting for permissions to propagate...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    logger.successSpinner("propagate", "Permissions should be active now");
  }

  return true;
}
