import { describe, it, expect, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { SessionStore, sanitizeMessages } from "../src/context/store.js";
import { ChatMessage } from "../src/provider/types.js";

const baseDir = "tests/.tmp-store";
afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const msgs: ChatMessage[] = [
  { role: "system", content: "SYS" },
  { role: "user", content: "hi" },
];

describe("SessionStore", () => {
  it("newId 基于时间戳、可字典序比较、无冒号", () => {
    const store = new SessionStore(baseDir);
    const a = store.newId(new Date("2026-06-25T10:00:00Z"));
    const b = store.newId(new Date("2026-06-25T11:00:00Z"));
    expect(a < b).toBe(true);
    expect(a).not.toContain(":");
  });

  it("save 后能 load 回来（含 updatedAt）", async () => {
    const store = new SessionStore(baseDir);
    await store.save({ id: "s1", cwd: "/proj/a", createdAt: "2026-06-25T10:00:00Z", messages: msgs });
    const loaded = await store.load("/proj/a", "s1");
    expect(loaded?.messages).toEqual(msgs);
    expect(loaded?.updatedAt).toBeTruthy();
  });

  it("loadLatest 取字典序最大的 id", async () => {
    const store = new SessionStore(baseDir);
    await store.save({ id: "2026-06-25T10-00-00", cwd: "/proj/b", createdAt: "x", messages: msgs });
    await store.save({
      id: "2026-06-25T12-00-00",
      cwd: "/proj/b",
      createdAt: "x",
      messages: [...msgs, { role: "user", content: "later" }],
    });
    const latest = await store.loadLatest("/proj/b");
    expect(latest?.id).toBe("2026-06-25T12-00-00");
    expect(latest?.messages).toHaveLength(3);
  });

  it("空/不存在目录 loadLatest 返回 null", async () => {
    const store = new SessionStore(baseDir);
    expect(await store.loadLatest("/proj/does-not-exist")).toBeNull();
  });
});

describe("sanitizeMessages", () => {
  it("裁掉尾部未闭合的 assistant(tool_calls)", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "S" },
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "bash", arguments: "{}" } }] },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[out.length - 1].role).toBe("user");
  });

  it("已闭合的 tool_calls 序列原样保留", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "S" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "bash", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "ok" },
    ];
    expect(sanitizeMessages(msgs)).toHaveLength(3);
  });

  it("无 tool_calls 的普通历史原样保留", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "S" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "你好", tool_calls: undefined },
    ];
    expect(sanitizeMessages(msgs)).toHaveLength(3);
  });
});
