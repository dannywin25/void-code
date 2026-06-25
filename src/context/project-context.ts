import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultGlobalDir(): string {
  return join(homedir(), ".void-code");
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function loadProjectContext(cwd: string, globalDir: string): Promise<string> {
  const globalContent = await readIfExists(join(globalDir, "CLAUDE.md"));
  const projectContent = await readIfExists(join(cwd, "CLAUDE.md"));

  const parts: string[] = [];
  if (globalContent && globalContent.trim()) {
    parts.push(`# 全局记忆（~/.void-code/CLAUDE.md）\n${globalContent.trim()}`);
  }
  if (projectContent && projectContent.trim()) {
    parts.push(`# 项目记忆（CLAUDE.md）\n${projectContent.trim()}`);
  }
  if (parts.length === 0) return "";
  return "\n\n" + parts.join("\n\n");
}
