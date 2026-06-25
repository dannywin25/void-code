# void-code MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在终端里手写一个跑通完整 agentic 编码闭环的 CLI（读/写/执行/搜索四件套工具 + 每次确认权限 + 多轮工具循环），对接免费的智谱 GLM-4-Flash。

**Architecture:** 8 个职责单一的子系统，自上而下：CLI 入口 → 终端 UI(readline) → Agent 主循环 → (Provider 层 + 工具系统) → 权限层 → 会话/上下文 → 系统提示。核心是 Agent 主循环：把 [系统提示+历史+工具定义] 发给模型，模型回工具调用就执行并把结果回填，直到模型给出纯文本回答。

**Tech Stack:** TypeScript + Node.js (ESM)、`openai` npm 包（指向 GLM 的 OpenAI 兼容端点）、`vitest` 测试、`tsx` 运行。

## Global Constraints

- **运行时**：Node.js ≥ 20，ESM（`package.json` 里 `"type": "module"`），TypeScript `moduleResolution: "NodeNext"`，源码内部 import 一律带 `.js` 后缀。
- **模型接入**：`baseURL = https://open.bigmodel.cn/api/paas/v4`，`model = glm-4-flash`，API Key 从环境变量 `GLM_API_KEY` 读取。
- **测试框架**：`vitest`，测试文件放 `tests/` 下，命名 `*.test.ts`。
- **工具结果一律返回字符串**：成功输出或可读错误信息；工具层永不抛异常导致进程崩溃（错误转成给模型的反馈）。
- **语言**：面向用户的提示文案、系统提示用中文；代码标识符用英文。
- **提交策略（重要，覆盖默认）**：根据用户全局规则，**禁止自动 `git commit` / `git push`**。本计划每个任务的最后一步是「向用户报告完成并列出改动文件，由用户自行提交」，**绝不自动提交**。

---

## File Structure

```
void-code/
├── package.json                 # Task 1
├── tsconfig.json                # Task 1
├── vitest.config.ts             # Task 1
├── .env.example                 # Task 1
└── src/
    ├── config.ts                # Task 1   配置加载
    ├── provider/
    │   ├── types.ts             # Task 2   Provider/消息/工具 类型
    │   ├── assemble.ts          # Task 2   流式分片 → {text, toolCalls}
    │   └── openai-compatible.ts # Task 3   openai SDK 客户端
    ├── tools/
    │   ├── registry.ts          # Task 4   工具注册表 + 执行/错误处理
    │   ├── read.ts              # Task 5   read_file
    │   ├── write.ts             # Task 6   write_file + edit_file
    │   ├── bash.ts              # Task 7   bash
    │   └── search.ts            # Task 8   search
    ├── permission/
    │   └── approve.ts           # Task 9   权限审批
    ├── context/
    │   ├── session.ts           # Task 10  messages 历史
    │   └── system-prompt.ts     # Task 10  系统提示拼装
    ├── agent/
    │   └── loop.ts              # Task 11  Agent 主循环
    ├── ui/
    │   └── terminal.ts          # Task 12  readline + 渲染 + confirm
    └── index.ts                 # Task 13  CLI 入口（串联所有）
```

---

### Task 1: 项目脚手架 + 配置加载

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）。
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): Config`；`interface Config { apiKey: string; baseURL: string; model: string; maxTokens: number; maxIterations: number }`。

- [ ] **Step 1: 初始化项目与依赖**

```bash
cd /Users/daguang.li/workspace/void-code
git init
npm init -y
npm install openai
npm install -D typescript tsx vitest @types/node
```

- [ ] **Step 2: 写 `package.json`（覆盖 scripts 与 type）**

把 `package.json` 改成（保留 npm 写入的 dependencies 版本号，只调整以下字段）：

```json
{
  "name": "void-code",
  "version": "0.1.0",
  "type": "module",
  "bin": { "void-code": "./dist/index.js" },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 写 `vitest.config.ts` 和 `.env.example`**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

`.env.example`:

```
# 到 https://open.bigmodel.cn 注册获取免费 API Key
GLM_API_KEY=your-key-here
# 可选覆盖项
# GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
# GLM_MODEL=glm-4-flash
```

- [ ] **Step 5: 写失败测试 `tests/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("缺少 GLM_API_KEY 时抛出可读错误", () => {
    expect(() => loadConfig({})).toThrow(/GLM_API_KEY/);
  });

  it("有 key 时返回默认配置", () => {
    const cfg = loadConfig({ GLM_API_KEY: "k" });
    expect(cfg.apiKey).toBe("k");
    expect(cfg.baseURL).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(cfg.model).toBe("glm-4-flash");
    expect(cfg.maxIterations).toBe(25);
  });

  it("环境变量可覆盖默认值", () => {
    const cfg = loadConfig({ GLM_API_KEY: "k", GLM_MODEL: "glm-4-air", VOID_MAX_ITERATIONS: "10" });
    expect(cfg.model).toBe("glm-4-air");
    expect(cfg.maxIterations).toBe(10);
  });
});
```

- [ ] **Step 6: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/config.js'`）

- [ ] **Step 7: 实现 `src/config.ts`**

```ts
export interface Config {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens: number;
  maxIterations: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.GLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少环境变量 GLM_API_KEY。请到 https://open.bigmodel.cn 注册获取免费 API Key，然后设置：export GLM_API_KEY=你的key"
    );
  }
  return {
    apiKey,
    baseURL: env.GLM_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    model: env.GLM_MODEL ?? "glm-4-flash",
    maxTokens: Number(env.GLM_MAX_TOKENS ?? 4096),
    maxIterations: Number(env.VOID_MAX_ITERATIONS ?? 25),
  };
}
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npm test`
Expected: PASS（3 个用例）

- [ ] **Step 9: 报告完成（不自动提交）**

向用户报告：Task 1 完成，新增 `package.json`、`tsconfig.json`、`vitest.config.ts`、`.env.example`、`src/config.ts`、`tests/config.test.ts`。请用户自行 `git add`/`commit`。

---

### Task 2: Provider 类型 + 流式分片拼装器

**Files:**
- Create: `src/provider/types.ts`, `src/provider/assemble.ts`
- Test: `tests/assemble.test.ts`

**Interfaces:**
- Consumes: 无外部依赖。
- Produces:
  - `interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }`
  - `interface ChatMessage { role: "system"|"user"|"assistant"|"tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }`
  - `interface ToolSchema { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }`
  - `interface ChatResult { text: string; toolCalls: ToolCall[] }`
  - `interface ChatParams { messages: ChatMessage[]; tools: ToolSchema[]; onTextDelta?: (delta: string) => void }`
  - `interface Provider { chat(params: ChatParams): Promise<ChatResult> }`
  - `interface StreamDelta { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }`
  - `class StreamAssembler { addDelta(delta: StreamDelta, onText?: (d: string) => void): void; result(): ChatResult }`

- [ ] **Step 1: 写 `src/provider/types.ts`**

```ts
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
}

export interface ChatParams {
  messages: ChatMessage[];
  tools: ToolSchema[];
  onTextDelta?: (delta: string) => void;
}

export interface Provider {
  chat(params: ChatParams): Promise<ChatResult>;
}
```

- [ ] **Step 2: 写失败测试 `tests/assemble.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { StreamAssembler } from "../src/provider/assemble.js";

describe("StreamAssembler", () => {
  it("拼接文本增量并触发 onText 回调", () => {
    const a = new StreamAssembler();
    const seen: string[] = [];
    a.addDelta({ content: "你" }, (d) => seen.push(d));
    a.addDelta({ content: "好" }, (d) => seen.push(d));
    const r = a.result();
    expect(r.text).toBe("你好");
    expect(seen).toEqual(["你", "好"]);
    expect(r.toolCalls).toEqual([]);
  });

  it("按 index 累加分片的 tool_call arguments", () => {
    const a = new StreamAssembler();
    a.addDelta({ tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"pa' } }] });
    a.addDelta({ tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] });
    const r = a.result();
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].id).toBe("call_1");
    expect(r.toolCalls[0].function.name).toBe("read_file");
    expect(r.toolCalls[0].function.arguments).toBe('{"path":"a.ts"}');
  });

  it("支持同一响应里的多个并行 tool_call", () => {
    const a = new StreamAssembler();
    a.addDelta({ tool_calls: [{ index: 0, id: "c0", function: { name: "read_file", arguments: "{}" } }] });
    a.addDelta({ tool_calls: [{ index: 1, id: "c1", function: { name: "bash", arguments: "{}" } }] });
    const r = a.result();
    expect(r.toolCalls.map((t) => t.id)).toEqual(["c0", "c1"]);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/provider/assemble.js'`）

- [ ] **Step 4: 实现 `src/provider/assemble.ts`**

```ts
import { ChatResult, ToolCall } from "./types.js";

export interface StreamDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

export class StreamAssembler {
  private text = "";
  private toolCalls: ToolCall[] = [];

  addDelta(delta: StreamDelta, onText?: (d: string) => void): void {
    if (delta.content) {
      this.text += delta.content;
      onText?.(delta.content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        let existing = this.toolCalls[tc.index];
        if (!existing) {
          existing = { id: "", type: "function", function: { name: "", arguments: "" } };
          this.toolCalls[tc.index] = existing;
        }
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  result(): ChatResult {
    return { text: this.text, toolCalls: this.toolCalls.filter(Boolean) };
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: PASS（assemble 的 3 个用例 + config 的 3 个用例）

- [ ] **Step 6: 报告完成（不自动提交）**

报告：Task 2 完成，新增 `src/provider/types.ts`、`src/provider/assemble.ts`、`tests/assemble.test.ts`。

---

### Task 3: OpenAI 兼容 Provider 客户端

**Files:**
- Create: `src/provider/openai-compatible.ts`
- Test: `tests/openai-compatible.test.ts`

**Interfaces:**
- Consumes: `Provider`、`ChatParams`、`ChatResult`（Task 2）；`StreamAssembler`（Task 2）；`openai` 包。
- Produces: `class OpenAICompatibleProvider implements Provider`，构造参数 `{ apiKey: string; baseURL: string; model: string; maxTokens: number }`。

> 说明：用官方 `openai` 包做传输（鉴权/请求构造/SSE 解码），但 tool_calls 的分片拼装仍由我们自己的 `StreamAssembler` 完成（Task 2 已测）。本任务只验证「把 SDK 的流式 chunk 喂给 assembler 并产出 ChatResult」这层接线，用注入式 streamFactory 做单测，避免真实联网。

- [ ] **Step 1: 写失败测试 `tests/openai-compatible.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { OpenAICompatibleProvider } from "../src/provider/openai-compatible.js";

// 伪造一个 OpenAI 流式响应（async iterable of chunks）
async function* fakeStream() {
  yield { choices: [{ delta: { content: "处理中" } }] };
  yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: '{"path":"a"}' } }] } }] };
}

describe("OpenAICompatibleProvider", () => {
  it("把流式 chunk 拼装成 ChatResult，并回调文本增量", async () => {
    const provider = new OpenAICompatibleProvider(
      { apiKey: "k", baseURL: "http://x", model: "glm-4-flash", maxTokens: 100 },
      // 注入 streamFactory，绕过真实网络
      async () => fakeStream() as any
    );
    const seen: string[] = [];
    const result = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      onTextDelta: (d) => seen.push(d),
    });
    expect(result.text).toBe("处理中");
    expect(seen).toEqual(["处理中"]);
    expect(result.toolCalls[0].function.name).toBe("read_file");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/provider/openai-compatible.js'`）

- [ ] **Step 3: 实现 `src/provider/openai-compatible.ts`**

```ts
import OpenAI from "openai";
import { Provider, ChatParams, ChatResult } from "./types.js";
import { StreamAssembler, StreamDelta } from "./assemble.js";

interface ProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens: number;
}

// 流式分片的最小形状（与 openai chunk 兼容）
interface StreamChunk {
  choices: Array<{ delta?: StreamDelta }>;
}

type StreamFactory = (params: ChatParams) => Promise<AsyncIterable<StreamChunk>>;

export class OpenAICompatibleProvider implements Provider {
  private readonly streamFactory: StreamFactory;

  constructor(private opts: ProviderOptions, streamFactory?: StreamFactory) {
    const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.streamFactory =
      streamFactory ??
      (async (params) =>
        (await client.chat.completions.create({
          model: opts.model,
          messages: params.messages as any,
          tools: params.tools.length ? (params.tools as any) : undefined,
          max_tokens: opts.maxTokens,
          stream: true,
        })) as unknown as AsyncIterable<StreamChunk>);
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const stream = await this.streamFactory(params);
    const assembler = new StreamAssembler();
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta) assembler.addDelta(delta, params.onTextDelta);
    }
    return assembler.result();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 3 完成，新增 `src/provider/openai-compatible.ts`、`tests/openai-compatible.test.ts`。

---

### Task 4: 工具注册表 + 执行/错误处理

**Files:**
- Create: `src/tools/registry.ts`
- Test: `tests/registry.test.ts`

**Interfaces:**
- Consumes: `ToolCall`、`ToolSchema`（Task 2）。
- Produces:
  - `interface Tool { schema: ToolSchema; isWriteOrExec: boolean; execute(args: Record<string, unknown>): Promise<string> }`
  - `class ToolRegistry`，方法：`register(tool: Tool): void`、`schemas(): ToolSchema[]`、`isWriteOrExec(name: string): boolean`、`execute(call: ToolCall): Promise<string>`。

- [ ] **Step 1: 写失败测试 `tests/registry.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { ToolRegistry, Tool } from "../src/tools/registry.js";
import { ToolCall } from "../src/provider/types.js";

function call(name: string, args: string): ToolCall {
  return { id: "c", type: "function", function: { name, arguments: args } };
}

const echoTool: Tool = {
  isWriteOrExec: false,
  schema: { type: "function", function: { name: "echo", description: "回显", parameters: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } } },
  async execute(args) {
    if (!args.msg) return "错误：缺少必填参数 msg";
    return `echo: ${args.msg}`;
  },
};

const boomTool: Tool = {
  isWriteOrExec: true,
  schema: { type: "function", function: { name: "boom", description: "炸", parameters: { type: "object", properties: {} } } },
  async execute() {
    throw new Error("kaboom");
  },
};

describe("ToolRegistry", () => {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  reg.register(boomTool);

  it("schemas 返回所有已注册工具", () => {
    expect(reg.schemas().map((s) => s.function.name).sort()).toEqual(["boom", "echo"]);
  });

  it("isWriteOrExec 反映工具风险级别", () => {
    expect(reg.isWriteOrExec("echo")).toBe(false);
    expect(reg.isWriteOrExec("boom")).toBe(true);
  });

  it("正常执行返回工具输出", async () => {
    expect(await reg.execute(call("echo", '{"msg":"hi"}'))).toBe("echo: hi");
  });

  it("未知工具返回错误而不抛", async () => {
    expect(await reg.execute(call("nope", "{}"))).toMatch(/未知工具/);
  });

  it("非法 JSON 参数返回错误而不抛", async () => {
    expect(await reg.execute(call("echo", "{not json"))).toMatch(/合法 JSON/);
  });

  it("工具内部抛异常被捕获为错误字符串", async () => {
    expect(await reg.execute(call("boom", "{}"))).toMatch(/kaboom/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/tools/registry.js'`）

- [ ] **Step 3: 实现 `src/tools/registry.ts`**

```ts
import { ToolCall, ToolSchema } from "../provider/types.js";

export interface Tool {
  schema: ToolSchema;
  isWriteOrExec: boolean;
  execute(args: Record<string, unknown>): Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.schema.function.name, tool);
  }

  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => t.schema);
  }

  isWriteOrExec(name: string): boolean {
    return this.tools.get(name)?.isWriteOrExec ?? false;
  }

  async execute(call: ToolCall): Promise<string> {
    const tool = this.tools.get(call.function.name);
    if (!tool) return `错误：未知工具 "${call.function.name}"`;

    let args: Record<string, unknown>;
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return `错误：工具参数不是合法 JSON：${call.function.arguments}`;
    }

    try {
      return await tool.execute(args);
    } catch (e) {
      return `错误：工具执行失败：${(e as Error).message}`;
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（registry 的 6 个用例）

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 4 完成，新增 `src/tools/registry.ts`、`tests/registry.test.ts`。

---

### Task 5: read_file 工具

**Files:**
- Create: `src/tools/read.ts`
- Test: `tests/read.test.ts`

**Interfaces:**
- Consumes: `Tool`（Task 4）。
- Produces: `export const readFileTool: Tool`（工具名 `read_file`，参数 `{ path: string }`，`isWriteOrExec: false`）。

- [ ] **Step 1: 写失败测试 `tests/read.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { readFileTool } from "../src/tools/read.js";

const dir = "tests/.tmp-read";

beforeAll(async () => {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/a.txt`, "line1\nline2\nline3");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readFileTool", () => {
  it("返回带行号的内容", async () => {
    const out = await readFileTool.execute({ path: `${dir}/a.txt` });
    expect(out).toContain("1\tline1");
    expect(out).toContain("3\tline3");
  });

  it("缺 path 返回错误字符串", async () => {
    expect(await readFileTool.execute({})).toMatch(/缺少必填参数 path/);
  });

  it("文件不存在时抛错（交由 registry 捕获）", async () => {
    await expect(readFileTool.execute({ path: `${dir}/nope.txt` })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/tools/read.js'`）

- [ ] **Step 3: 实现 `src/tools/read.ts`**

```ts
import { readFile } from "node:fs/promises";
import { Tool } from "./registry.js";

const MAX_LINES = 2000;

export const readFileTool: Tool = {
  isWriteOrExec: false,
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description: "读取指定文件的全部内容，返回带行号的文本。用于在修改前查看文件。",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "文件路径（相对当前目录或绝对路径）" } },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return "错误：缺少必填参数 path";

    const content = await readFile(path, "utf8");
    const lines = content.split("\n");
    const shown = lines.slice(0, MAX_LINES);
    const numbered = shown.map((l, i) => `${i + 1}\t${l}`).join("\n");
    const truncated = lines.length > MAX_LINES ? `\n...（已截断，共 ${lines.length} 行）` : "";
    return numbered + truncated;
  },
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 5 完成，新增 `src/tools/read.ts`、`tests/read.test.ts`。

---

### Task 6: write_file + edit_file 工具

**Files:**
- Create: `src/tools/write.ts`
- Test: `tests/write.test.ts`

**Interfaces:**
- Consumes: `Tool`（Task 4）。
- Produces:
  - `export const writeFileTool: Tool`（工具名 `write_file`，参数 `{ path: string; content: string }`，`isWriteOrExec: true`）
  - `export const editFileTool: Tool`（工具名 `edit_file`，参数 `{ path: string; old_string: string; new_string: string }`，`isWriteOrExec: true`，要求 `old_string` 在文件中唯一）

- [ ] **Step 1: 写失败测试 `tests/write.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { writeFileTool, editFileTool } from "../src/tools/write.js";

const dir = "tests/.tmp-write";

beforeEach(async () => {
  await mkdir(dir, { recursive: true });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileTool", () => {
  it("写入新文件", async () => {
    const out = await writeFileTool.execute({ path: `${dir}/new.txt`, content: "hello" });
    expect(out).toMatch(/已写入/);
    expect(await readFile(`${dir}/new.txt`, "utf8")).toBe("hello");
  });

  it("缺参数返回错误", async () => {
    expect(await writeFileTool.execute({ path: `${dir}/x.txt` })).toMatch(/缺少必填参数/);
  });
});

describe("editFileTool", () => {
  it("唯一匹配时替换成功", async () => {
    await writeFile(`${dir}/e.txt`, "foo bar baz");
    const out = await editFileTool.execute({ path: `${dir}/e.txt`, old_string: "bar", new_string: "QUX" });
    expect(out).toMatch(/已编辑/);
    expect(await readFile(`${dir}/e.txt`, "utf8")).toBe("foo QUX baz");
  });

  it("匹配不到时返回错误且不改文件", async () => {
    await writeFile(`${dir}/e2.txt`, "abc");
    const out = await editFileTool.execute({ path: `${dir}/e2.txt`, old_string: "zzz", new_string: "x" });
    expect(out).toMatch(/未找到/);
    expect(await readFile(`${dir}/e2.txt`, "utf8")).toBe("abc");
  });

  it("匹配多处时报错要求唯一", async () => {
    await writeFile(`${dir}/e3.txt`, "x x x");
    const out = await editFileTool.execute({ path: `${dir}/e3.txt`, old_string: "x", new_string: "y" });
    expect(out).toMatch(/多处/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/tools/write.js'`）

- [ ] **Step 3: 实现 `src/tools/write.ts`**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { Tool } from "./registry.js";

export const writeFileTool: Tool = {
  isWriteOrExec: true,
  schema: {
    type: "function",
    function: {
      name: "write_file",
      description: "把内容写入文件（覆盖整个文件，文件不存在则创建）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          content: { type: "string", description: "完整的文件内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  async execute(args) {
    const path = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : null;
    if (!path || content === null) return "错误：缺少必填参数 path 或 content";
    await writeFile(path, content, "utf8");
    return `已写入 ${path}（${content.length} 字符）`;
  },
};

export const editFileTool: Tool = {
  isWriteOrExec: true,
  schema: {
    type: "function",
    function: {
      name: "edit_file",
      description: "对文件做精确替换：把 old_string 替换为 new_string。old_string 必须在文件中唯一出现。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          old_string: { type: "string", description: "要被替换的原文（需在文件中唯一）" },
          new_string: { type: "string", description: "替换后的新文本" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  async execute(args) {
    const path = typeof args.path === "string" ? args.path : "";
    const oldStr = typeof args.old_string === "string" ? args.old_string : "";
    const newStr = typeof args.new_string === "string" ? args.new_string : "";
    if (!path || !oldStr) return "错误：缺少必填参数 path 或 old_string";

    const content = await readFile(path, "utf8");
    const count = content.split(oldStr).length - 1;
    if (count === 0) return `错误：在 ${path} 中未找到要替换的内容。`;
    if (count > 1) return `错误：old_string 在 ${path} 中出现了 ${count} 处（多处），请提供更长、唯一的片段。`;

    await writeFile(path, content.replace(oldStr, newStr), "utf8");
    return `已编辑 ${path}`;
  },
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（write/edit 共 5 个用例）

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 6 完成，新增 `src/tools/write.ts`、`tests/write.test.ts`。

---

### Task 7: bash 工具

**Files:**
- Create: `src/tools/bash.ts`
- Test: `tests/bash.test.ts`

**Interfaces:**
- Consumes: `Tool`（Task 4）。
- Produces: `export const bashTool: Tool`（工具名 `bash`，参数 `{ command: string }`，`isWriteOrExec: true`，30s 超时，命令失败不抛、返回含 exit code 的结果字符串）。

- [ ] **Step 1: 写失败测试 `tests/bash.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { bashTool } from "../src/tools/bash.js";

describe("bashTool", () => {
  it("执行成功命令返回 stdout", async () => {
    const out = await bashTool.execute({ command: "echo hello" });
    expect(out).toContain("hello");
    expect(out).toContain("exit 0");
  });

  it("执行失败命令返回非零 exit 和错误（不抛）", async () => {
    const out = await bashTool.execute({ command: "ls /no/such/dir/xyz" });
    expect(out).not.toContain("exit 0");
  });

  it("缺 command 返回错误", async () => {
    expect(await bashTool.execute({})).toMatch(/缺少必填参数 command/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/tools/bash.js'`）

- [ ] **Step 3: 实现 `src/tools/bash.ts`**

```ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "./registry.js";

const execAsync = promisify(exec);

export const bashTool: Tool = {
  isWriteOrExec: true,
  schema: {
    type: "function",
    function: {
      name: "bash",
      description: "在当前工作目录执行一条 shell 命令，返回 stdout、stderr 和退出码。有 30 秒超时。",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "要执行的 shell 命令" } },
        required: ["command"],
      },
    },
  },
  async execute(args) {
    const command = typeof args.command === "string" ? args.command : "";
    if (!command) return "错误：缺少必填参数 command";

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30_000, maxBuffer: 1024 * 1024 });
      return `exit 0\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string; message: string };
      return `exit ${err.code ?? 1}\n--- stdout ---\n${err.stdout ?? ""}\n--- stderr ---\n${err.stderr ?? err.message}`;
    }
  },
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 7 完成，新增 `src/tools/bash.ts`、`tests/bash.test.ts`。

---

### Task 8: search 工具

**Files:**
- Create: `src/tools/search.ts`
- Test: `tests/search.test.ts`

**Interfaces:**
- Consumes: `Tool`（Task 4）。
- Produces: `export const searchTool: Tool`（工具名 `search`，参数 `{ pattern: string; path?: string }`，`isWriteOrExec: false`，递归搜文件内容，按正则匹配，返回 `file:line: 文本`，跳过 `node_modules`/`.git`/`dist`，最多 200 条）。

- [ ] **Step 1: 写失败测试 `tests/search.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { searchTool } from "../src/tools/search.js";

const dir = "tests/.tmp-search";

beforeAll(async () => {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/a.ts`, "const x = 1;\n// TODO: fix this\n");
  await writeFile(`${dir}/b.ts`, "console.log('ok');\n");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("searchTool", () => {
  it("找到匹配行并带文件名与行号", async () => {
    const out = await searchTool.execute({ pattern: "TODO", path: dir });
    expect(out).toContain("a.ts");
    expect(out).toMatch(/:2:/);
  });

  it("无匹配时返回提示", async () => {
    const out = await searchTool.execute({ pattern: "NOTHING_HERE", path: dir });
    expect(out).toMatch(/未找到/);
  });

  it("缺 pattern 返回错误", async () => {
    expect(await searchTool.execute({ path: dir })).toMatch(/缺少必填参数 pattern/);
  });

  it("非法正则被上层 registry 视为异常（execute 抛错）", async () => {
    await expect(searchTool.execute({ pattern: "(", path: dir })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/tools/search.js'`）

- [ ] **Step 3: 实现 `src/tools/search.ts`**

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Tool } from "./registry.js";

const IGNORE = new Set(["node_modules", ".git", "dist"]);
const MAX_RESULTS = 200;

export const searchTool: Tool = {
  isWriteOrExec: false,
  schema: {
    type: "function",
    function: {
      name: "search",
      description: "在目录下递归搜索文件内容（正则匹配），返回匹配的 文件:行号: 文本。默认搜索当前目录。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "正则表达式" },
          path: { type: "string", description: "搜索根目录，默认当前目录" },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args) {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) return "错误：缺少必填参数 pattern";
    const root = typeof args.path === "string" && args.path ? args.path : ".";
    const regex = new RegExp(pattern); // 非法正则会抛，由 registry 捕获

    const results: string[] = [];

    async function walk(dir: string): Promise<void> {
      if (results.length >= MAX_RESULTS) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (IGNORE.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile()) {
          let content: string;
          try {
            content = await readFile(full, "utf8");
          } catch {
            continue; // 二进制/无权限文件跳过
          }
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${full}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= MAX_RESULTS) break;
            }
          }
        }
      }
    }

    await walk(root);

    if (results.length === 0) return `未找到匹配 "${pattern}"`;
    const suffix = results.length >= MAX_RESULTS ? `\n...（已截断，最多 ${MAX_RESULTS} 条）` : "";
    return results.join("\n") + suffix;
  },
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 8 完成，新增 `src/tools/search.ts`、`tests/search.test.ts`。

---

### Task 9: 权限审批层

**Files:**
- Create: `src/permission/approve.ts`
- Test: `tests/approve.test.ts`

**Interfaces:**
- Consumes: `ToolCall`（Task 2）。
- Produces:
  - `interface Confirmer { confirm(message: string): Promise<boolean> }`
  - `function describeCall(call: ToolCall): string`（生成给用户看的操作预览，纯函数）
  - `function approveIfNeeded(call: ToolCall, isWriteOrExec: boolean, confirmer: Confirmer): Promise<boolean>`（读类直接 true；写/执行类调用 confirmer）

- [ ] **Step 1: 写失败测试 `tests/approve.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { approveIfNeeded, describeCall, Confirmer } from "../src/permission/approve.js";
import { ToolCall } from "../src/provider/types.js";

function call(name: string, args: object): ToolCall {
  return { id: "c", type: "function", function: { name, arguments: JSON.stringify(args) } };
}

const yes: Confirmer = { async confirm() { return true; } };
const no: Confirmer = { async confirm() { return false; } };

describe("approveIfNeeded", () => {
  it("读类工具直接放行，不询问", async () => {
    expect(await approveIfNeeded(call("read_file", { path: "a" }), false, no)).toBe(true);
  });

  it("写类工具：用户同意则 true", async () => {
    expect(await approveIfNeeded(call("write_file", { path: "a", content: "x" }), true, yes)).toBe(true);
  });

  it("写类工具：用户拒绝则 false", async () => {
    expect(await approveIfNeeded(call("write_file", { path: "a", content: "x" }), true, no)).toBe(false);
  });
});

describe("describeCall", () => {
  it("bash 显示完整命令", () => {
    expect(describeCall(call("bash", { command: "ls -la" }))).toContain("ls -la");
  });
  it("write_file 显示路径", () => {
    expect(describeCall(call("write_file", { path: "x.txt", content: "hi" }))).toContain("x.txt");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/permission/approve.js'`）

- [ ] **Step 3: 实现 `src/permission/approve.ts`**

```ts
import { ToolCall } from "../provider/types.js";

export interface Confirmer {
  confirm(message: string): Promise<boolean>;
}

function truncate(s: unknown, max: number): string {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export function describeCall(call: ToolCall): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    return `${call.function.name}(参数解析失败：${call.function.arguments})`;
  }
  switch (call.function.name) {
    case "write_file":
      return `写入文件 ${args.path}：\n${truncate(args.content, 500)}`;
    case "edit_file":
      return `编辑文件 ${args.path}：\n- ${truncate(args.old_string, 200)}\n+ ${truncate(args.new_string, 200)}`;
    case "bash":
      return `执行命令：${args.command}`;
    default:
      return `${call.function.name}(${truncate(call.function.arguments, 300)})`;
  }
}

export async function approveIfNeeded(
  call: ToolCall,
  isWriteOrExec: boolean,
  confirmer: Confirmer
): Promise<boolean> {
  if (!isWriteOrExec) return true;
  return confirmer.confirm(describeCall(call));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（approve 共 5 个用例）

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 9 完成，新增 `src/permission/approve.ts`、`tests/approve.test.ts`。

---

### Task 10: 会话历史 + 系统提示

**Files:**
- Create: `src/context/session.ts`, `src/context/system-prompt.ts`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`、`ToolCall`（Task 2）。
- Produces:
  - `class Session`：构造 `(systemPrompt: string)`；`readonly messages: ChatMessage[]`；方法 `addUser(content: string)`、`addAssistant(text: string, toolCalls: ToolCall[])`、`addToolResult(toolCallId: string, content: string)`。
  - `function buildSystemPrompt(cwd: string, platform: string): string`。

- [ ] **Step 1: 写失败测试 `tests/session.test.ts`**

```ts
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
});

describe("buildSystemPrompt", () => {
  it("包含工作目录和操作系统信息", () => {
    const p = buildSystemPrompt("/work/dir", "darwin");
    expect(p).toContain("/work/dir");
    expect(p).toContain("darwin");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/context/session.js'`）

- [ ] **Step 3: 实现 `src/context/session.ts`**

```ts
import { ChatMessage, ToolCall } from "../provider/types.js";

export class Session {
  readonly messages: ChatMessage[] = [];

  constructor(systemPrompt: string) {
    this.messages.push({ role: "system", content: systemPrompt });
  }

  addUser(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistant(text: string, toolCalls: ToolCall[]): void {
    this.messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });
  }

  addToolResult(toolCallId: string, content: string): void {
    this.messages.push({ role: "tool", tool_call_id: toolCallId, content });
  }
}
```

- [ ] **Step 4: 实现 `src/context/system-prompt.ts`**

```ts
export function buildSystemPrompt(cwd: string, platform: string): string {
  return `你是 void-code，一个运行在用户终端里的编码助手。
你可以通过工具读写文件、执行命令、搜索代码来帮用户完成编码任务。

工作环境：
- 当前工作目录：${cwd}
- 操作系统：${platform}

工作约定：
- 修改文件前，先用 read_file 读取相关内容，理解上下文再动手。
- 执行有副作用的操作（write_file / edit_file / bash）前，先用一句话说明你的意图。
- 命令要安全、可预期，不要执行危险的破坏性命令。
- 优先用 edit_file 做小范围精确修改，整文件重写才用 write_file。
- 回答简洁，面向终端输出。
- 任务完成后，用一句话总结你做了什么；不需要再调用工具时直接给出最终回答即可。`;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: PASS（session 共 4 个用例）

- [ ] **Step 6: 报告完成（不自动提交）**

报告：Task 10 完成，新增 `src/context/session.ts`、`src/context/system-prompt.ts`、`tests/session.test.ts`。

---

### Task 11: Agent 主循环

**Files:**
- Create: `src/agent/loop.ts`
- Test: `tests/loop.test.ts`

**Interfaces:**
- Consumes: `Provider`、`ChatResult`（Task 2/3）；`ToolRegistry`（Task 4）；`Session`（Task 10）；`approveIfNeeded`、`Confirmer`（Task 9）。
- Produces:
  - `interface LoopUI { writeText(s: string): void; toolCall(name: string, preview: string): void; toolResult(s: string): void; info(s: string): void; confirm(message: string): Promise<boolean> }`
  - `interface LoopDeps { provider: Provider; registry: ToolRegistry; session: Session; ui: LoopUI; maxIterations: number }`
  - `function runTurn(input: string, deps: LoopDeps): Promise<void>`

- [ ] **Step 1: 写失败测试 `tests/loop.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { runTurn, LoopUI } from "../src/agent/loop.js";
import { ToolRegistry, Tool } from "../src/tools/registry.js";
import { Session } from "../src/context/session.js";
import { Provider, ChatResult } from "../src/provider/types.js";

function makeUI(): LoopUI {
  return {
    writeText: vi.fn(),
    toolCall: vi.fn(),
    toolResult: vi.fn(),
    info: vi.fn(),
    confirm: vi.fn(async () => true),
  };
}

const echoTool: Tool = {
  isWriteOrExec: false,
  schema: { type: "function", function: { name: "echo", description: "", parameters: { type: "object", properties: {} } } },
  async execute() { return "echoed"; },
};

// 第一次回工具调用，第二次回纯文本 —— 模拟模型多轮
function scriptedProvider(results: ChatResult[]): Provider {
  let i = 0;
  return { async chat() { return results[i++]; } };
}

describe("runTurn", () => {
  it("调用工具后把结果回填，再次请求模型，直到纯文本回答", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const session = new Session("SYS");
    const ui = makeUI();
    const provider = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", type: "function", function: { name: "echo", arguments: "{}" } }] },
      { text: "完成了", toolCalls: [] },
    ]);

    await runTurn("做点事", { provider, registry, session, ui, maxIterations: 25 });

    // user, assistant(tool), tool result, assistant(final) —— 加上初始 system 共 5 条
    expect(session.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(session.messages[3]).toMatchObject({ role: "tool", tool_call_id: "c1", content: "echoed" });
    expect(ui.toolCall).toHaveBeenCalledOnce();
  });

  it("写类工具被拒绝时回填「已拒绝」且不执行", async () => {
    const writeTool: Tool = {
      isWriteOrExec: true,
      schema: { type: "function", function: { name: "w", description: "", parameters: { type: "object", properties: {} } } },
      execute: vi.fn(async () => "SHOULD_NOT_RUN"),
    };
    const registry = new ToolRegistry();
    registry.register(writeTool);
    const session = new Session("SYS");
    const ui = makeUI();
    ui.confirm = vi.fn(async () => false);
    const provider = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", type: "function", function: { name: "w", arguments: "{}" } }] },
      { text: "好的", toolCalls: [] },
    ]);

    await runTurn("写文件", { provider, registry, session, ui, maxIterations: 25 });

    expect(writeTool.execute).not.toHaveBeenCalled();
    expect(session.messages[3].content).toMatch(/拒绝/);
  });

  it("达到 maxIterations 上限时中止并提示", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const session = new Session("SYS");
    const ui = makeUI();
    // 永远回工具调用，制造死循环
    const provider: Provider = {
      async chat() {
        return { text: "", toolCalls: [{ id: "c", type: "function", function: { name: "echo", arguments: "{}" } }] };
      },
    };

    await runTurn("循环", { provider, registry, session, ui, maxIterations: 3 });
    expect(ui.info).toHaveBeenCalledWith(expect.stringMatching(/最大迭代/));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/agent/loop.js'`）

- [ ] **Step 3: 实现 `src/agent/loop.ts`**

```ts
import { Provider } from "../provider/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { Session } from "../context/session.js";
import { approveIfNeeded } from "../permission/approve.js";

export interface LoopUI {
  writeText(s: string): void;
  toolCall(name: string, preview: string): void;
  toolResult(s: string): void;
  info(s: string): void;
  confirm(message: string): Promise<boolean>;
}

export interface LoopDeps {
  provider: Provider;
  registry: ToolRegistry;
  session: Session;
  ui: LoopUI;
  maxIterations: number;
}

export async function runTurn(input: string, deps: LoopDeps): Promise<void> {
  const { provider, registry, session, ui, maxIterations } = deps;
  session.addUser(input);

  for (let i = 0; i < maxIterations; i++) {
    const result = await provider.chat({
      messages: session.messages,
      tools: registry.schemas(),
      onTextDelta: (d) => ui.writeText(d),
    });
    ui.writeText("\n");
    session.addAssistant(result.text, result.toolCalls);

    if (result.toolCalls.length === 0) return; // 模型给出最终回答，本轮结束

    for (const call of result.toolCalls) {
      ui.toolCall(call.function.name, call.function.arguments);
      const isWrite = registry.isWriteOrExec(call.function.name);
      const approved = await approveIfNeeded(call, isWrite, { confirm: ui.confirm });
      const output = approved ? await registry.execute(call) : "用户拒绝了该操作。";
      ui.toolResult(output);
      session.addToolResult(call.id, output);
    }
  }

  ui.info(`已达到单轮最大迭代次数 (${maxIterations})，已中止。`);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（loop 共 3 个用例）

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 11 完成，新增 `src/agent/loop.ts`、`tests/loop.test.ts`。这是核心闭环，建议向用户强调此处已通过自动化测试覆盖。

---

### Task 12: 终端 UI (readline)

**Files:**
- Create: `src/ui/terminal.ts`

**Interfaces:**
- Consumes: `LoopUI`（Task 11，Terminal 需满足该接口）。
- Produces: `class Terminal implements LoopUI`，额外方法 `prompt(): Promise<string>`、`close(): void`。

> 说明：本任务高度依赖真实 stdin/stdout，不写自动化单测；通过 Task 13 的端到端手动验收覆盖。实现后做一次 `npm run build` 确保类型正确。

- [ ] **Step 1: 实现 `src/ui/terminal.ts`**

```ts
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { LoopUI } from "../agent/loop.js";

export class Terminal implements LoopUI {
  private rl = readline.createInterface({ input: stdin, output: stdout });

  async prompt(): Promise<string> {
    const line = await this.rl.question("\n> ");
    return line.trim();
  }

  writeText(s: string): void {
    stdout.write(s);
  }

  info(s: string): void {
    stdout.write(`\n${s}\n`);
  }

  toolCall(name: string, preview: string): void {
    const short = preview.length > 120 ? preview.slice(0, 120) + "…" : preview;
    stdout.write(`\n⚙ ${name}(${short})\n`);
  }

  toolResult(s: string): void {
    const out = s.length > 800 ? s.slice(0, 800) + `\n…（共 ${s.length} 字符，已截断）` : s;
    stdout.write(`${out}\n`);
  }

  async confirm(message: string): Promise<boolean> {
    const ans = await this.rl.question(`\n${message}\n确认执行? [y/N] `);
    const a = ans.trim().toLowerCase();
    return a === "y" || a === "yes";
  }

  close(): void {
    this.rl.close();
  }
}
```

- [ ] **Step 2: 编译确认类型正确**

Run: `npm run build`
Expected: 无类型错误，生成 `dist/`

- [ ] **Step 3: 报告完成（不自动提交）**

报告：Task 12 完成，新增 `src/ui/terminal.ts`。

---

### Task 13: CLI 入口 + 端到端串联与验收

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `loadConfig`（Task 1）、`OpenAICompatibleProvider`（Task 3）、`ToolRegistry`+四件套工具（Task 4-8）、`Session`+`buildSystemPrompt`（Task 10）、`runTurn`（Task 11）、`Terminal`（Task 12）。
- Produces: 可运行的 CLI（`npm run dev`）。

- [ ] **Step 1: 实现 `src/index.ts`**

```ts
import { loadConfig } from "./config.js";
import { OpenAICompatibleProvider } from "./provider/openai-compatible.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read.js";
import { writeFileTool, editFileTool } from "./tools/write.js";
import { bashTool } from "./tools/bash.js";
import { searchTool } from "./tools/search.js";
import { Session } from "./context/session.js";
import { buildSystemPrompt } from "./context/system-prompt.js";
import { Terminal } from "./ui/terminal.js";
import { runTurn } from "./agent/loop.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const provider = new OpenAICompatibleProvider({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    model: config.model,
    maxTokens: config.maxTokens,
  });

  const registry = new ToolRegistry();
  for (const tool of [readFileTool, writeFileTool, editFileTool, bashTool, searchTool]) {
    registry.register(tool);
  }

  const session = new Session(buildSystemPrompt(process.cwd(), process.platform));
  const ui = new Terminal();
  ui.info(`void-code 已启动（模型 ${config.model}）。输入需求开始，输入 exit 退出。`);

  while (true) {
    const input = await ui.prompt();
    if (!input) continue;
    if (input === "exit") break;
    try {
      await runTurn(input, { provider, registry, session, ui, maxIterations: config.maxIterations });
    } catch (e) {
      ui.info(`出错：${(e as Error).message}`);
    }
  }

  ui.close();
}

main();
```

- [ ] **Step 2: 全量测试 + 编译**

Run: `npm test && npm run build`
Expected: 所有单测 PASS；编译无错误。

- [ ] **Step 3: 设置 API Key（用户操作）**

提示用户在终端执行（用其在 bigmodel.cn 申请的免费 key）：

```bash
export GLM_API_KEY=用户的key
```

- [ ] **Step 4: 端到端手动验收（逐条执行 `npm run dev`，记录结果）**

启动：`npm run dev`，依次验证 spec §7 的 5 个场景：

1. 输入「读一下 package.json 并总结它的 scripts」→ 应触发 `read_file`（无需确认）并返回总结。
2. 输入「在当前目录新建 hello.txt，内容是 hello world」→ 应触发 `write_file`，弹 y/n，确认后 `hello.txt` 真实生成（用 `ls` / 文件管理器核对）。
3. 输入「运行 ls 看看有哪些文件」→ 应触发 `bash`，弹 y/n，确认后返回目录列表。
4. 输入「找出代码里所有包含 TODO 的地方」→ 应触发 `search`，返回匹配（或「未找到」）。
5. 输入一个多步任务，如「读 src/config.ts，然后在末尾加一行注释 `// end`」→ 应观察到 read → edit 的多轮工具循环，edit 前有确认。

逐条记录实际表现。若 GLM-4-Flash 出现「不调用工具直接乱答」或「参数格式错」，属预期内的模型能力差异：确认工具错误被转成反馈、进程不崩溃即算通过（这正是 spec §5.4 的学习点）。

- [ ] **Step 5: 对照验收标准核对**

逐条核对 spec §9 的 Definition of Done 全部满足。

- [ ] **Step 6: 报告完成（不自动提交）**

向用户报告：MVP 全部完成，列出所有新增文件与端到端验收结果，由用户自行提交。

---

## Self-Review

**Spec 覆盖检查（spec §3 八子系统 → 任务映射）：**
- 1 CLI 入口/配置 → Task 1（config）+ Task 13（index 串联）✅
- 2 终端 UI → Task 12 ✅
- 3 Agent 主循环 → Task 11 ✅
- 4 Provider 层 → Task 2（类型+拼装）+ Task 3（客户端）✅
- 5 工具系统 → Task 4（注册表/错误处理）+ Task 5-8（四件套）✅
- 5.4 工具调用错误处理 → Task 4 测试（未知工具/非法 JSON/抛异常）✅
- 6 权限层 → Task 9 ✅
- 7 上下文/会话 → Task 10（session）✅
- 8 系统提示 → Task 10（system-prompt）✅
- spec §6 边界：缺 key(T1)、网络错误(T13 index try/catch)、非法 JSON/工具异常(T4)、循环失控(T11 maxIterations)、用户拒绝(T9/T11)、bash 超时(T7)，均有覆盖 ✅
- spec §7 测试策略：单元测试分散在 T1-T11；端到端 5 场景在 T13 ✅
- spec §9 验收标准 → Task 13 Step 5 逐条核对 ✅

**占位符扫描：** 无 TBD/TODO/「类似上面」；每个代码步骤均有完整代码。✅

**类型一致性：** `Tool`/`ToolCall`/`ChatMessage`/`ChatResult`/`Provider`/`LoopUI`/`Session` 在各任务间签名一致；工具名 `read_file`/`write_file`/`edit_file`/`bash`/`search` 全程一致；`isWriteOrExec` 命名一致。✅
