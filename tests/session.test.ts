import { describe, it, expect } from "vitest";
import { Session } from "../src/context/session.js";
import { buildSystemPrompt } from "../src/context/system-prompt.js";

describe("Session", () => {
  it("初始化时把系统提示作为第一条消息", () => {
    const s = new Session("SYS");
    expect(s.messages[0]).toEqual({ role: "system", content: "SYS" });
  });

  it("按顺序记录 user / assistant(带工具) / tool 结果", () => {
    const s = new Session("SYS");
    s.addUser("hi");
    s.addAssistant("", [{ id: "c1", type: "function", function: { name: "bash", arguments: "{}" } }]);
    s.addToolResult("c1", "done");
    expect(s.messages[1]).toEqual({ role: "user", content: "hi" });
    expect(s.messages[2].role).toBe("assistant");
    expect(s.messages[2].tool_calls?.[0].id).toBe("c1");
    expect(s.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "done" });
  });

  it("assistant 无工具调用时不带 tool_calls 字段", () => {
    const s = new Session("SYS");
    s.addAssistant("answer", []);
    expect(s.messages[1].tool_calls).toBeUndefined();
    expect(s.messages[1].content).toBe("answer");
  });

  it("clear() 清空历史但保留系统提示", () => {
    const s = new Session("SYS");
    s.addUser("hi");
    s.addAssistant("answer", []);
    s.clear();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toEqual({ role: "system", content: "SYS" });
  });

  it("用消息数组构造时直接重建历史", () => {
    const msgs: import("../src/provider/types.js").ChatMessage[] = [
      { role: "system", content: "SYS" },
      { role: "user", content: "hi" },
    ];
    const s = new Session([...msgs]);
    expect(s.messages).toEqual(msgs);
  });
});

describe("buildSystemPrompt", () => {
  it("包含工作目录和操作系统信息", () => {
    const p = buildSystemPrompt("/work/dir", "darwin");
    expect(p).toContain("/work/dir");
    expect(p).toContain("darwin");
  });
});
