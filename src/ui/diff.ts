import { diffLines } from "diff";
import chalk from "chalk";

export function renderDiff(oldStr: string, newStr: string): string {
  const parts = diffLines(oldStr, newStr);
  const out: string[] = [];
  for (const part of parts) {
    const lines = part.value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop(); // 去掉末尾空行
    for (const line of lines) {
      if (part.added) out.push(chalk.green(`+ ${line}`));
      else if (part.removed) out.push(chalk.red(`- ${line}`));
      else out.push(chalk.dim(`  ${line}`));
    }
  }
  return out.join("\n");
}
