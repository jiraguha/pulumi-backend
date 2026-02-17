import { Logger } from "./ui/logger.ts";

export interface CommandResult {
  output: string;
  success: boolean;
}

export interface CommonArgs {
  verbose: boolean;
  quiet: boolean;
  yes: boolean;
  interactive: boolean;
  "no-color": boolean;
}

export interface ExecuteCommandOptions {
  cwd?: string;
  silent?: boolean;
  showOutput?: boolean;
  spinnerMessage?: string;
  successMessage?: string;
  errorMessage?: string;
  env?: Record<string, string>;
}

export type ExecuteCommandFn = (
  command: string[],
  options?: ExecuteCommandOptions,
) => Promise<CommandResult>;

export interface AppContext {
  logger: Logger;
  exec: ExecuteCommandFn;
  args: CommonArgs;
}

export interface SecretsConfig {
  passphrase?: string;
  kmsAlias?: string;
  region: string;
}
