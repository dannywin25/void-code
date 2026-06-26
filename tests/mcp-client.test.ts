import { describe, it, expect } from "vitest";
import { McpClient } from "../src/mcp/client.js";
import { Transport } from "../src/mcp/transport.js";

// 假 Transport：send 时按请求 method 用 responder 生成 {result} 或 {error}，异步塞回 onMessage
class FakeTransport implements Transport {
  private handler: (msg: any) => void = () => {};
  sent: any[] = [];
  responder: (msg: any) => { result?: any; error?: any } = () => ({ result: {} });
  async start() {}
  onMessage(h: (msg: any) => void) { this.handler = h; }
  async send(message: any) {
    this.sent.push(message);
    if (message.id !== undefined) {
      const r = this.responder(message);
      queueMicrotask(() => this.handler({ jsonrpc: "2.0", id: message.id, ...r }));
    }
  }
  async close() {}
}

describe("McpClient", () => {
  it("connect 发 initialize 并补 notifications/initialized", async () => {
    const t = new FakeTransport();
    t.responder = (m) =>
      m.method === "initialize"
        ? { result: { protocolVersion: "2024-11-05", capabilities: {} } }
        : { result: {} };
    const client = new McpClient(t);
    await client.connect();
    expect(t.sent[0].method).toBe("initialize");
    expect(t.sent[0].params.protocolVersion).toBe("2024-11-05");
    expect(t.sent[0].params.clientInfo.name).toBe("void-code");
    expect(t.sent.some((m) => m.method === "notifications/initialized")).toBe(true);
  });

  it("listTools 返回工具数组", async () => {
    const t = new FakeTransport();
    t.responder = (m) =>
      m.method === "tools/list"
        ? { result: { tools: [{ name: "echo", description: "回显", inputSchema: { type: "object" } }] } }
        : { result: {} };
    const client = new McpClient(t);
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("echo");
  });

  it("callTool 拼接 text 内容", async () => {
    const t = new FakeTransport();
    t.responder = () => ({ result: { content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] } });
    const client = new McpClient(t);
    expect(await client.callTool("echo", { msg: "x" })).toBe("hello\nworld");
  });

  it("callTool 标注非文本内容", async () => {
    const t = new FakeTransport();
    t.responder = () => ({ result: { content: [{ type: "image", data: "..." }] } });
    const client = new McpClient(t);
    expect(await client.callTool("img", {})).toContain("[非文本内容: image]");
  });

  it("isError 结果前缀「错误：」", async () => {
    const t = new FakeTransport();
    t.responder = () => ({ result: { content: [{ type: "text", text: "boom" }], isError: true } });
    const client = new McpClient(t);
    expect(await client.callTool("x", {})).toBe("错误：boom");
  });

  it("JSON-RPC error 响应被 reject", async () => {
    const t = new FakeTransport();
    t.responder = () => ({ error: { message: "坏了" } });
    const client = new McpClient(t);
    await expect(client.listTools()).rejects.toThrow(/坏了/);
  });

  it("请求超时则 reject（transport 永不回应）", async () => {
    const t: Transport = {
      async start() {},
      onMessage() {},
      async send() {},
      async close() {},
    };
    const client = new McpClient(t, undefined, 50);
    await expect(client.listTools()).rejects.toThrow(/超时/);
  });
});
