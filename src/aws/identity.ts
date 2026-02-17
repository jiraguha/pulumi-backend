import type { AppContext } from "../types.ts";

export async function getCurrentAwsIdentity(ctx: AppContext): Promise<string | null> {
  try {
    const { success, output } = await ctx.exec(
      ["aws", "sts", "get-caller-identity", "--query", "Arn", "--output", "text"],
      { silent: true },
    );
    if (success && output) {
      return output.trim();
    }
    return null;
  } catch (error) {
    ctx.logger.debug(`Failed to get AWS identity: ${(error as Error).message}`);
    return null;
  }
}
