import { describe, it, expect } from "vitest";
import { handleCommand } from "../src/ui/commands.js";
import { Session } from "../src/context/session.js";
import { ToolRegistry, Tool } from "../src/tools/registry.js";

function makeCtx() {
  const session = new Session("SYS");
  const registry = new ToolRegistry();
  const echo: Tool = {
    isWriteOrExec: false,
    schema: { type: "function", function: { name: "read_file", description: "读文件", parameters: { type: "object", properties: {} } } },
    async execute() { return ""; },
  };
  registry.register(echo);
  return {
    session,
    registry,
    model: "glm-4-flash",
    skills: [{ name: "demo", description: "演示", body: "演示指令", path: "/p" }],
  };
}

describe("handleCommand", () => {
  it("非斜杠输入不处理", () => {
    expect(handleCommand("你好", makeCtx())).toEqual({ handled: false });
  });

  it("/help 返回命令与工具清单", () => {
    const r = handleCommand("/help", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.message).toMatch(/可用命令/);
    expect(r.message).toContain("read_file");
  });

  it("/clear 清空会话历史并反馈", () => {
    const ctx = makeCtx();
    ctx.session.addUser("hi");
    const r = handleCommand("/clear", ctx);
    expect(r.handled).toBe(true);
    expect(r.message).toMatch(/已清空/);
    expect(ctx.session.messages).toHaveLength(1);
  });

  it("/exit 请求退出", () => {
    const r = handleCommand("/exit", makeCtx());
    expect(r).toMatchObject({ handled: true, exit: true });
  });

  it("未知命令给出提示", () => {
    const r = handleCommand("/foo", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.message).toMatch(/未知命令/);
  });

  it("/tools 列出工具", () => {
    const r = handleCommand("/tools", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.message).toContain("read_file");
  });

  it("/model 显示当前模型", () => {
    const r = handleCommand("/model", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.message).toContain("glm-4-flash");
  });

  it("/init 返回 runPrompt（含 CLAUDE.md 指令）", () => {
    const r = handleCommand("/init", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.runPrompt).toBeTruthy();
    expect(r.runPrompt).toContain("CLAUDE.md");
  });

  it("/help 列出 /init", () => {
    const r = handleCommand("/help", makeCtx());
    expect(r.message).toContain("/init");
  });

  it("/skills 列出可用 skill", () => {
    const r = handleCommand("/skills", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.message).toContain("demo");
  });
  it("/skill <name> 返回 runPrompt=body", () => {
    expect(handleCommand("/skill demo", makeCtx()).runPrompt).toBe("演示指令");
  });
  it("/skill 未知名给提示", () => {
    expect(handleCommand("/skill nope", makeCtx()).message).toMatch(/未找到/);
  });
  it("/skill 无参数给用法", () => {
    expect(handleCommand("/skill", makeCtx()).message).toMatch(/用法/);
  });
  it("/help 含 /skill", () => {
    expect(handleCommand("/help", makeCtx()).message).toContain("/skill");
  });
});
