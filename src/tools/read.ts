import { readFile, readdir, stat } from "node:fs/promises";
import { Tool } from "./registry.js";

const MAX_LINES = 2000;

export const readFileTool: Tool = {
  isWriteOrExec: false,
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "读取指定文件的全部内容，返回带行号的文本（用于在修改前查看文件）。若 path 是目录，则返回该目录下的条目列表（目录名带尾部 /），可用于探索仓库结构。若需分页读大文件可传 offset/limit。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件或目录路径（相对当前目录或绝对路径）" },
          offset: { type: "number", description: "可选：起始行号（1-based，含）。用于分页读大文件。" },
          limit: { type: "number", description: "可选：最多返回的行数。" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return "错误：缺少必填参数 path";

    // 目录：返回条目列表，方便模型探索仓库结构
    const info = await stat(path);
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      if (entries.length === 0) return `目录 ${path} 为空。`;
      const listed = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join("\n");
      return `目录 ${path} 的条目：\n${listed}`;
    }

    const content = await readFile(path, "utf8");
    const lines = content.split("\n");

    const offset =
      typeof args.offset === "number" && args.offset >= 1 ? Math.floor(args.offset) : 1;
    const limit =
      typeof args.limit === "number" && args.limit >= 1 ? Math.floor(args.limit) : MAX_LINES;

    if (offset > lines.length) {
      return `错误：offset ${offset} 超出文件总行数 ${lines.length}。`;
    }

    const start = offset - 1; // 转 0-based
    const end = Math.min(start + limit, lines.length);
    const shown = lines.slice(start, end);
    const numbered = shown.map((l, i) => `${start + i + 1}\t${l}`).join("\n");
    const remaining = lines.length - end;
    const truncated =
      remaining > 0 ? `\n...（还有 ${remaining} 行，可用 offset=${end + 1} 继续读）` : "";
    return numbered + truncated;
  },
};
