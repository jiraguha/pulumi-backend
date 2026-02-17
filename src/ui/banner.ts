import { bgBlue, bgCyan, bgGreen, black, cyan, dim } from "./colors.ts";

export function showBanner(title: string, version: string, subtitle: string, quiet = false): void {
  if (quiet) return;

  console.log(
    `
${bgBlue(black(" PULUMI "))}${bgCyan(black(` ${title} `))}${bgGreen(black(" BACKEND "))} ${cyan(`v${version}`)}

${dim(subtitle)}
`);
}
