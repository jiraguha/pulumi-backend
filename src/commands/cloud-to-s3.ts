import { parse } from "@std/flags";
import { basename } from "@std/path";
import { Logger, LogLevel } from "../ui/logger.ts";
import { showBanner } from "../ui/banner.ts";
import { SYMBOLS } from "../ui/symbols.ts";
import { bold, dim, green, red, bgGreen, black } from "../ui/colors.ts";
import { createExecuteCommand } from "../exec/command.ts";
import { VERSION } from "../version.ts";
import { runPrerequisiteChecks, checkPulumiProjectExists } from "../checks/prerequisites.ts";
import { checkS3BucketExists, createS3Bucket, checkAndFixS3Permissions } from "../aws/s3.ts";
import { checkKmsAliasExists, createKmsKeyAndAlias } from "../aws/kms.ts";
import { loginToS3BackendWithBucket } from "../pulumi/backend.ts";
import { changeSecretProvider } from "../pulumi/secrets.ts";
import { exportStackState, importStackState, createStackInS3, verifyMigration, deleteSourceStack, cleanUpTempFiles } from "../pulumi/stack.ts";
import { readProjectConfig } from "../pulumi/project.ts";
import type { AppContext, SecretsConfig } from "../types.ts";

function showHelp() {
  showBanner("S3", VERSION, "Migrate Pulumi stacks from Pulumi Cloud to an S3 backend.");

  console.log(`
${bold("USAGE:")}
  pulumi-backend cloudToS3 [OPTIONS]

${bold("REQUIRED OPTIONS:")}
  -s, --stack=<name>        ${dim("Stack name to migrate")}

${bold("BACKEND OPTIONS:")}
  -b, --bucket=<name>       ${dim("S3 bucket name (default: generated from stack name)")}
  -r, --region=<region>     ${dim("AWS region (default: from AWS_REGION or eu-west-3)")}
  --create-bucket           ${dim("Create S3 bucket if it doesn't exist (default: true)")}
  --no-create-bucket        ${dim("Don't create S3 bucket")}

${bold("SECRETS OPTIONS:")}
  --secrets-provider=<type> ${dim("Secrets provider: 'awskms', 'passphrase', 'default' (default: awskms)")}
  -a, --kms-alias=<alias>   ${dim("KMS key alias (default: alias/pulumi-secrets)")}
  -p, --passphrase=<pass>   ${dim("Passphrase for secrets encryption")}
  --create-kms              ${dim("Create KMS key if needed (default: true)")}

${bold("MIGRATION OPTIONS:")}
  -w, --workspace=<path>    ${dim("Path to Pulumi project (default: .)")}
  -d, --delete-source       ${dim("Delete source stack after migration")}
  --skip-verify             ${dim("Skip verification step")}
  --fix-permissions         ${dim("Fix S3 bucket permissions")}

${bold("OUTPUT OPTIONS:")}
  -v, --verbose             ${dim("Enable verbose output")}
  -q, --quiet               ${dim("Minimal output")}
  --no-color                ${dim("Disable colored output")}
  -y, --yes                 ${dim("Answer yes to all prompts")}
  -i, --interactive         ${dim("Enable interactive prompts (default: true)")}

${bold("HELP:")}
  -h, --help                ${dim("Show this help message")}
`);
}

export default async function cloudToS3Command(rawArgs: string[]): Promise<void> {
  const args = parse(rawArgs, {
    string: ["stack", "bucket", "region", "workspace", "encryption-key", "passphrase", "kms-alias", "secrets-provider", "output-format"],
    boolean: ["help", "delete-source", "skip-verify", "verbose", "create-bucket", "create-kms", "quiet", "yes", "no-color", "interactive", "fix-permissions"],
    alias: { h: "help", s: "stack", b: "bucket", r: "region", w: "workspace", d: "delete-source", v: "verbose", k: "encryption-key", p: "passphrase", a: "kms-alias", y: "yes", q: "quiet", i: "interactive", o: "output-format" },
    default: {
      region: Deno.env.get("AWS_REGION") || "eu-west-3",
      workspace: ".",
      "delete-source": false,
      "skip-verify": false,
      "create-bucket": true,
      "create-kms": true,
      "kms-alias": "alias/pulumi-secrets",
      "secrets-provider": "awskms",
      interactive: true,
      "no-color": false,
      verbose: false,
      quiet: false,
    },
  });

  if (args.help || !args.stack) {
    showHelp();
    if (args.help) Deno.exit(0);
    console.error(red("Error: Missing required argument (--stack)"));
    Deno.exit(1);
  }

  const logLevel = args.quiet ? LogLevel.ERROR : args.verbose ? LogLevel.DEBUG : LogLevel.INFO;
  const logger = new Logger({ logLevel, quiet: args.quiet, interactive: args.interactive, yes: args.yes });
  const exec = createExecuteCommand(logger);
  const ctx: AppContext = { logger, exec, args: { verbose: args.verbose, quiet: args.quiet, yes: args.yes, interactive: args.interactive, "no-color": args["no-color"] } };

  showBanner("S3", VERSION, "Migrate Pulumi stacks from Pulumi Cloud to an S3 backend.", args.quiet);

  await runPrerequisiteChecks(ctx);

  const { stack, region, workspace, "delete-source": deleteSource, "skip-verify": skipVerify, "create-bucket": createBucketIfNotExists, "secrets-provider": secretsProvider, passphrase, "kms-alias": kmsAlias, "create-kms": createKmsIfNotExists, "fix-permissions": fixPermissions } = args;
  let { bucket: providedBucket } = args;

  // Migration plan
  logger.section("MIGRATION PLAN");
  logger.info(`Source stack: ${bold(stack)}`);
  if (providedBucket) logger.info(`Target backend: ${bold(`s3://${providedBucket}?region=${region}`)}`);
  logger.info(`Secrets provider: ${bold(secretsProvider)}`);
  logger.info(`Workspace path: ${bold(workspace)}`);

  // Project configuration
  logger.section("PROJECT CONFIGURATION");
  const currentDir = basename(Deno.cwd());
  const defaultProjectName = currentDir.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const projectExists = await checkPulumiProjectExists();

  let projectName: string;
  if (!projectExists) {
    projectName = defaultProjectName;
  } else {
    logger.info("Existing Pulumi project found in current directory");
    projectName = await readProjectConfig(ctx, defaultProjectName);
  }

  let bucket = providedBucket;
  if (!bucket) {
    const suggestedBucketName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (args.interactive) {
      bucket = await logger.prompt("S3 bucket name for state storage", suggestedBucketName);
    } else {
      bucket = suggestedBucketName;
      logger.info(`Using generated bucket name: ${bold(bucket)}`);
    }
  }

  // Infrastructure setup
  logger.section("INFRASTRUCTURE SETUP");

  logger.startSpinner("check-bucket", `Checking if S3 bucket "${bucket}" exists...`);
  const bucketExists = await checkS3BucketExists(ctx, bucket, region);

  if (!bucketExists) {
    logger.warningSpinner("check-bucket", `S3 bucket "${bucket}" doesn't exist`);
    if (createBucketIfNotExists) {
      const bucketCreated = await createS3Bucket(ctx, bucket, region);
      if (!bucketCreated) {
        logger.error("Failed to create S3 bucket.");
        Deno.exit(1);
      }
    } else {
      logger.error(`S3 bucket "${bucket}" doesn't exist and --create-bucket is disabled.`);
      Deno.exit(1);
    }
  } else {
    logger.successSpinner("check-bucket", `S3 bucket "${bucket}" already exists`);
  }

  if (fixPermissions) {
    await checkAndFixS3Permissions(ctx, bucket, region);
  }

  // Handle KMS
  let finalKmsAlias = kmsAlias;
  if (secretsProvider === "awskms") {
    const aliasName = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
    logger.startSpinner("check-kms", `Checking if KMS alias "${aliasName}" exists...`);
    const kmsExists = await checkKmsAliasExists(ctx, aliasName, region);

    if (!kmsExists) {
      logger.warningSpinner("check-kms", `KMS alias "${aliasName}" doesn't exist`);
      if (createKmsIfNotExists) {
        const kmsCreated = await createKmsKeyAndAlias(ctx, aliasName, region);
        if (!kmsCreated) {
          logger.error("Failed to create KMS key and alias.");
          logger.warning("Continuing with default secrets provider...");
          if (passphrase) {
            Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
          }
        } else {
          finalKmsAlias = kmsCreated;
        }
      } else {
        logger.warning(`KMS alias "${aliasName}" doesn't exist and --create-kms is disabled.`);
        if (passphrase) {
          Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
        }
      }
    } else {
      logger.successSpinner("check-kms", `KMS alias "${aliasName}" already exists`);
    }
  } else if (secretsProvider === "passphrase" && passphrase) {
    Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
  }

  // Stack migration
  logger.section("STACK MIGRATION");

  const backendUrl = `s3://${bucket}?region=${region}`;
  logger.info(`Starting migration of stack "${stack}" to backend: ${backendUrl}`);

  const secretsConfig: SecretsConfig = { passphrase, kmsAlias: finalKmsAlias, region };

  await changeSecretProvider(ctx, stack, workspace, secretsProvider, secretsConfig);

  const statePath = await exportStackState(ctx, stack, workspace);
  if (!statePath) {
    logger.error("Failed to export stack state. Migration aborted.");
    Deno.exit(1);
  }

  const s3LoginSuccess = await loginToS3BackendWithBucket(ctx, bucket, region);
  if (!s3LoginSuccess) {
    logger.error("Failed to login to S3 backend. Migration aborted.");
    Deno.exit(1);
  }

  const stackCreateSuccess = await createStackInS3(ctx, stack, workspace, secretsProvider, secretsConfig);
  if (!stackCreateSuccess) {
    logger.error("Failed to create stack in S3. Migration aborted.");
    Deno.exit(1);
  }

  const importSuccess = await importStackState(ctx, stack, statePath, workspace);
  if (!importSuccess) {
    logger.error("Failed to import stack state. Migration aborted.");
    Deno.exit(1);
  }

  // Verify
  if (!skipVerify) {
    const verificationSuccess = await verifyMigration(ctx, stack, workspace);
    if (!verificationSuccess) {
      logger.warning("Migration verification failed. The stack state may not be identical.");
      const proceed = await logger.confirm("Do you want to continue with the migration?", false);
      if (!proceed) {
        logger.error("Migration aborted by user");
        await cleanUpTempFiles(ctx);
        Deno.exit(1);
      }
    } else {
      logger.success("Migration verification successful");
    }
  } else {
    logger.warning("Skipping verification step as requested with --skip-verify flag");
  }

  // Delete source
  if (deleteSource) {
    const shouldDelete = args.yes || await logger.confirm(
      `Are you sure you want to delete the source stack "${stack}" from Pulumi Cloud?`,
      false,
    );
    if (shouldDelete) {
      const deleteSuccess = await deleteSourceStack(ctx, stack, backendUrl, workspace, true);
      if (!deleteSuccess) {
        logger.warning("Failed to delete source stack, but migration was successful");
      }
    } else {
      logger.info("Source stack deletion cancelled by user");
    }
  }

  // Cleanup
  logger.startSpinner("cleanup", "Cleaning up temporary files...");
  await cleanUpTempFiles(ctx);
  logger.successSpinner("cleanup", "Temporary files cleaned up");

  // Success
  let secretsInfo = "";
  if (secretsProvider === "awskms") {
    secretsInfo = `\n   ${SYMBOLS.key} Your stack is using AWS KMS for secrets encryption with key: ${finalKmsAlias}`;
  } else if (secretsProvider === "passphrase") {
    secretsInfo = `\n   ${SYMBOLS.lock} Your stack is using passphrase encryption for secrets. Make sure to set PULUMI_CONFIG_PASSPHRASE in your environment.`;
  }

  const stackName = stack.includes("/") ? stack.split("/")[1] : stack;

  logger.section("MIGRATION COMPLETE");
  logger.success(`Stack "${stack}" successfully migrated to backend: ${backendUrl}`);
  console.log();

  console.log(`${bgGreen(black(" NEXT STEPS "))}

   ${SYMBOLS.bullet} ${bold("Confirm your stack")} is working correctly:
     ${green(`pulumi stack select ${stack.includes("/") ? stackName : stack}`)}

   ${SYMBOLS.bullet} ${bold("Verify your infrastructure")} with:
     ${green("pulumi preview")}

   ${SYMBOLS.bullet} ${bold("Update any CI/CD pipelines")} to use the new backend URL:
     ${green(`pulumi login "${backendUrl}"`)}${secretsInfo}
`);
}
