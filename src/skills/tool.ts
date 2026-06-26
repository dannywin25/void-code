import { Tool } from "../tools/registry.js";
import { Skill } from "./loader.js";

export function makeSkillTool(skills: Skill[]): Tool {
  return {
    isWriteOrExec: false,
    schema: {
      type: "function",
      function: {
        name: "skill",
        description:
          "按名称加载一个 skill 的完整指令到上下文，然后按其指示执行。可用 skill 见系统提示中的列表。",
        parameters: {
          type: "object",
          properties: { name: { type: "string", description: "skill 名称" } },
          required: ["name"],
        },
      },
    },
    async execute(args) {
      const name = typeof args.name === "string" ? args.name : "";
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        const available = skills.map((s) => s.name).join(", ") || "（无）";
        return `错误：未找到 skill "${name}"。可用：${available}`;
      }
      return skill.body;
    },
  };
}
