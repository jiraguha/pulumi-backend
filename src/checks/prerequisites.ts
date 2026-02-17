import type { AppContext } from "../types.ts";

export async function checkPulumiInstalled(ctx: AppContext): Promise<boolean> {
  try {
    const { output, success } = await ctx.exec(["pulumi", "version"], { silent: true });
    if (success && ctx.args.verbose) {
      ctx.logger.debug(`Pulumi version: ${output}`);
    }
    return success;
  } catch {
    return false;
  }
}

export async function checkAwsConfiguration(ctx: AppContext): Promise<boolean> {
  try {
    const { success, output } = await ctx.exec(
      ["aws", "sts", "get-caller-identity"],
      { silent: true },
    );
    if (success && ctx.args.verbose) {
      ctx.logger.debug(`AWS identity: ${output}`);
    }
    return success;
  } catch {
    return false;
  }
}

export async function checkPulumiProjectExists(): Promise<boolean> {
  try {
    await Deno.stat("Pulumi.yaml");
    return true;
  } catch {
    return false;
  }
}

export async function runPrerequisiteChecks(ctx: AppContext): Promise<void> {
  const { logger } = ctx;

  logger.section("PREREQUISITES");

  // Check Pulumi CLI
  logger.startSpinner("check-pulumi", "Checking Pulumi CLI installation...");
  const pulumiInstalled = await checkPulumiInstalled(ctx);

  if (!pulumiInstalled) {
    logger.errorSpinner("check-pulumi", "Pulumi CLI is not installed or not in PATH");
    logger.info("Please install Pulumi CLI: https://www.pulumi.com/docs/install/");
    Deno.exit(1);
  } else {
    logger.successSpinner("check-pulumi", "Pulumi CLI is installed and working");
  }

  // Check AWS credentials
  logger.startSpinner("check-aws", "Checking AWS credentials...");
  const awsConfigured = await checkAwsConfiguration(ctx);
  if (!awsConfigured) {
    logger.warningSpinner("check-aws", "AWS credentials are not properly configured");
    logger.info("This might cause issues when accessing AWS resources. Make sure AWS credentials are set up correctly.");

    const proceed = await logger.confirm("Do you want to continue anyway?", false);
    if (!proceed) {
      logger.error("Aborted.");
      Deno.exit(1);
    }
  } else {
    logger.successSpinner("check-aws", "AWS credentials are properly configured");
  }
}
