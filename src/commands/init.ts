import { parse } from "@std/flags";
import { basename } from "@std/path";
import { Logger, LogLevel } from "../ui/logger.ts";
import { showBanner } from "../ui/banner.ts";
import { SYMBOLS } from "../ui/symbols.ts";
import { bold, dim, green, bgGreen, black } from "../ui/colors.ts";
import { createExecuteCommand } from "../exec/command.ts";
import { VERSION } from "../version.ts";
import { runPrerequisiteChecks, checkPulumiProjectExists } from "../checks/prerequisites.ts";
import { checkS3BucketExists, createS3Bucket, checkAndFixS3Permissions } from "../aws/s3.ts";
import { checkKmsAliasExists, createKmsKeyAndAlias } from "../aws/kms.ts";
import { loginToS3BackendWithBucket } from "../pulumi/backend.ts";
import { createStack } from "../pulumi/stack.ts";
import { initPulumiProject, readProjectConfig } from "../pulumi/project.ts";
import type { AppContext, SecretsConfig } from "../types.ts";

function showHelp() {
  showBanner("S3", VERSION, "Set up Pulumi projects with an S3 backend.");

  console.log(`
${bold("USAGE:")}
  pulumi-backend init [OPTIONS]

${bold("PROJECT OPTIONS:")}
  -n, --name=<name>        ${dim("Project name (default: current directory name)")}
  -d, --description=<desc> ${dim("Project description")}
  -t, --template=<temp>    ${dim("Pulumi template (default: typescript)")}
  -s, --stack=<name>       ${dim("Initial stack name (default: dev)")}

${bold("BACKEND OPTIONS:")}
  -b, --bucket=<name>      ${dim("S3 bucket name (default: derived from project name)")}
  -r, --region=<region>    ${dim("AWS region (default: from AWS_REGION or eu-west-3)")}
  --create-bucket          ${dim("Create S3 bucket if needed (default: true)")}

${bold("SECRETS OPTIONS:")}
  --secrets-provider=<type> ${dim("Secrets provider: 'awskms', 'passphrase', 'default' (default: awskms)")}
  -a, --kms-alias=<alias>   ${dim("KMS key alias (default: alias/pulumi-secrets)")}
  -p, --passphrase=<pass>   ${dim("Passphrase for secrets encryption")}
  --create-kms              ${dim("Create KMS key if needed (default: true)")}

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

export default async function initCommand(rawArgs: string[]): Promise<void> {
  const args = parse(rawArgs, {
    string: ["name", "description", "bucket", "region", "runtime", "template", "stack", "kms-alias", "secrets-provider", "passphrase", "output-format"],
    boolean: ["help", "verbose", "create-bucket", "create-kms", "quiet", "yes", "no-color", "interactive"],
    alias: { h: "help", n: "name", b: "bucket", r: "region", d: "description", t: "template", s: "stack", p: "passphrase", a: "kms-alias", y: "yes", q: "quiet", i: "interactive", o: "output-format", v: "verbose" },
    default: {
      region: Deno.env.get("AWS_REGION") || "eu-west-3",
      runtime: "typescript",
      stack: "dev",
      "create-bucket": true,
      "create-kms": true,
      "secrets-provider": "awskms",
      "kms-alias": "alias/pulumi-secrets",
      interactive: true,
      "no-color": false,
      verbose: false,
      quiet: false,
    },
  });

  if (args.help) {
    showHelp();
    Deno.exit(0);
  }

  const logLevel = args.quiet ? LogLevel.ERROR : args.verbose ? LogLevel.DEBUG : LogLevel.INFO;
  const logger = new Logger({ logLevel, quiet: args.quiet, interactive: args.interactive, yes: args.yes });
  const exec = createExecuteCommand(logger);
  const ctx: AppContext = { logger, exec, args: { verbose: args.verbose, quiet: args.quiet, yes: args.yes, interactive: args.interactive, "no-color": args["no-color"] } };

  showBanner("S3", VERSION, "Set up Pulumi projects with an S3 backend.", args.quiet);

  await runPrerequisiteChecks(ctx);

  // Project configuration
  logger.section("PROJECT CONFIGURATION");

  const currentDir = basename(Deno.cwd());
  const defaultProjectName = currentDir.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const projectExists = await checkPulumiProjectExists();

  let projectName = args.name || "";
  let projectDescription = args.description || "";
  let projectTemplate = args.runtime || "typescript";
  let stackName = args.stack || "dev";
  let bucketName = args.bucket || "";
  let region = args.region || "eu-west-3";
  let secretsProvider = args["secrets-provider"] || "awskms";
  let kmsAlias = args["kms-alias"] || "alias/pulumi-secrets";
  let passphrase = args.passphrase || "";

  if (!projectExists) {
    if (!projectName && args.interactive) {
      projectName = await logger.prompt("Project name", defaultProjectName);
    } else if (!projectName) {
      projectName = defaultProjectName;
    }

    if (!projectDescription && args.interactive) {
      projectDescription = await logger.prompt("Project description", "");
    }

    if (args.interactive) {
      const templates = ["typescript", "python", "go", "csharp", "nodejs"];
      projectTemplate = await logger.select("Select project template", templates, templates.indexOf(projectTemplate));
    }
  } else {
    logger.info("Existing Pulumi project found in current directory");
    projectName = await readProjectConfig(ctx, projectName || defaultProjectName);
  }

  if (args.interactive) {
    stackName = await logger.prompt("Stack name", stackName);
  }

  // Backend configuration
  logger.section("BACKEND CONFIGURATION");

  if (!bucketName) {
    const suggestedBucketName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (args.interactive) {
      bucketName = await logger.prompt("S3 bucket name for state storage", suggestedBucketName);
    } else {
      bucketName = suggestedBucketName;
      logger.info(`Using generated bucket name: ${bold(bucketName)}`);
    }
  }

  if (args.interactive) {
    const regions = [
      "us-east-1", "us-east-2", "us-west-1", "us-west-2",
      "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1",
      "ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2",
    ];
    region = await logger.select("Select AWS region", regions, regions.indexOf(region) !== -1 ? regions.indexOf(region) : 0);
  }

  if (args.interactive) {
    secretsProvider = await logger.select("Select secrets provider", ["awskms", "passphrase", "default"], ["awskms", "passphrase", "default"].indexOf(secretsProvider));

    if (secretsProvider === "awskms") {
      kmsAlias = await logger.prompt("KMS alias for secrets", kmsAlias);
    } else if (secretsProvider === "passphrase") {
      passphrase = await logger.prompt("Passphrase for secrets", "");
      if (passphrase) Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
    }
  }

  // Infrastructure setup
  logger.section("INFRASTRUCTURE SETUP");

  logger.startSpinner("check-bucket", `Checking if S3 bucket "${bucketName}" exists...`);
  const bucketExists = await checkS3BucketExists(ctx, bucketName, region);

  if (!bucketExists) {
    logger.warningSpinner("check-bucket", `S3 bucket "${bucketName}" doesn't exist`);
    if (args["create-bucket"]) {
      const bucketCreated = await createS3Bucket(ctx, bucketName, region);
      if (!bucketCreated) {
        logger.error("Failed to create S3 bucket.");
        Deno.exit(1);
      }
      await checkAndFixS3Permissions(ctx, bucketName, region);
    } else {
      logger.error(`S3 bucket "${bucketName}" doesn't exist and --create-bucket is disabled.`);
      Deno.exit(1);
    }
  } else {
    logger.successSpinner("check-bucket", `S3 bucket "${bucketName}" already exists`);
    await checkAndFixS3Permissions(ctx, bucketName, region);
  }

  // Handle KMS
  let finalKmsAlias = kmsAlias;
  if (secretsProvider === "awskms") {
    const aliasName = kmsAlias.startsWith("alias/") ? kmsAlias : `alias/${kmsAlias}`;
    logger.startSpinner("check-kms", `Checking if KMS alias "${aliasName}" exists...`);
    const kmsExists = await checkKmsAliasExists(ctx, aliasName, region);

    if (!kmsExists) {
      logger.warningSpinner("check-kms", `KMS alias "${aliasName}" doesn't exist`);
      if (args["create-kms"]) {
        const kmsCreated = await createKmsKeyAndAlias(ctx, aliasName, region);
        if (!kmsCreated) {
          logger.error("Failed to create KMS key and alias.");
          logger.warning("Continuing with default secrets provider...");
          secretsProvider = "default";
        } else {
          finalKmsAlias = kmsCreated;
        }
      } else {
        logger.warning(`KMS alias "${aliasName}" doesn't exist and --create-kms is disabled.`);
        logger.warning("Falling back to default secrets provider...");
        secretsProvider = "default";
      }
    } else {
      logger.successSpinner("check-kms", `KMS alias "${aliasName}" already exists`);
    }
  } else if (secretsProvider === "passphrase" && passphrase) {
    Deno.env.set("PULUMI_CONFIG_PASSPHRASE", passphrase);
  }

  // Project initialization
  logger.section("PROJECT INITIALIZATION");

  const backendUrl = `s3://${bucketName}?region=${region}`;
  const s3LoginSuccess = await loginToS3BackendWithBucket(ctx, bucketName, region);
  if (!s3LoginSuccess) {
    logger.error("Failed to configure S3 backend. Initialization aborted.");
    Deno.exit(1);
  }

  if (!projectExists) {
    const projectInitialized = await initPulumiProject(ctx, projectName, projectDescription, projectTemplate);
    if (!projectInitialized) {
      logger.error("Failed to initialize Pulumi project. Initialization aborted.");
      Deno.exit(1);
    }
  }

  const secretsConfig: SecretsConfig = { passphrase, kmsAlias: finalKmsAlias, region };
  const stackCreated = await createStack(ctx, stackName, secretsProvider, secretsConfig);
  if (!stackCreated) {
    logger.error("Failed to create Pulumi stack. Initialization aborted.");
    Deno.exit(1);
  }

  // Success
  logger.section("INITIALIZATION COMPLETE");
  logger.success(`Project "${projectName}" initialized with S3 backend: ${backendUrl}`);
  console.log();

  let secretsInfo = "";
  if (secretsProvider === "awskms") {
    secretsInfo = `\n   ${SYMBOLS.key} Your stack is using AWS KMS for secrets encryption with key: ${finalKmsAlias}`;
  } else if (secretsProvider === "passphrase") {
    secretsInfo = `\n   ${SYMBOLS.lock} Your stack is using passphrase encryption for secrets. Make sure to set PULUMI_CONFIG_PASSPHRASE in your environment.`;
  }

  console.log(`${bgGreen(black(" NEXT STEPS "))}

   ${SYMBOLS.bullet} ${bold("Edit your Pulumi program")} in the project directory

   ${SYMBOLS.bullet} ${bold("Run a preview")} to see the resources that would be created:
     ${green("pulumi preview")}

   ${SYMBOLS.bullet} ${bold("Deploy your infrastructure")} with:
     ${green("pulumi up")}

   ${SYMBOLS.bullet} ${bold("For CI/CD pipelines")}, use the backend URL:
     ${green(`pulumi login "${backendUrl}"`)}${secretsInfo}
`);
}
