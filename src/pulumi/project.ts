import type { AppContext } from "../types.ts";
import { bold } from "../ui/colors.ts";

export async function initPulumiProject(
  ctx: AppContext,
  name: string,
  description = "",
  template = "typescript",
): Promise<boolean> {
  const { logger, exec } = ctx;
  logger.startSpinner("init-project", `Initializing Pulumi project "${name}" with ${template} template...`);

  const cmd = ["pulumi", "new", template, "--force", "--yes"];
  if (name) cmd.push("--name", name);
  if (description) cmd.push("--description", description);

  const { success, output } = await exec(cmd, { silent: true });

  if (!success) {
    logger.errorSpinner("init-project", `Failed to initialize Pulumi project: ${output}`);
    return false;
  }

  logger.successSpinner("init-project", `Pulumi project "${name}" initialized successfully`);
  return true;
}

export async function readProjectConfig(ctx: AppContext, defaultProjectName: string): Promise<string> {
  try {
    const pulumiYaml = await Deno.readTextFile("Pulumi.yaml");
    const nameMatch = pulumiYaml.match(/name:\s*(.*)/);
    if (nameMatch && nameMatch[1]) {
      const projectName = nameMatch[1].trim();
      ctx.logger.info(`Using existing project name: ${bold(projectName)}`);
      return projectName;
    }
  } catch (error) {
    ctx.logger.debug(`Error reading Pulumi.yaml: ${(error as Error).message}`);
  }
  return defaultProjectName;
}
