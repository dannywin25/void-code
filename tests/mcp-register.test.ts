import { describe, it, expect, vi } from "vitest";
import { wrapMcpTool, connectAndRegisterMcp } from "../src/mcp/register.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("wrapMcpTool", () => {
  it("命名 mcp__server__tool、需确认、execute 调 callTool", async () => {
    const client = { callTool: vi.fn(async () => "结果") } as any;
    const tool = wrapMcpTool(client, "fs", {
      name: "read",
      description: "读",
      inputSchema: { type: "object", properties: { p: { type: "string" } } },
    });
    expect(tool.schema.function.name).toBe("mcp__fs__read");
    expect(tool.isWriteOrExec).toBe(true);
    expect(tool.schema.function.parameters).toEqual({ type: "object", properties: { p: { type: "string" } } });
    expect(await tool.execute({ p: "x" })).toBe("结果");
    expect(client.callTool).toHaveBeenCalledWith("read", { p: "x" });
  });

  it("inputSchema 缺省时给空 object schema", () => {
    const tool = wrapMcpTool({ callTool: vi.fn() } as any, "s", { name: "t" });
    expect(tool.schema.function.parameters).toEqual({ type: "object", properties: {} });
  });
});

describe("connectAndRegisterMcp（集成 mock stdio server）", () => {
  it("连 mock server 并把 echo 注册为 mcp__mock__echo", async () => {
    const reg = new ToolRegistry();
    const logs: string[] = [];
    const clients = await connectAndRegisterMcp(
      [{ name: "mock", command: "node", args: ["tests/fixtures/mock-mcp-server.mjs"] }],
      reg,
      (m) => logs.push(m)
    );
    expect(reg.schemas().some((s) => s.function.name === "mcp__mock__echo")).toBe(true);
    const out = await reg.execute({
      id: "c",
      type: "function",
      function: { name: "mcp__mock__echo", arguments: JSON.stringify({ text: "hi" }) },
    });
    expect(out).toBe("echo: hi");
    for (const c of clients) await c.close();
  });

  it("连接失败的 server 被跳过、不抛", async () => {
    const reg = new ToolRegistry();
    const logs: string[] = [];
    const clients = await connectAndRegisterMcp(
      [{ name: "bad", command: "this-command-does-not-exist-xyz", args: [] }],
      reg,
      (m) => logs.push(m)
    );
    expect(clients).toHaveLength(0);
    expect(logs.some((l) => l.includes("失败") || l.includes("跳过"))).toBe(true);
  });
});
