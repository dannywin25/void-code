import { glob } from "glob";
import { join } from "node:path";
import { Tool } from "./registry.js";

const MAX_RESULTS = 200;

export const listFilesTool: Tool = {
  isWriteOrExec: false,
  schema: {
    type: "function",
    function: {
      name: "list_files",
      description: '用 glob 模式列出匹配的文件路径（如 "src/**/*.ts"）。用于按模式查找文件。返回的路径相对当前工作目录，可直接传给 read_file。',
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 模式，如 src/**/*.ts" },
          cwd: { type: "string", description: "可选：搜索根目录，默认当前目录" },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args) {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) return "错误：缺少必填参数 pattern";
    const cwd = typeof args.cwd === "string" && args.cwd ? args.cwd : ".";

    const matches = await glob(pattern, {
      cwd,
      nodir: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    });

    if (matches.length === 0) return `未找到匹配 "${pattern}" 的文件`;
    const normalized = matches.map((m) => join(cwd, m));
    const shown = normalized.sort().slice(0, MAX_RESULTS);
    const suffix =
      matches.length > MAX_RESULTS ? `\n...（共 ${matches.length} 个，已截断到 ${MAX_RESULTS}）` : "";
    return shown.join("\n") + suffix;
  },
};
