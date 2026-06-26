# void-code MCP 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手写最小 MCP 客户端（JSON-RPC 核心 + stdio/HTTP 传输），把 `.mcp.json` 里配置的 MCP server 的 tools 注册进 void-code。

**Architecture:** 传输无关的 `Transport` 接口 + `McpClient`（JSON-RPC 关联/握手/listTools/callTool）；两种传输 `StdioTransport`（spawn 子进程、换行 JSON）与 `HttpTransport`（最小 Streamable HTTP）；`connectAndRegisterMcp` 把 MCP 工具包装成现有 `Tool` 注册进 `ToolRegistry`；index 启动连接、退出清理。

**Tech Stack:** TypeScript + Node.js (ESM)、node 内置 child_process/http、全局 fetch、`vitest`。

## Global Constraints

- **运行时**：ESM（`"type":"module"`），TypeScript `NodeNext`，源码 import 一律带 `.js` 后缀。
- **测试框架**：`vitest`，测试放 `tests/`；写盘测试用 `tests/.tmp-*`；spawn 用 `tests/fixtures/` 下的 mock server。
- **不破坏现有功能**：现有 89 个单测保持全绿。
- **MCP 协议版本固定** `2024-11-05`。
- **MCP 工具命名** `mcp__<server>__<tool>`；**默认 `isWriteOrExec: true`**（需 y/n 确认）。
- **范围**：只接 MCP 的 tools，不做 resources/prompts/sampling；HTTP 做请求/响应导向的最小 Streamable HTTP。
- **语言**：面向用户文案用中文；标识符用英文。
- **提交策略（覆盖默认）**：禁止自动 `git commit`/`git push`。每个任务最后一步是「向用户报告完成并列出改动文件，由用户自行提交」。

---

## File Structure

| 文件 | 改动 | 任务 |
|------|------|------|
| `src/mcp/transport.ts` | **新增** Transport 接口（T1）+ StdioTransport（T2）+ HttpTransport（T3） | T1/T2/T3 |
| `src/mcp/client.ts` | **新增** McpClient（JSON-RPC 核心 + 握手 + listTools + callTool） | T1 |
| `tests/fixtures/mock-mcp-server.mjs` | **新增** 测试用极小 MCP server | T2 |
| `src/mcp/config.ts` | **新增** loadMcpConfig | T4 |
| `src/mcp/register.ts` | **新增** wrapMcpTool + connectAndRegisterMcp | T5 |
| `src/index.ts` | 启动连接+注册 MCP；退出清理 | T6 |

---

### Task 1: Transport 接口 + McpClient（JSON-RPC 核心）

**Files:**
- Create: `src/mcp/transport.ts`（仅接口）, `src/mcp/client.ts`
- Test: `tests/mcp-client.test.ts`

**Interfaces:**
- Produces:
  - `interface Transport { start(): Promise<void>; send(message: unknown): Promise<void>; onMessage(handler: (msg: any) => void): void; close(): Promise<void> }`
  - `interface McpToolDef { name: string; description?: string; inputSchema?: Record<string, unknown> }`
  - `class McpClient`：`constructor(transport: Transport, clientInfo?: {name,version})`；`connect()`、`listTools(): Promise<McpToolDef[]>`、`callTool(name, args): Promise<string>`、`close()`。

- [ ] **Step 1: 写 `src/mcp/transport.ts`（仅接口）**

```ts
export interface Transport {
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
  onMessage(handler: (msg: any) => void): void;
  close(): Promise<void>;
}
```

- [ ] **Step 2: 写失败测试 `tests/mcp-client.test.ts`**

```ts
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
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/mcp/client.js'`）

- [ ] **Step 4: 实现 `src/mcp/client.ts`**

```ts
import { Transport } from "./transport.js";

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2024-11-05";

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

export class McpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private clientInfo: { name: string; version: string };

  constructor(private transport: Transport, clientInfo?: { name: string; version: string }) {
    this.clientInfo = clientInfo ?? { name: "void-code", version: "0.1.0" };
    this.transport.onMessage((msg) => this.handleMessage(msg));
  }

  private handleMessage(msg: any): void {
    if (msg && typeof msg.id === "number" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "MCP 错误"));
      else p.resolve(msg.result);
    }
    // 无 id 的通知忽略
  }

  private request(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send({ jsonrpc: "2.0", id, method, params }).catch((err) => {
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private notify(method: string, params?: unknown): Promise<void> {
    return this.transport.send({ jsonrpc: "2.0", method, params });
  }

  async connect(): Promise<void> {
    await this.transport.start();
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: this.clientInfo,
    });
    await this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = await this.request("tools/list");
    return (result?.tools ?? []) as McpToolDef[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request("tools/call", { name, arguments: args });
    return formatToolResult(result);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

function formatToolResult(result: any): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  const parts = content.map((c: any) =>
    c?.type === "text" ? String(c.text ?? "") : `[非文本内容: ${c?.type ?? "unknown"}]`
  );
  const text = parts.join("\n");
  return result?.isError ? `错误：${text}` : text;
}
```

- [ ] **Step 5: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（mcp-client 6 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 6: 报告完成（不自动提交）**

报告：Task 1 完成，新增 `src/mcp/transport.ts`、`src/mcp/client.ts`、`tests/mcp-client.test.ts`。

---

### Task 2: StdioTransport + mock server

**Files:**
- Modify: `src/mcp/transport.ts`（追加 StdioTransport）
- Create: `tests/fixtures/mock-mcp-server.mjs`
- Test: `tests/mcp-stdio.test.ts`

**Interfaces:**
- Consumes: `Transport`（T1）、`McpClient`（T1）。
- Produces: `class StdioTransport implements Transport`，构造 `(command: string, args?: string[], env?: Record<string,string>)`。

- [ ] **Step 1: 写 mock server `tests/fixtures/mock-mcp-server.mjs`**

```js
// 极小 MCP server：读换行分隔 JSON-RPC，回应 initialize / tools/list / tools/call
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "1.0" } },
    });
  } else if (msg.method === "notifications/initialized") {
    // 通知，无需回应
  } else if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          { name: "echo", description: "回显输入", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
        ],
      },
    });
  } else if (msg.method === "tools/call") {
    const text = msg.params?.arguments?.text ?? "";
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `echo: ${text}` }] } });
  } else if (msg.id !== undefined) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
});
```

- [ ] **Step 2: 写失败测试 `tests/mcp-stdio.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { StdioTransport } from "../src/mcp/transport.js";
import { McpClient } from "../src/mcp/client.js";

describe("StdioTransport + McpClient（集成 mock server）", () => {
  it("connect / listTools / callTool 往返", async () => {
    const transport = new StdioTransport("node", ["tests/fixtures/mock-mcp-server.mjs"]);
    const client = new McpClient(transport);
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("echo");
    expect(await client.callTool("echo", { text: "hi" })).toBe("echo: hi");
    await client.close();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`StdioTransport` 未从 transport.ts 导出）

- [ ] **Step 4: 在 `src/mcp/transport.ts` 追加 StdioTransport**

文件顶部加 import，并在接口之后追加类：
```ts
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

export class StdioTransport implements Transport {
  private child?: ChildProcessWithoutNullStreams;
  private handler: (msg: any) => void = () => {};
  private buffer = "";

  constructor(
    private command: string,
    private args: string[] = [],
    private env?: Record<string, string>
  ) {}

  async start(): Promise<void> {
    this.child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    // stderr 忽略：MCP server 常往 stderr 打日志
  }

  private onData(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        this.handler(JSON.parse(line));
      } catch {
        // 非 JSON 行跳过
      }
    }
  }

  onMessage(handler: (msg: any) => void): void {
    this.handler = handler;
  }

  async send(message: unknown): Promise<void> {
    if (!this.child) throw new Error("StdioTransport 未启动");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  async close(): Promise<void> {
    this.child?.kill();
  }
}
```

- [ ] **Step 5: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（stdio 集成用例 + 其余全部）；tsc 无错误。

- [ ] **Step 6: 报告完成（不自动提交）**

报告：Task 2 完成，修改 `src/mcp/transport.ts`，新增 `tests/fixtures/mock-mcp-server.mjs`、`tests/mcp-stdio.test.ts`。

---

### Task 3: HttpTransport

**Files:**
- Modify: `src/mcp/transport.ts`（追加 HttpTransport + parseSseData）
- Test: `tests/mcp-http.test.ts`

**Interfaces:**
- Consumes: `Transport`（T1）、`McpClient`（T1）、全局 `fetch`。
- Produces: `class HttpTransport implements Transport`（构造 `(url: string)`）；`function parseSseData(body: string): string[]`。

- [ ] **Step 1: 写失败测试 `tests/mcp-http.test.ts`**

```ts
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
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`HttpTransport`/`parseSseData` 未导出）

- [ ] **Step 3: 在 `src/mcp/transport.ts` 追加 HttpTransport + parseSseData**

```ts
// 从 SSE 文本里抽出所有 data: 行的内容
export function parseSseData(body: string): string[] {
  const out: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("data:")) out.push(line.slice(5).trim());
  }
  return out;
}

export class HttpTransport implements Transport {
  private handler: (msg: any) => void = () => {};
  private sessionId?: string;

  constructor(private url: string) {}

  async start(): Promise<void> {
    // HTTP 无需预先建立连接
  }

  onMessage(handler: (msg: any) => void): void {
    this.handler = handler;
  }

  async send(message: unknown): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    // 通知（无 id）：服务端通常回 202 无体，不解析
    if ((message as any)?.id === undefined) return;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const body = await res.text();
      for (const data of parseSseData(body)) {
        try {
          this.handler(JSON.parse(data));
        } catch {
          // 跳过非 JSON 的 data 行
        }
      }
    } else {
      this.handler(await res.json());
    }
  }

  async close(): Promise<void> {
    // 最小实现：无显式会话关闭
  }
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（http 2 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 3 完成，修改 `src/mcp/transport.ts`，新增 `tests/mcp-http.test.ts`。

---

### Task 4: .mcp.json 配置加载

**Files:**
- Create: `src/mcp/config.ts`
- Test: `tests/mcp-config.test.ts`

**Interfaces:**
- Produces:
  - `interface McpServerConfig { name: string; command?: string; args?: string[]; env?: Record<string,string>; url?: string }`
  - `function loadMcpConfig(path: string): Promise<McpServerConfig[]>`（文件不存在 → []；JSON 解析失败 → 抛错）

- [ ] **Step 1: 写失败测试 `tests/mcp-config.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { loadMcpConfig } from "../src/mcp/config.js";

const dir = "tests/.tmp-mcp";
beforeAll(async () => {
  await mkdir(dir, { recursive: true });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadMcpConfig", () => {
  it("文件不存在返回 []", async () => {
    expect(await loadMcpConfig(`${dir}/nope.json`)).toEqual([]);
  });

  it("解析 stdio 与 http 两类配置", async () => {
    await writeFile(
      `${dir}/.mcp.json`,
      JSON.stringify({
        mcpServers: {
          fs: { command: "npx", args: ["-y", "server-fs", "."] },
          remote: { url: "https://x/mcp" },
        },
      })
    );
    const servers = await loadMcpConfig(`${dir}/.mcp.json`);
    expect(servers).toHaveLength(2);
    const fs = servers.find((s) => s.name === "fs")!;
    expect(fs.command).toBe("npx");
    expect(fs.args).toEqual(["-y", "server-fs", "."]);
    expect(servers.find((s) => s.name === "remote")!.url).toBe("https://x/mcp");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/mcp/config.js'`）

- [ ] **Step 3: 实现 `src/mcp/config.ts`**

```ts
import { readFile } from "node:fs/promises";

export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export async function loadMcpConfig(path: string): Promise<McpServerConfig[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return []; // 文件不存在 → 无 MCP server
  }
  const parsed = JSON.parse(raw); // 解析失败抛错，交由调用方处理
  const servers = (parsed && parsed.mcpServers) || {};
  return Object.entries(servers).map(([name, cfg]) => {
    const c = cfg as Record<string, unknown>;
    return {
      name,
      command: c.command as string | undefined,
      args: c.args as string[] | undefined,
      env: c.env as Record<string, string> | undefined,
      url: c.url as string | undefined,
    };
  });
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（config 2 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 4 完成，新增 `src/mcp/config.ts`、`tests/mcp-config.test.ts`。

---

### Task 5: 工具包装与注册

**Files:**
- Create: `src/mcp/register.ts`
- Test: `tests/mcp-register.test.ts`

**Interfaces:**
- Consumes: `Tool`/`ToolRegistry`（`src/tools/registry.js`）、`McpClient`（T1）、`McpServerConfig`（T4）、`StdioTransport`/`HttpTransport`/`Transport`（T1-T3）。
- Produces:
  - `function wrapMcpTool(client: McpClient, serverName: string, def: { name: string; description?: string; inputSchema?: Record<string,unknown> }): Tool`
  - `function connectAndRegisterMcp(servers: McpServerConfig[], registry: ToolRegistry, log: (msg: string) => void): Promise<McpClient[]>`

- [ ] **Step 1: 写失败测试 `tests/mcp-register.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/mcp/register.js'`）

- [ ] **Step 3: 实现 `src/mcp/register.ts`**

```ts
import { Tool, ToolRegistry } from "../tools/registry.js";
import { McpClient, McpToolDef } from "./client.js";
import { McpServerConfig } from "./config.js";
import { StdioTransport, HttpTransport, Transport } from "./transport.js";

function makeTransport(cfg: McpServerConfig): Transport {
  if (cfg.url) return new HttpTransport(cfg.url);
  if (cfg.command) return new StdioTransport(cfg.command, cfg.args ?? [], cfg.env);
  throw new Error(`MCP server "${cfg.name}" 配置缺少 command 或 url`);
}

export function wrapMcpTool(client: McpClient, serverName: string, def: McpToolDef): Tool {
  return {
    isWriteOrExec: true,
    schema: {
      type: "function",
      function: {
        name: `mcp__${serverName}__${def.name}`,
        description: def.description ?? "",
        parameters: def.inputSchema ?? { type: "object", properties: {} },
      },
    },
    async execute(args) {
      return client.callTool(def.name, args);
    },
  };
}

export async function connectAndRegisterMcp(
  servers: McpServerConfig[],
  registry: ToolRegistry,
  log: (msg: string) => void
): Promise<McpClient[]> {
  const clients: McpClient[] = [];
  for (const cfg of servers) {
    try {
      const client = new McpClient(makeTransport(cfg));
      await client.connect();
      const tools = await client.listTools();
      for (const t of tools) registry.register(wrapMcpTool(client, cfg.name, t));
      clients.push(client);
      log(`已连接 MCP server "${cfg.name}"（${tools.length} 个工具）`);
    } catch (e) {
      log(`连接 MCP server "${cfg.name}" 失败，已跳过：${(e as Error).message}`);
    }
  }
  return clients;
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（register 4 个用例 + 其余全部）；tsc 无错误。

> 注：`connectAndRegisterMcp` 集成用例依赖 Task 2 的 `tests/fixtures/mock-mcp-server.mjs`。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 5 完成，新增 `src/mcp/register.ts`、`tests/mcp-register.test.ts`。

---

### Task 6: index 集成 —— 启动连接 + 退出清理

**Files:**
- Modify: `src/index.ts`
- 无新增单测（集成 + 真实子进程），靠全量测试 + 编译 + 手动验收。

**Interfaces:**
- Consumes: `loadMcpConfig`（T4）、`connectAndRegisterMcp`（T5）、`McpClient`（T1）。

- [ ] **Step 1: 顶部 import 增加**

```ts
import { join } from "node:path";
import { loadMcpConfig } from "./mcp/config.js";
import { connectAndRegisterMcp } from "./mcp/register.js";
import { McpClient } from "./mcp/client.js";
```

- [ ] **Step 2: 启动时连接并注册 MCP（在 `ui` 创建之后、「void-code 已启动」横幅之前插入）**

在 `ui.info(\`void-code 已启动（模型 ${config.model}）…\`)` 这一行**之前**插入：
```ts
  let mcpClients: McpClient[] = [];
  try {
    const servers = await loadMcpConfig(join(process.cwd(), ".mcp.json"));
    if (servers.length > 0) {
      ui.info(`正在连接 ${servers.length} 个 MCP server…`);
      mcpClients = await connectAndRegisterMcp(servers, registry, (m) => ui.info(m));
    }
  } catch (e) {
    ui.info(`读取 .mcp.json 失败，已跳过 MCP：${(e as Error).message}`);
  }
```
（注意：此处 `registry` 已注册完本地工具，MCP 工具追加进同一个 `registry`；`ui` 已创建。）

- [ ] **Step 3: 退出时清理 MCP 连接（`while` 循环之后、`ui.close()` 之前）**

把结尾的：
```ts
  ui.close();
}
```
改为：
```ts
  for (const c of mcpClients) {
    await c.close().catch(() => {});
  }
  ui.close();
}
```

- [ ] **Step 4: 全量测试 + 编译**

Run: `npm test && npm run build`
Expected: 所有单测 PASS；tsc 无错误。

- [ ] **Step 5: 手动验收（需用户执行）**

1. 在项目根建 `.mcp.json`：
   ```json
   { "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] } } }
   ```
2. `npm run dev` → 启动时应看到「正在连接 1 个 MCP server…」「已连接 MCP server "filesystem"（N 个工具）」。
3. `/tools` → 列表里应出现 `mcp__filesystem__*` 工具。
4. 让模型「用 filesystem 这个 MCP 工具列一下当前目录 / 读某文件」→ 应触发 `mcp__filesystem__*`（写/执行类会弹 y/n），返回结果。
5. 把 `.mcp.json` 改成一个连不上的 server（如 `{"mcpServers":{"bad":{"command":"nope"}}}`）→ 启动应打印「连接失败，已跳过」且主程序正常可用。
6. 退出后确认没有遗留的 MCP server 子进程（`ps` 查无 npx/server-filesystem 残留）。

- [ ] **Step 6: 报告完成（不自动提交）**

报告：Task 6 完成，修改 `src/index.ts`，附手动验收结果。

---

## Self-Review

**Spec 覆盖检查：**
- Transport 接口 → T1；StdioTransport → T2；HttpTransport + SSE 解析 → T3 ✅
- McpClient（JSON-RPC 关联/initialize 握手/listTools/callTool/错误格式化）→ T1（假 Transport）+ T2（stdio 集成）+ T3（http 集成）✅
- .mcp.json 加载（stdio/http/缺失[]）→ T4 ✅
- 工具包装命名/默认确认/execute 调 callTool + 容错跳过 → T5 ✅
- index 启动连接 + 退出清理子进程 → T6 ✅
- 协议版本 2024-11-05、命名 mcp__server__tool、isWriteOrExec true、只接 tools → T1/T5 体现 ✅
- 验收标准每条均有任务对应 + T6 Step 5 手动核对 ✅

**占位符扫描：** 无 TBD/TODO/「类似上面」；每个代码步骤均有完整代码。✅

**类型一致性：** `Transport{start,send,onMessage,close}`、`McpToolDef{name,description?,inputSchema?}`、`McpClient(transport,clientInfo?)` + connect/listTools/callTool/close、`StdioTransport(command,args?,env?)`、`HttpTransport(url)`、`parseSseData(body):string[]`、`McpServerConfig{name,command?,args?,env?,url?}`、`loadMcpConfig(path):Promise<McpServerConfig[]>`、`wrapMcpTool(client,serverName,def):Tool`、`connectAndRegisterMcp(servers,registry,log):Promise<McpClient[]>` 在各任务与 index 间一致。MCP 工具走现有 `Tool` 接口与 `ToolRegistry.register`（既有签名）。✅
