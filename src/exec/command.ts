import { Logger } from "../ui/logger.ts";
import type { CommandResult, ExecuteCommandOptions } from "../types.ts";

export function createExecuteCommand(logger: Logger) {
  return async function executeCommand(
    command: string[],
    options: ExecuteCommandOptions = {},
  ): Promise<CommandResult> {
    const {
      cwd = ".",
      silent = false,
      showOutput = false,
      spinnerMessage,
      successMessage,
      errorMessage,
      env = {},
    } = options;

    const cmdString = command.join(" ");
    const spinnerId = `cmd-${Date.now()}`;

    try {
      if (!silent) {
        logger.debug(`Executing: ${cmdString}`);
        if (spinnerMessage) {
          logger.startSpinner(spinnerId, spinnerMessage);
        }
      }

      const envVars: Record<string, string> = { ...Deno.env.toObject(), ...env };

      const cmd = new Deno.Command(command[0], {
        args: command.slice(1),
        cwd,
        stdout: "piped",
        stderr: "piped",
        env: envVars,
      });

      const { code, stdout, stderr } = await cmd.output();

      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      if (code !== 0) {
        throw new Error(errorOutput || `Command exited with code ${code}`);
      }

      if (!silent) {
        if (spinnerMessage && successMessage) {
          logger.successSpinner(spinnerId, successMessage);
        }

        if (showOutput && output.trim()) {
          logger.indent();
          output.trim().split("\n").forEach((line) => {
            logger.debug(line);
          });
          logger.outdent();
        }
      }

      return { output: output.trim(), success: true };
    } catch (error) {
      if (!silent) {
        if (spinnerMessage) {
          logger.errorSpinner(
            spinnerId,
            errorMessage || `Command failed: ${(error as Error).message}`,
          );
        } else {
          logger.error(`Command failed: ${(error as Error).message}`);
        }
      }
      return { output: (error as Error).message, success: false };
    }
  };
}
