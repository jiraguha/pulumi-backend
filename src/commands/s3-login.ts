import { parse } from "@std/flags";
import { basename } from "@std/path";
import { Logger, LogLevel } from "../ui/logger.ts";
import { showBanner } from "../ui/banner.ts";
import { SYMBOLS } from "../ui/symbols.ts";
import { bold, bgGreen, black, green } from "../ui/colors.ts";
import { createExecuteCommand } from "../exec/command.ts";
import { VERSION } from "../version.ts";
import { runPrerequisiteChecks } from "../checks/prerequisites.ts";
import { checkPulumiProjectExists } from "../checks/prerequisites.ts";
import { loginToS3Backend } from "../pulumi/backend.ts";
import { readProjectConfig } from "../pulumi/project.ts";
import type { AppContext } from "../types.ts";

function showHelp() {
  showBanner("S3", VERSION, "Auto login pulumi to S3 backend.");

  console.log(`
${bold("USAGE:")}
  pulumi-backend s3Login [OPTIONS]

${bold("OUTPUT OPTIONS:")}
  -v, --verbose             Show verbose output
  -q, --quiet               Minimal output, only errors
  --no-color                Disable colored output
  -y, --yes                 Answer yes to all prompts
  -i, --interactive         Enable interactive prompts (default: true)

${bold("HELP:")}
  -h, --help                Show this help message
`);
}

export default async function s3LoginCommand(rawArgs: string[]): Promise<void> {
  const args = parse(rawArgs, {
    boolean: ["help", "verbose", "quiet", "yes", "no-color", "interactive"],
    alias: { h: "help", v: "verbose", y: "yes", q: "quiet", i: "interactive" },
    default: { interactive: true, "no-color": false, verbose: false, quiet: false },
  });

  if (args.help) {
    showHelp();
    Deno.exit(0);
  }

  const logLevel = args.quiet ? LogLevel.ERROR : args.verbose ? LogLevel.DEBUG : LogLevel.INFO;
  const logger = new Logger({ logLevel, quiet: args.quiet, interactive: args.interactive, yes: args.yes });
  const exec = createExecuteCommand(logger);
  const ctx: AppContext = { logger, exec, args: { verbose: args.verbose, quiet: args.quiet, yes: args.yes, interactive: args.interactive, "no-color": args["no-color"] } };

  showBanner("S3", VERSION, "Auto login pulumi to S3 backend.", args.quiet);

  await runPrerequisiteChecks(ctx);

  // Selecting backend
  logger.section("SELECTING BACKEND");

  const currentDir = basename(Deno.cwd());
  const defaultProjectName = currentDir.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const defaultRegion = Deno.env.get("AWS_REGION") || "eu-west-3";

  let projectName: string;
  const projectExists = await checkPulumiProjectExists();

  if (!projectExists) {
    projectName = defaultProjectName;
  } else {
    logger.info("Existing Pulumi project found in current directory");
    projectName = await readProjectConfig(ctx, defaultProjectName);
  }

  let backend: string;
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
    backend = `s3://${bucketName}?region=${region}`;
  } else {
    backend = `s3://${suggestedBucketName}`;
    logger.info(`Using generated bucket name: ${bold(suggestedBucketName)}`);
  }

  // Login
  logger.section("LOGIN BACKEND");

  const s3LoginSuccess = await loginToS3Backend(ctx, backend);
  if (!s3LoginSuccess) {
    logger.error("Failed to login to S3 backend.");
    logger.info("Check your AWS credentials and the S3 backend URL.");
    Deno.exit(1);
  }

  console.log(`${bgGreen(black(" NEXT STEPS "))}
   ${SYMBOLS.bullet} ${bold("Confirm your stack")} is working correctly:
     ${green("pulumi stack ls")}
  `);
}
