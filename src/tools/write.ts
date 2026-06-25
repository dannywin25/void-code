import { readFile, writeFile } from "node:fs/promises";
import { Tool } from "./registry.js";

export const writeFileTool: Tool = {
  isWriteOrExec: true,
  schema: {
    type: "function",
    function: {
      name: "write_file",
      description: "把内容写入文件（覆盖整个文件，文件不存在则创建）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          content: { type: "string", description: "完整的文件内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  async execute(args) {
    const path = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : null;
    if (!path || content === null) return "错误：缺少必填参数 path 或 content";
    await writeFile(path, content, "utf8");
    return `已写入 ${path}（${content.length} 字符）`;
  },
};

export const editFileTool: Tool = {
  isWriteOrExec: true,
  schema: {
    type: "function",
    function: {
      name: "edit_file",
      description: "对文件做精确替换：把 old_string 替换为 new_string。old_string 必须在文件中唯一出现。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          old_string: { type: "string", description: "要被替换的原文（需在文件中唯一）" },
          new_string: { type: "string", description: "替换后的新文本" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  async execute(args) {
    const path = typeof args.path === "string" ? args.path : "";
    const oldStr = typeof args.old_string === "string" ? args.old_string : "";
    const newStr = typeof args.new_string === "string" ? args.new_string : "";
    if (!path || !oldStr) return "错误：缺少必填参数 path 或 old_string";

    const content = await readFile(path, "utf8");
    const count = content.split(oldStr).length - 1;
    if (count === 0) return `错误：在 ${path} 中未找到要替换的内容。`;
    if (count > 1) return `错误：old_string 在 ${path} 中出现了 ${count} 处（多处），请提供更长、唯一的片段。`;

    await writeFile(path, content.replace(oldStr, newStr), "utf8");
    return `已编辑 ${path}`;
  },
};
