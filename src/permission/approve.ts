import { readFile } from "node:fs/promises";
import { ToolCall } from "../provider/types.js";
import { renderDiff } from "../ui/diff.js";

export interface Confirmer {
  confirm(message: string): Promise<boolean>;
}

function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments || "{}");
  } catch {
    return {};
  }
}

export async function buildPreview(call: ToolCall): Promise<string> {
  const args = parseArgs(call);
  switch (call.function.name) {
    case "edit_file":
      return `编辑文件 ${args.path}：\n${renderDiff(String(args.old_string ?? ""), String(args.new_string ?? ""))}`;
    case "write_file": {
      const path = String(args.path ?? "");
      let existing = "";
      try {
        existing = await readFile(path, "utf8");
      } catch {
        existing = ""; // 文件不存在 → 全部按新增
      }
      return `写入文件 ${path}：\n${renderDiff(existing, String(args.content ?? ""))}`;
    }
    case "bash":
      return `执行命令：${args.command}`;
    default:
      return `${call.function.name}(${call.function.arguments})`;
  }
}

export async function approveIfNeeded(
  call: ToolCall,
  isWriteOrExec: boolean,
  confirmer: Confirmer
): Promise<boolean> {
  if (!isWriteOrExec) return true;
  return confirmer.confirm(await buildPreview(call));
}
