import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { LoopUI } from "../agent/loop.js";
import { renderMarkdown } from "./markdown.js";

export class Terminal implements LoopUI {
  private rl = readline.createInterface({ input: stdin, output: stdout });

  async prompt(): Promise<string> {
    const line = await this.rl.question("\n> ");
    return line.trim();
  }

  info(s: string): void {
    stdout.write(`\n${s}\n`);
  }

  toolCall(name: string, preview: string): void {
    const short = preview.length > 120 ? preview.slice(0, 120) + "…" : preview;
    stdout.write(`\n⚙ ${name}(${short})\n`);
  }

  toolResult(s: string): void {
    const out = s.length > 800 ? s.slice(0, 800) + `\n…（共 ${s.length} 字符，已截断）` : s;
    stdout.write(`${out}\n`);
  }

  async confirm(message: string): Promise<boolean> {
    const ans = await this.rl.question(`\n${message}\n确认执行? [y/N] `);
    const a = ans.trim().toLowerCase();
    return a === "y" || a === "yes";
  }

  usage(line: string): void {
    stdout.write(`\x1b[2m${line}\x1b[0m\n`); // 暗色显示
  }

  onSigint(handler: () => void): void {
    this.rl.on("SIGINT", handler);
  }

  renderAssistant(text: string): void {
    if (!text.trim()) return;
    stdout.write(renderMarkdown(text) + "\n");
  }

  thinkingStart(): void {
    stdout.write("生成中…");
  }

  thinkingStop(): void {
    stdout.write("\r\x1b[K"); // 回到行首并清除整行
  }

  close(): void {
    this.rl.close();
  }
}
