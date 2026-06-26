import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
}

export function parseSkillFile(content: string, fallbackName: string, path: string): Skill {
  const normalized = content.replace(/\r\n/g, "\n");
  let name = fallbackName;
  let description = "";
  let body = normalized.trim();

  const fm = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fm) {
    body = fm[2].trim();
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (key === "name") name = val;
      else if (key === "description") description = val;
    }
  }
  return { name, description, body, path };
}

export async function loadSkills(dirs: string[]): Promise<Skill[]> {
  const byName = new Map<string, Skill>();
  // 约定 [项目, 全局]：倒序处理（先全局后项目），项目最后写入覆盖全局同名
  for (const dir of [...dirs].reverse()) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // 目录不存在
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMd = join(dir, e.name, "SKILL.md");
      let content;
      try {
        content = await readFile(skillMd, "utf8");
      } catch {
        continue; // 子目录没有 SKILL.md
      }
      const skill = parseSkillFile(content, e.name, skillMd);
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()];
}

export function renderSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  return `\n\n# 可用 Skill\n需要时用 skill 工具按名称加载完整指令：\n${lines}`;
}
