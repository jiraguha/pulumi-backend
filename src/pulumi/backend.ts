import type { AppContext } from "../types.ts";

export async function loginToS3Backend(
  ctx: AppContext,
  backendUrl: string,
): Promise<boolean> {
  const { logger, exec } = ctx;
  logger.startSpinner("s3-login", "Logging into S3 backend...");

  await exec(["pulumi", "logout"], { silent: true });

  logger.updateSpinner("s3-login", `Logging into backend: ${backendUrl}...`);

  const { success, output } = await exec(
    ["pulumi", "login", backendUrl],
    { silent: true },
  );

  if (!success) {
    logger.errorSpinner("s3-login", `Failed to login to S3 backend: ${output}`);
    return false;
  }

  logger.successSpinner("s3-login", `Successfully logged into S3 backend`);
  return true;
}

export async function loginToS3BackendWithBucket(
  ctx: AppContext,
  bucket: string,
  region: string,
): Promise<boolean> {
  const loginUrl = `s3://${bucket}?region=${region}`;
  return loginToS3Backend(ctx, loginUrl);
}

export async function loginToPulumiCloud(
  ctx: AppContext,
  accessToken?: string,
): Promise<boolean> {
  const { logger, exec } = ctx;
  logger.startSpinner("cloud-login", "Logging into Pulumi Cloud...");

  await exec(["pulumi", "logout"], { silent: true });

  const loginCommand = ["pulumi", "login"];
  const env: Record<string, string> = {};

  if (accessToken) {
    env.PULUMI_ACCESS_TOKEN = accessToken;
    logger.debug("Using provided access token for Pulumi Cloud login");
  }

  const { success, output } = await exec(loginCommand, { silent: true, env });

  if (!success) {
    logger.errorSpinner("cloud-login", `Failed to login to Pulumi Cloud: ${output}`);
    return false;
  }

  // Verify login
  const { success: whoamiSuccess, output: whoamiOutput } = await exec(
    ["pulumi", "whoami"],
    { silent: true },
  );

  if (!whoamiSuccess) {
    logger.errorSpinner("cloud-login", `Failed to verify Pulumi Cloud login: ${whoamiOutput}`);
    return false;
  }

  logger.successSpinner("cloud-login", `Successfully logged into Pulumi Cloud as ${whoamiOutput}`);
  return true;
}

export function parseS3BackendUrl(backendUrl: string, fallbackRegion: string): {
  bucket: string;
  region: string;
} {
  if (!backendUrl.startsWith("s3://")) {
    throw new Error("Backend URL must start with s3://");
  }

  const urlWithoutProtocol = backendUrl.substring(5);
  const [bucket, queryString] = urlWithoutProtocol.split("?");

  if (!bucket) {
    throw new Error("No bucket specified in S3 backend URL");
  }

  const params = new URLSearchParams(queryString || "");
  const region = params.get("region") || fallbackRegion;

  return { bucket, region };
}
