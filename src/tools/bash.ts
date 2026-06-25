import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "./registry.js";

const execAsync = promisify(exec);

export const bashTool: Tool = {
  isWriteOrExec: true,
  schema: {
    type: "function",
    function: {
      name: "bash",
      description: "在当前工作目录执行一条 shell 命令，返回 stdout、stderr 和退出码。有 30 秒超时。",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "要执行的 shell 命令" } },
        required: ["command"],
      },
    },
  },
  async execute(args) {
    const command = typeof args.command === "string" ? args.command : "";
    if (!command) return "错误：缺少必填参数 command";

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30_000, maxBuffer: 1024 * 1024 });
      return `exit 0\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string; message: string };
      return `exit ${err.code ?? 1}\n--- stdout ---\n${err.stdout ?? ""}\n--- stderr ---\n${err.stderr ?? err.message}`;
    }
  },
};
