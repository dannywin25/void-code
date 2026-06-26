import { describe, it, expect } from "vitest";
import { makeSkillTool } from "../src/skills/tool.js";
import { Skill } from "../src/skills/loader.js";

const skills: Skill[] = [{ name: "greet", description: "打招呼", body: "说你好。", path: "/p" }];

describe("makeSkillTool", () => {
  it("工具名 skill、只读、有必填 name 参数", () => {
    const tool = makeSkillTool(skills);
    expect(tool.schema.function.name).toBe("skill");
    expect(tool.isWriteOrExec).toBe(false);
    expect(tool.schema.function.parameters).toMatchObject({ required: ["name"] });
  });
  it("execute 返回对应 skill 的 body", async () => {
    expect(await makeSkillTool(skills).execute({ name: "greet" })).toBe("说你好。");
  });
  it("未知 skill 返回错误含可用清单", async () => {
    const out = await makeSkillTool(skills).execute({ name: "nope" });
    expect(out).toMatch(/未找到/);
    expect(out).toContain("greet");
  });
});
