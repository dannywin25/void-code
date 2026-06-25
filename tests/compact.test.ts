import { describe, it, expect, vi } from "vitest";
import { estimateTokens, compactIfNeeded } from "../src/context/compact.js";
import { Session } from "../src/context/session.js";
import { ChatMessage, Provider } from "../src/provider/types.js";

describe("estimateTokens", () => {
  it("按字符数/4 粗估", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "12345678" }]; // 8 字符
    expect(estimateTokens(msgs)).toBe(2);
  });
});

function fakeProvider(summary: string): Provider {
  return { chat: vi.fn(async () => ({ text: summary, toolCalls: [] })) } as unknown as Provider;
}

describe("compactIfNeeded", () => {
  it("未超阈值不压缩，返回 false", async () => {
    const s = new Session("SYS");
    s.addUser("hi");
    expect(await compactIfNeeded(s, fakeProvider("S"), { threshold: 100000, keepRecent: 6 })).toBe(false);
  });

  it("超阈值时摘要中间消息，保留系统提示+摘要+最近 keepRecent 条", async () => {
    const s = new Session("SYS");
    for (let i = 0; i < 10; i++) s.addUser("x".repeat(50));
    const compacted = await compactIfNeeded(s, fakeProvider("这是摘要"), { threshold: 10, keepRecent: 2 });
    expect(compacted).toBe(true);
    expect(s.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(s.messages[1].content).toContain("此前对话的摘要");
    expect(s.messages[1].content).toContain("这是摘要");
    expect(s.messages).toHaveLength(4); // system + 摘要 + 最近 2 条
  });
});
