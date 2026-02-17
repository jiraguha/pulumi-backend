import { parse } from "@std/flags";
import { basename } from "@std/path";
import { Logger, LogLevel } from "../ui/logger.ts";
import { showBanner } from "../ui/banner.ts";
import { SYMBOLS } from "../ui/symbols.ts";
import { bold, dim, green, red, bgGreen, black } from "../ui/colors.ts";
import { createExecuteCommand } from "../exec/command.ts";
import { VERSION } from "../version.ts";
import { runPrerequisiteChecks, checkPulumiProjectExists } from "../checks/prerequisites.ts";
import { loginToS3Backend, loginToPulumiCloud, parseS3BackendUrl } from "../pulumi/backend.ts";
import { changeSecretsProviderToDefault } from "../pulumi/secrets.ts";
import { exportStackState, importStackState, createStackInPulumiCloud, verifyMigration, deleteSourceStack, cleanUpTempFiles } from "../pulumi/stack.ts";
import { readProjectConfig } from "../pulumi/project.ts";
import type { AppContext } from "../types.ts";

function showHelp() {
  showBanner("CLOUD", VERSION, "Migrate Pulumi stacks from S3 backend to Pulumi Cloud.");

  console.log(`
${bold("USAGE:")}
  pulumi-backend s3ToCloud [OPTIONS]

${bold("REQUIRED OPTIONS:")}
  -s, --stack=<name>        ${dim("Stack name to migrate")}
  -g, --organization=<org>  ${dim("Pulumi Cloud organization")}

${bold("BACKEND OPTIONS:")}
  -b, --backend=<url>       ${dim("S3 backend URL (e.g., s3://my-bucket?region=us-west-2)")}

${bold("PULUMI CLOUD OPTIONS:")}
  -t, --access-token=<token>${dim("Pulumi access token")}

${bold("SECRETS OPTIONS:")}
  --secrets-provider=<type> ${dim("Target secrets provider: 'service' (default), 'passphrase', 'awskms'")}
  -p, --passphrase=<pass>   ${dim("Source passphrase for decrypting secrets")}
  -k, --kms-key=<keyid>     ${dim("Source KMS key for decrypting secrets")}

${bold("MIGRATION OPTIONS:")}
  -w, --workspace=<path>    ${dim("Path to Pulumi project (default: .)")}
  -d, --delete-source       ${dim("Delete source stack after migration")}
  --skip-verify             ${dim("Skip verification step")}

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

export default async function s3ToCloudCommand(rawArgs: string[]): Promise<void> {
  const defaultRegion = Deno.env.get("AWS_REGION") || "eu-west-3";

  const args = parse(rawArgs, {
    string: ["stack", "backend", "region", "workspace", "passphrase", "kms-key", "secrets-provider", "output-format", "organization", "access-token"],
    boolean: ["help", "delete-source", "skip-verify", "verbose", "quiet", "yes", "no-color", "interactive"],
    alias: { h: "help", s: "stack", b: "backend", r: "region", w: "workspace", d: "delete-source", v: "verbose", p: "passphrase", k: "kms-key", y: "yes", q: "quiet", i: "interactive", o: "output-format", t: "access-token", g: "organization" },
    default: {
      region: Deno.env.get("AWS_REGION") || "us-west-2",
      workspace: ".",
      "delete-source": false,
      "skip-verify": false,
      interactive: true,
      "no-color": false,
      "secrets-provider": "service",
      verbose: false,
      quiet: false,
    },
  });

  if (args.help || !args.stack || !args.organization) {
    showHelp();
    if (args.help) Deno.exit(0);
    console.error(red("Error: Missing required arguments (--stack and --organization)"));
    Deno.exit(1);
  }

  const logLevel = args.quiet ? LogLevel.ERROR : args.verbose ? LogLevel.DEBUG : LogLevel.INFO;
  const logger = new Logger({ logLevel, quiet: args.quiet, interactive: args.interactive, yes: args.yes });
  const exec = createExecuteCommand(logger);
  const ctx: AppContext = { logger, exec, args: { verbose: args.verbose, quiet: args.quiet, yes: args.yes, interactive: args.interactive, "no-color": args["no-color"] } };

  showBanner("CLOUD", VERSION, "Migrate Pulumi stacks from S3 backend to Pulumi Cloud.", args.quiet);

  await runPrerequisiteChecks(ctx);

  const { stack, workspace, "delete-source": deleteSource, "skip-verify": skipVerify, passphrase, organization, "access-token": accessToken } = args;
  let backend = args.backend;

  // Migration plan
  logger.section("MIGRATION PLAN");
  if (backend) {
    parseS3BackendUrl(backend, args.region);
    logger.info(`Source backend: ${bold(backend)}`);
  }
  logger.info(`Source stack: ${bold(stack)}`);
  logger.info(`Target backend: ${bold("Pulumi Cloud")}`);
  logger.info(`Target organization: ${bold(organization || "Default")}`);
  logger.info(`Workspace path: ${bold(workspace)}`);

  // Selecting backend
  logger.section("SELECTING BACKEND");
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

  if (!backend) {
    const suggestedBucketName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    if (args.interactive) {
      const bucketName = await logger.prompt("S3 bucket name for state storage", suggestedBucketName);
      const regions = [
        "us-east-1", "us-east-2", "us-west-1", "us-west-2",
        "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1",
        "ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2",
      ];
      const region = await logger.select(
        "Select AWS region",
        regions,
        regions.indexOf(defaultRegion) !== -1 ? regions.indexOf(defaultRegion) : 0,
      );
      backend = `s3://${bucketName}\\?region=${region}`;
    } else {
      backend = `s3://${suggestedBucketName}`;
      logger.info(`Using generated bucket name: ${bold(suggestedBucketName)}`);
    }
  }

  // Source backend
  logger.section("SOURCE BACKEND");

  const s3LoginSuccess = await loginToS3Backend(ctx, backend);
  if (!s3LoginSuccess) {
    logger.error("Failed to login to S3 backend. Migration aborted.");
    logger.info("Check your AWS credentials and the S3 backend URL.");
    Deno.exit(1);
  }

  const env: Record<string, string> = {};
  if (passphrase) env.PULUMI_CONFIG_PASSPHRASE = passphrase;

  const statePath = await exportStackState(ctx, stack, workspace, env);
  if (!statePath) {
    logger.error("Failed to export stack state. Migration aborted.");
    logger.info(`Make sure the stack "${stack}" exists and you have access to it.`);
    if (!passphrase && !args["kms-key"]) {
      logger.info("If the stack uses encrypted secrets, try providing --passphrase or --kms-key.");
    }
    Deno.exit(1);
  }

  // Target backend
  logger.section("TARGET BACKEND");

  const cloudLoginSuccess = await loginToPulumiCloud(ctx, accessToken);
  if (!cloudLoginSuccess) {
    logger.error("Failed to login to Pulumi Cloud. Migration aborted.");
    if (accessToken) {
      logger.info("Check that your access token is valid.");
    } else {
      logger.info("You might need to login first with 'pulumi login' or provide an access token.");
    }
    Deno.exit(1);
  }

  const stackCreateSuccess = await createStackInPulumiCloud(ctx, stack, workspace, organization);
  if (!stackCreateSuccess) {
    logger.error("Failed to create stack in Pulumi Cloud. Migration aborted.");
    Deno.exit(1);
  }

  const importSuccess = await importStackState(ctx, stack, statePath, workspace);
  if (!importSuccess) {
    logger.error("Failed to import stack state. Migration aborted.");
    Deno.exit(1);
  }

  // Change secrets provider to default
  const changeSecretsSuccess = await changeSecretsProviderToDefault(ctx, stack, workspace, organization);
  if (!changeSecretsSuccess) {
    logger.error("Failed to change secrets provider to default. Migration may be incomplete.");
    const proceed = await logger.confirm("Do you want to continue with the migration anyway?", false);
    if (!proceed) {
      logger.error("Migration aborted by user");
      await cleanUpTempFiles(ctx, ".pulumi-cloud-migrate-temp");
      Deno.exit(1);
    }
  }

  // Verify
  if (!skipVerify) {
    logger.section("VERIFICATION");
    const verificationSuccess = await verifyMigration(ctx, stack, workspace, organization);
    if (!verificationSuccess) {
      logger.warning("Migration verification failed. The stack state may not be identical.");
      const proceed = await logger.confirm("Do you want to continue with the migration?", false);
      if (!proceed) {
        logger.error("Migration aborted by user");
        await cleanUpTempFiles(ctx, ".pulumi-cloud-migrate-temp");
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
    logger.section("CLEANUP");
    const shouldDelete = args.yes || await logger.confirm(
      `Are you sure you want to delete the source stack "${stack}" from the S3 backend?`,
      false,
    );
    if (shouldDelete) {
      const deleteSuccess = await deleteSourceStack(ctx, stack, backend, workspace, false);
      if (!deleteSuccess) {
        logger.warning("Failed to delete source stack, but migration was successful");
      }
    } else {
      logger.info("Source stack deletion cancelled by user");
    }
  }

  // Clean up
  logger.startSpinner("cleanup", "Cleaning up temporary files...");
  await cleanUpTempFiles(ctx, ".pulumi-cloud-migrate-temp");
  logger.successSpinner("cleanup", "Temporary files cleaned up");

  // Success
  logger.section("MIGRATION COMPLETE");
  const orgFromStack = stack.includes("/") ? stack.split("/")[0] : null;
  const stackName = stack.includes("/") ? stack.split("/")[1] : stack;
  const targetOrg = organization || orgFromStack;
  const targetStack = targetOrg ? `${targetOrg}/${stackName}` : stackName;

  logger.success(`Stack "${stack}" successfully migrated to Pulumi Cloud as "${targetStack}"`);
  console.log();

  console.log(`${bgGreen(black(" NEXT STEPS "))}

   ${SYMBOLS.bullet} ${bold("Confirm your stack")} is working correctly:
     ${green(`pulumi stack select ${targetStack}`)}

   ${SYMBOLS.bullet} ${bold("Verify your infrastructure")} with:
     ${green("pulumi preview")}

   ${SYMBOLS.bullet} ${bold("Update any CI/CD pipelines")} to use Pulumi Cloud:
     ${green("pulumi login")}${targetOrg ? `\n     ${green(`pulumi stack select ${targetOrg}/${stackName}`)}` : ""}
`);
}
