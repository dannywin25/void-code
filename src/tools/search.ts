import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Tool } from "./registry.js";

const IGNORE = new Set(["node_modules", ".git", "dist"]);
const MAX_RESULTS = 200;

export const searchTool: Tool = {
  isWriteOrExec: false,
  schema: {
    type: "function",
    function: {
      name: "search",
      description: "在目录下递归搜索文件内容（正则匹配），返回匹配的 文件:行号: 文本。默认搜索当前目录。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "正则表达式" },
          path: { type: "string", description: "搜索根目录，默认当前目录" },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args) {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) return "错误：缺少必填参数 pattern";
    const root = typeof args.path === "string" && args.path ? args.path : ".";
    const regex = new RegExp(pattern); // 非法正则会抛，由 registry 捕获

    const results: string[] = [];

    async function walk(dir: string): Promise<void> {
      if (results.length >= MAX_RESULTS) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (IGNORE.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile()) {
          let content: string;
          try {
            content = await readFile(full, "utf8");
          } catch {
            continue; // 二进制/无权限文件跳过
          }
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${full}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= MAX_RESULTS) break;
            }
          }
        }
      }
    }

    await walk(root);

    if (results.length === 0) return `未找到匹配 "${pattern}"`;
    const suffix = results.length >= MAX_RESULTS ? `\n...（已截断，最多 ${MAX_RESULTS} 条）` : "";
    return results.join("\n") + suffix;
  },
};
