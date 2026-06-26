import { Session } from "../context/session.js";
import { ToolRegistry } from "../tools/registry.js";
import { Skill } from "../skills/loader.js";

export interface CommandContext {
  session: Session;
  registry: ToolRegistry;
  model: string;
  skills: Skill[];
}

export interface CommandResult {
  handled: boolean;
  message?: string;
  exit?: boolean;
  runPrompt?: string;
}

export const INIT_PROMPT = `请分析当前项目并生成或更新一份 CLAUDE.md 文件，用于让 AI 编码助手快速理解本项目。请按以下步骤：
1. 用 list_files、read_file、search 查看项目结构、package.json、README 和关键源码；
2. 总结：项目用途、技术栈、构建/测试/运行命令、目录结构与架构、代码约定；
3. 用 write_file 写入 ./CLAUDE.md。若已存在 CLAUDE.md，先用 read_file 读它、在其基础上更新。
内容要简洁、面向 AI 助手。`;

export function handleCommand(input: string, ctx: CommandContext): CommandResult {
  if (!input.startsWith("/")) return { handled: false };

  const parts = input.slice(1).trim().split(/\s+/);
  const cmd = parts[0];
  const arg = parts.slice(1).join(" ");
  switch (cmd) {
    case "help":
      return { handled: true, message: helpText(ctx.registry) };
    case "tools":
      return { handled: true, message: toolsText(ctx.registry) };
    case "model":
      return { handled: true, message: `当前模型：${ctx.model}` };
    case "skills":
      return { handled: true, message: skillsText(ctx.skills) };
    case "skill": {
      if (!arg) return { handled: true, message: "用法：/skill <name>。用 /skills 查看可用 skill。" };
      const s = ctx.skills.find((x) => x.name === arg);
      if (!s) return { handled: true, message: `未找到 skill "${arg}"。用 /skills 查看可用。` };
      return { handled: true, runPrompt: s.body };
    }
    case "init":
      return { handled: true, runPrompt: INIT_PROMPT };
    case "clear":
      ctx.session.clear();
      return { handled: true, message: "已清空会话历史（系统提示保留）。" };
    case "exit":
      return { handled: true, exit: true };
    default:
      return { handled: true, message: `未知命令 /${cmd}，输入 /help 查看可用命令。` };
  }
}

function skillsText(skills: Skill[]): string {
  if (skills.length === 0) return "（无可用 skill）";
  const lines = skills.map((s) => `  ${s.name} — ${s.description}`).join("\n");
  return `可用 skill：\n${lines}`;
}

function toolsText(registry: ToolRegistry): string {
  const tools = registry
    .schemas()
    .map((s) => `  ${s.function.name} — ${s.function.description}`)
    .join("\n");
  return `可用工具：\n${tools}`;
}

function helpText(registry: ToolRegistry): string {
  return [
    "可用命令：",
    "  /help  — 显示本帮助",
    "  /tools — 列出可用工具",
    "  /model — 显示当前模型",
    "  /init  — 分析当前项目并生成 CLAUDE.md",
    "  /skills — 列出可用 skill",
    "  /skill <name> — 手动触发某个 skill",
    "  /clear — 清空会话历史",
    "  /exit  — 退出",
    "",
    toolsText(registry),
  ].join("\n");
}
