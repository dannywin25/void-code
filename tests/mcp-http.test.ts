import { describe, it, expect, afterAll } from "vitest";
import { createServer, Server } from "node:http";
import { HttpTransport, parseSseData } from "../src/mcp/transport.js";
import { McpClient } from "../src/mcp/client.js";

let server: Server | undefined;

function startServer(): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const msg = JSON.parse(body);
        if (msg.method === "notifications/initialized") {
          res.writeHead(202).end();
          return;
        }
        let result: any = {};
        if (msg.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: {} };
        else if (msg.method === "tools/list") result = { tools: [{ name: "ping", description: "p", inputSchema: { type: "object" } }] };
        else if (msg.method === "tools/call") result = { content: [{ type: "text", text: "pong" }] };
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sess-1" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      });
    });
    server.listen(0, () => {
      const addr = server!.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}/mcp`);
    });
  });
}

afterAll(() => {
  server?.close();
});

describe("parseSseData", () => {
  it("抽取 data: 行内容", () => {
    expect(parseSseData('event: message\ndata: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });
});

describe("HttpTransport + McpClient", () => {
  it("走 HTTP 完成 connect / listTools / callTool", async () => {
    const url = await startServer();
    const client = new McpClient(new HttpTransport(url));
    await client.connect();
    const tools = await client.listTools();
    expect(tools[0].name).toBe("ping");
    expect(await client.callTool("ping", {})).toBe("pong");
    await client.close();
  });

  it("HTTP 非 2xx 响应被 reject 而非挂起", async () => {
    const bad = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
      });
    });
    const url: string = await new Promise((resolve) =>
      bad.listen(0, () => {
        const a = bad.address();
        resolve(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/mcp`);
      })
    );
    const client = new McpClient(new HttpTransport(url));
    await expect(client.connect()).rejects.toThrow(/401|失败/);
    bad.close();
  });
});
