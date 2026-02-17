import { parse } from "@std/flags";
import { dirname, join } from "@std/path";
import { exists } from "@std/fs";
import { bold, dim, cyan, red, yellow, green, blue } from "../ui/colors.ts";

const REPO_DIR = `${Deno.env.get("HOME")}/.pulumi-backend`;

async function executeCommand(
  command: string[],
  options: { cwd?: string } = {},
): Promise<{ output: string; success: boolean }> {
  try {
    const cmd = new Deno.Command(command[0], {
      args: command.slice(1),
      cwd: options.cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await cmd.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    if (code !== 0) {
      throw new Error(errorOutput || `Command exited with code ${code}`);
    }

    return { output: output.trim(), success: true };
  } catch (error) {
    return { output: (error as Error).message, success: false };
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const command = Deno.build.os === "windows" ? ["where", cmd] : ["which", cmd];
    const proc = new Deno.Command(command[0], {
      args: command.slice(1),
      stdout: "null",
      stderr: "null",
    });
    const { code } = await proc.output();
    return code === 0;
  } catch {
    return false;
  }
}

export default async function selfUpdateCommand(rawArgs: string[]): Promise<void> {
  console.log(bold(blue("Updating Pulumi Backend Management Tool...")));

  const updateOptions = parse(rawArgs, {
    string: ["tag", "branch", "ref"],
    boolean: ["help"],
    alias: { t: "tag", b: "branch", r: "ref", h: "help" },
  });

  if (updateOptions.help) {
    console.log(`
${bold("USAGE:")}
  pulumi-backend self-update [options]

${bold("OPTIONS:")}
  --tag TAG        Update to a specific tagged version
  --branch BRANCH  Update to a specific branch
  --ref REF        Update to a specific Git reference
  --help           Show this help message
`);
    Deno.exit(0);
  }

  if (!await commandExists("git")) {
    console.error(red("Error: Git is not installed. Please install Git to use self-update."));
    Deno.exit(1);
  }

  if (!await exists(REPO_DIR)) {
    console.error(red(`Error: Repository directory ${REPO_DIR} does not exist.`));
    console.error(yellow("Please reinstall the tool using the installer script."));
    Deno.exit(1);
  }

  try {
    console.log(dim(`Updating repository in ${REPO_DIR}...`));

    let gitRef = "";
    if (updateOptions.tag) {
      gitRef = updateOptions.tag;
      console.log(`Updating to tag: ${cyan(gitRef)}`);
    } else if (updateOptions.branch) {
      gitRef = updateOptions.branch;
      console.log(`Updating to branch: ${cyan(gitRef)}`);
    } else if (updateOptions.ref) {
      gitRef = updateOptions.ref;
      console.log(`Updating to reference: ${cyan(gitRef)}`);
    }

    if (gitRef) {
      const { success, output } = await executeCommand(["git", "fetch"], { cwd: REPO_DIR });
      if (!success) {
        console.error(red(`Failed to fetch repository updates: ${output}`));
        Deno.exit(1);
      }

      const { success: checkoutSuccess, output: checkoutOutput } = await executeCommand(
        ["git", "checkout", gitRef],
        { cwd: REPO_DIR },
      );
      if (!checkoutSuccess) {
        console.error(red(`Failed to checkout ${gitRef}: ${checkoutOutput}`));
        Deno.exit(1);
      }
    }

    const { success: pullSuccess, output: pullOutput } = await executeCommand(
      ["git", "pull", "--force"],
      { cwd: REPO_DIR },
    );
    if (!pullSuccess) {
      console.error(red(`Failed to pull updates: ${pullOutput}`));
      Deno.exit(1);
    }

    // Get the script's installation directory
    const scriptPath = new URL(import.meta.url).pathname;
    const installDir = dirname(dirname(dirname(scriptPath))); // Go up from src/commands/

    // Symlink mod.ts to pulumi-backend
    const symlinkPath = join(installDir, "pulumi-backend");
    const symlinkTarget = join(installDir, "mod.ts");

    try {
      const symlinkInfo = await Deno.lstat(symlinkPath);
      if (!symlinkInfo.isSymlink) {
        await Deno.remove(symlinkPath);
        await Deno.symlink(symlinkTarget, symlinkPath);
      }
    } catch {
      try {
        await Deno.symlink(symlinkTarget, symlinkPath);
      } catch (error) {
        console.error(yellow(`Note: Failed to create symlink: ${(error as Error).message}`));
        console.log(yellow("This is not critical, you can still use mod.ts directly."));
      }
    }

    const { output: commitHash } = await executeCommand(
      ["git", "rev-parse", "--short", "HEAD"],
      { cwd: REPO_DIR },
    );
    const { output: branchName } = await executeCommand(
      ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: REPO_DIR },
    );

    console.log(green(bold("\nUpdate successful!")));
    console.log(`${bold("Current version:")} ${branchName} (${commitHash})`);
  } catch (error) {
    console.error(red(`Error during self-update: ${(error as Error).message}`));
    Deno.exit(1);
  }
}
