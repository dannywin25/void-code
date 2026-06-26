import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { parseSkillFile, loadSkills, renderSkillsForPrompt } from "../src/skills/loader.js";

const base = "tests/.tmp-skills";
const proj = `${base}/proj`;
const glob = `${base}/glob`;

beforeAll(async () => {
  await mkdir(`${proj}/greet`, { recursive: true });
  await writeFile(`${proj}/greet/SKILL.md`, "---\nname: greet\ndescription: 打招呼\n---\n说你好。");
  await mkdir(`${glob}/greet`, { recursive: true });
  await writeFile(`${glob}/greet/SKILL.md`, "---\nname: greet\ndescription: 全局版本\n---\n全局指令");
  await mkdir(`${glob}/bye`, { recursive: true });
  await writeFile(`${glob}/bye/SKILL.md`, "---\nname: bye\ndescription: 告别\n---\n说再见。");
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("parseSkillFile", () => {
  it("解析 frontmatter 的 name/description 与 body", () => {
    const s = parseSkillFile("---\nname: x\ndescription: 描述\n---\n正文内容", "fallback", "/p");
    expect(s.name).toBe("x");
    expect(s.description).toBe("描述");
    expect(s.body).toBe("正文内容");
  });
  it("无 frontmatter 时 name 用 fallback、body 为全文", () => {
    const s = parseSkillFile("没有 frontmatter 的正文", "mydir", "/p");
    expect(s.name).toBe("mydir");
    expect(s.description).toBe("");
    expect(s.body).toBe("没有 frontmatter 的正文");
  });
});

describe("loadSkills", () => {
  it("扫目录、项目覆盖全局同名", async () => {
    const skills = await loadSkills([proj, glob]);
    expect(skills.find((s) => s.name === "greet")!.description).toBe("打招呼"); // 项目版本胜出
    expect(skills.map((s) => s.name).sort()).toEqual(["bye", "greet"]);
  });
  it("缺目录安全返回 []（不抛）", async () => {
    expect(await loadSkills([`${base}/none1`, `${base}/none2`])).toEqual([]);
  });
});

describe("renderSkillsForPrompt", () => {
  it("含 name 与 description", () => {
    const out = renderSkillsForPrompt([{ name: "a", description: "甲", body: "", path: "" }]);
    expect(out).toContain("可用 Skill");
    expect(out).toContain("a: 甲");
  });
  it("空数组返回空串", () => {
    expect(renderSkillsForPrompt([])).toBe("");
  });
});
