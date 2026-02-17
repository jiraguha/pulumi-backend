import { bold, dim, green, cyan, red, bgBlue, bgCyan, bgGreen, black } from "./ui/colors.ts";
import { VERSION } from "./version.ts";

function showHelp(): void {
  console.log(`
${bgBlue(black(" PULUMI "))}${bgCyan(black(" BACKEND "))}${bgGreen(black(" MANAGEMENT "))} ${cyan(`v${VERSION}`)}

${dim("A unified tool for managing Pulumi backends and migrations")}

${bold("USAGE:")}
  pulumi-backend <command> [options]

${bold("COMMANDS:")}
  cloudToS3    ${dim("Migrate from Pulumi Cloud to an S3 backend")}
  s3ToCloud    ${dim("Migrate from an S3 backend to Pulumi Cloud")}
  init         ${dim("Initialize a new Pulumi project with an S3 backend")}
  s3Login      ${dim("Auto login pulumi to S3 backend")}
  self-update  ${dim("Update the Pulumi Backend Management Tool to the latest version")}
  help         ${dim("Show this help information")}

${bold("EXAMPLES:")}
  ${green("# Migrate from Pulumi Cloud to S3")}
  pulumi-backend cloudToS3 --stack=mystack --bucket=my-bucket --region=us-west-2

  ${green("# Migrate from S3 to Pulumi Cloud")}
  pulumi-backend s3ToCloud --stack=mystack --backend=s3://my-bucket?region=us-west-2

  ${green("# Initialize a new project with S3 backend")}
  pulumi-backend init --name=my-project --bucket=my-pulumi-state

  ${green("# Auto login pulumi to S3 backend")}
  pulumi-backend s3Login

  ${green("# Update the tool to the latest version")}
  pulumi-backend self-update

${bold("OPTIONS:")}
  For command-specific options, run:
  pulumi-backend <command> --help
`);
}

export async function run(args: string[]): Promise<void> {
  const command = args[0];
  const commandArgs = args.slice(1);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    Deno.exit(0);
  }

  switch (command) {
    case "cloudToS3": {
      const { default: cloudToS3 } = await import("./commands/cloud-to-s3.ts");
      await cloudToS3(commandArgs);
      break;
    }
    case "s3ToCloud": {
      const { default: s3ToCloud } = await import("./commands/s3-to-cloud.ts");
      await s3ToCloud(commandArgs);
      break;
    }
    case "init": {
      const { default: init } = await import("./commands/init.ts");
      await init(commandArgs);
      break;
    }
    case "s3Login": {
      const { default: s3Login } = await import("./commands/s3-login.ts");
      await s3Login(commandArgs);
      break;
    }
    case "self-update": {
      const { default: selfUpdate } = await import("./commands/self-update.ts");
      await selfUpdate(commandArgs);
      break;
    }
    default:
      console.error(red(`Error: Unknown command '${command}'`));
      console.log(`Run ${bold("pulumi-backend help")} for usage information.`);
      Deno.exit(1);
  }
}
