# void-code MCP 接入 设计文档

- **日期**: 2026-06-25
- **定位**: 手写最小 MCP 客户端，把外部 MCP server 的工具接进 void-code（学习 MCP 协议原理）
- **前置**: 全部前序功能已完成，89 单测全绿，代码已推到 GitHub。

## 目标

连接项目 `.mcp.json` 配置的 MCP server，把它们的 tools 注册进现有 `ToolRegistry`，模型即可像调本地工具一样调用。手写 JSON-RPC 核心 + stdio/HTTP 两种传输，理解 MCP 在线协议。

## 架构（新增 `src/mcp/`）

```
.mcp.json → loadMcpConfig() → McpServerConfig[]
   ↓ （每个 server）
Transport（StdioTransport | HttpTransport，实现统一接口）
   ↑↓ JSON-RPC 消息
McpClient：connect(initialize 握手) → listTools() → callTool()
   ↓
connectAndRegisterMcp：把每个 MCP 工具包装成 Tool 注册进 ToolRegistry
   ↓
模型像调本地工具一样调 mcp__<server>__<tool>
```

## 接口定义

### Transport（`src/mcp/transport.ts`）
传输无关的双向消息通道，JSON-RPC 核心只依赖它：
```ts
export interface Transport {
  start(): Promise<void>;                          // 建立连接（stdio: spawn 子进程；http: no-op）
  send(message: unknown): Promise<void>;           // 发一条 JSON-RPC 消息
  onMessage(handler: (msg: any) => void): void;    // 注册接收回调
  close(): Promise<void>;                          // 关闭（stdio: kill 子进程）
}
```
- `StdioTransport`：`spawn(command, args, {env})`；`send` = 写 `JSON.stringify(msg)+"\n"` 到 stdin；接收 = 缓冲 stdout、按 `\n` 切分、逐条 `JSON.parse` 后回调（MCP stdio 是**换行分隔的 JSON-RPC**）；stderr 忽略；`close` kill 子进程。
- `HttpTransport`：最小 Streamable HTTP。`send` = POST 到 url，body 为 JSON-RPC，headers `Content-Type: application/json`、`Accept: application/json, text/event-stream`、（有则）`Mcp-Session-Id`。响应是 `application/json` → 解析单条消息回调；是 `text/event-stream` → 解析 SSE 的 `data:` 行回调。initialize 响应里的 `Mcp-Session-Id` 头存下、后续请求带上。通知（无 id）POST 后忽略响应体。

### McpClient（`src/mcp/client.ts`）
```ts
export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class McpClient {
  constructor(transport: Transport, clientInfo?: { name: string; version: string });
  connect(): Promise<void>;                        // start() + initialize 握手 + notifications/initialized
  listTools(): Promise<McpToolDef[]>;              // tools/list
  callTool(name: string, args: Record<string, unknown>): Promise<string>;  // tools/call → 格式化成字符串
  close(): Promise<void>;
}
```
- JSON-RPC：自增 id，维护 `id → {resolve, reject}`；`onMessage` 收到带 id 的消息按 id 匹配 resolve（有 `error` 则 reject）；无 id 的通知忽略。
- `initialize` 请求 params：`{ protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "void-code", version: "0.1.0" } }`，握手成功后发 `notifications/initialized`。
- `callTool` 把返回的 `{ content: [{type, text}], isError? }` 格式化：拼接所有 `type==="text"` 的 `text`；非文本内容标注 `[非文本内容: <type>]`；`isError` 为真时整体前缀「错误：」。

### 配置（`src/mcp/config.ts`）
```ts
export interface McpServerConfig {
  name: string;
  command?: string;       // stdio
  args?: string[];        // stdio
  env?: Record<string, string>;  // stdio
  url?: string;           // http
}
export async function loadMcpConfig(path: string): Promise<McpServerConfig[]>;
```
- 读 `<cwd>/.mcp.json`，格式仿 Claude Code：
  ```json
  { "mcpServers": {
      "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
      "remote": { "url": "https://example.com/mcp" }
  }}
  ```
- 文件不存在 → 返回 `[]`。JSON 解析失败 → 抛错（由 index 捕获并警告，不崩主程序）。
- 有 `command` 视为 stdio，有 `url` 视为 http。

### 注册（`src/mcp/register.ts`）
```ts
export async function connectAndRegisterMcp(
  servers: McpServerConfig[],
  registry: ToolRegistry,
  log: (msg: string) => void
): Promise<McpClient[]>;
```
- 对每个 server：建 Transport（按有无 command/url）→ `new McpClient` → `connect()` → `listTools()` → 每个工具包装成 `Tool` 注册：
  - 名称：`mcp__<server.name>__<tool.name>`
  - `isWriteOrExec: true`（MCP 工具无法预知副作用，默认需 y/n 确认）
  - `schema.function.parameters` = `tool.inputSchema`（缺省则 `{ type: "object", properties: {} }`）
  - `execute(args)` = `client.callTool(tool.name, args)`
- 某 server 连接/列举失败 → `log` 警告并跳过，不影响其余 server 与主程序。
- 返回成功连接的 `McpClient[]`（供退出时清理）。

### index 集成（`src/index.ts`）
- 注册本地工具后：`const servers = await loadMcpConfig(join(cwd, ".mcp.json"))`（try/catch 警告）；`const mcpClients = await connectAndRegisterMcp(servers, registry, (m)=>ui.info(m))`。连接前后用 `ui.info` 提示。
- 退出时（while 循环结束、`ui.close()` 之前）：`for (const c of mcpClients) await c.close().catch(()=>{})`，杀掉 stdio 子进程，避免僵尸进程。

## 范围（YAGNI）

- 只接 MCP 的 **tools**，不做 resources / prompts / sampling。
- HTTP 传输做**请求/响应导向的最小 Streamable HTTP**（够调工具），不实现服务端长连接推送/通知流。
- 不做 OAuth；HTTP server 若需鉴权头，本期不支持（未来可加）。
- 协议版本固定 `2024-11-05`。

## 测试策略

- **单测（假 Transport）**：`McpClient` 的 JSON-RPC 关联、initialize 握手、listTools、callTool 文本格式化、错误响应 reject —— 用一个测试用 `FakeTransport`（`send` 时把预设响应塞回 `onMessage`）。
- **集成（mock server）**：`tests/fixtures/mock-mcp-server.mjs` —— 一个极小的、读换行 JSON-RPC、回应 initialize/tools/list/tools/call 的脚本；用 `StdioTransport` + `McpClient` spawn 它，验证 connect/listTools/callTool。
- **HttpTransport**：测试内 `http.createServer` 起临时服务，回 JSON-RPC 响应，验证 connect/listTools/callTool 走 HTTP（JSON 响应路径）。
- **config**：`.mcp.json` 解析（stdio 项 / http 项 / 文件不存在 → []）。
- **register**：用假 `McpClient` 验证工具命名 `mcp__server__tool`、`isWriteOrExec: true`、`execute` 调 `callTool`。
- **手动验收**：真实接 `@modelcontextprotocol/server-filesystem`，让模型用 MCP 工具读/列文件。

## 验收标准

- [ ] `McpClient` 能完成 initialize 握手、listTools、callTool（假 Transport 单测验证）。
- [ ] `StdioTransport` 能 spawn mock server 并往返一次完整 tools/call（集成测试）。
- [ ] `HttpTransport` 能对一个本地 http server 完成一次 tools/call。
- [ ] `.mcp.json` 能正确解析 stdio 与 http 两类配置；缺失返回 []。
- [ ] MCP 工具以 `mcp__<server>__<tool>` 注册进 registry、默认需确认、execute 走 callTool。
- [ ] 启动连接、单个 server 失败可容错跳过；退出时清理子进程。
- [ ] 全量单测通过、`npm run build` 无错；现有功能不回归。
