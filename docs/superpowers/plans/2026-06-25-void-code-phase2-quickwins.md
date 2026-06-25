# void-code 小缺口套餐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成的 MVP 上补 4 项高频实用增强：斜杠命令、`read_file` 分段读、Ctrl+C 两段式、token 统计。

**Architecture:** 沿用现有 8 子系统结构。新增一个纯函数式斜杠命令分发器 `ui/commands.ts`；`read_file` 加可选分页参数；通过 `AbortSignal` 串联 provider→loop 实现中断；通过 OpenAI 兼容的 `stream_options.include_usage` 取 token，loop 累加本轮、index 累加全会话。

**Tech Stack:** TypeScript + Node.js (ESM)、`openai` 包、`vitest`、`tsx`。

## Global Constraints

- **运行时**：ESM（`"type":"module"`），TypeScript `NodeNext`，源码 import 一律带 `.js` 后缀。
- **测试框架**：`vitest`，测试放 `tests/`，命名 `*.test.ts`。
- **工具结果一律返回字符串**，工具层不抛异常崩进程。
- **不破坏现有行为**：现有 41 个单测必须保持全绿；`read_file` 不传新参数时行为与现状完全一致。
- **语言**：面向用户文案用中文；标识符用英文。
- **提交策略（覆盖默认）**：禁止自动 `git commit`/`git push`。每个任务最后一步是「向用户报告完成并列出改动文件，由用户自行提交」。
- **token 展示格式**：每轮末一行 `本轮 prompt N / completion M ｜ 累计 T`。

---

## File Structure

| 文件 | 改动 | 任务 |
|------|------|------|
| `src/tools/read.ts` | 加 `offset`/`limit` 可选参数 | Task 1 |
| `src/context/session.ts` | 加 `clear()` | Task 2 |
| `src/ui/commands.ts` | **新增**：斜杠命令分发器 | Task 3 |
| `src/provider/types.ts` | 加 `Usage`、`ChatResult.usage`、`ChatParams.signal` | Task 4 |
| `src/provider/assemble.ts` | `StreamAssembler` 捕获 usage | Task 4 |
| `src/provider/openai-compatible.ts` | `stream_options` + 透传 signal + 取 usage | Task 4 |
| `src/agent/loop.ts` | `runTurn` 串 signal、累加本轮 usage 并返回、捕获 abort | Task 5 |
| `src/ui/terminal.ts` | 加 `usage()` 与 `onSigint()` | Task 6 |
| `src/index.ts` | 命令分发 + 全会话累计 + per-turn AbortController + SIGINT 状态机 | Task 6 |

---

### Task 1: read_file 分段读

**Files:**
- Modify: `src/tools/read.ts`
- Test: `tests/read.test.ts`

**Interfaces:**
- Consumes: 现有 `readFileTool: Tool`。
- Produces: `read_file` 工具新增可选参数 `offset`（起始行，1-based）、`limit`（最大行数）。不传时行为不变。

- [ ] **Step 1: 写失败测试（追加到 `tests/read.test.ts` 的 describe 内）**

```ts
  it("offset 从指定行开始，行号按真实行号显示", async () => {
    await writeFile(`${dir}/big.txt`, "L1\nL2\nL3\nL4\nL5");
    const out = await readFileTool.execute({ path: `${dir}/big.txt`, offset: 3 });
    expect(out).toContain("3\tL3");
    expect(out).toContain("5\tL5");
    expect(out).not.toContain("1\tL1");
  });

  it("limit 限制返回行数并提示剩余", async () => {
    await writeFile(`${dir}/big2.txt`, "L1\nL2\nL3\nL4\nL5");
    const out = await readFileTool.execute({ path: `${dir}/big2.txt`, offset: 1, limit: 2 });
    expect(out).toContain("1\tL1");
    expect(out).toContain("2\tL2");
    expect(out).not.toContain("3\tL3");
    expect(out).toMatch(/还有 3 行/);
  });

  it("offset 越界返回错误提示", async () => {
    await writeFile(`${dir}/big3.txt`, "L1\nL2");
    const out = await readFileTool.execute({ path: `${dir}/big3.txt`, offset: 99 });
    expect(out).toMatch(/超出/);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（新增 3 个用例因行号/截断逻辑未实现而失败）

- [ ] **Step 3: 实现 —— 修改 `src/tools/read.ts`**

把 schema 的 `parameters.properties` 与 `execute` 改成下面这样（其余 import、目录分支、MAX_LINES 不变）：

schema 部分改为：
```ts
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件或目录路径（相对当前目录或绝对路径）" },
          offset: { type: "number", description: "可选：起始行号（1-based，含）。用于分页读大文件。" },
          limit: { type: "number", description: "可选：最多返回的行数。" },
        },
        required: ["path"],
      },
```

`execute` 里读文件后的部分（即 `const content = await readFile(...)` 之后）改为：
```ts
    const content = await readFile(path, "utf8");
    const lines = content.split("\n");

    const offset =
      typeof args.offset === "number" && args.offset >= 1 ? Math.floor(args.offset) : 1;
    const limit =
      typeof args.limit === "number" && args.limit >= 1 ? Math.floor(args.limit) : MAX_LINES;

    if (offset > lines.length) {
      return `错误：offset ${offset} 超出文件总行数 ${lines.length}。`;
    }

    const start = offset - 1; // 转 0-based
    const end = Math.min(start + limit, lines.length);
    const shown = lines.slice(start, end);
    const numbered = shown.map((l, i) => `${start + i + 1}\t${l}`).join("\n");
    const remaining = lines.length - end;
    const truncated =
      remaining > 0 ? `\n...（还有 ${remaining} 行，可用 offset=${end + 1} 继续读）` : "";
    return numbered + truncated;
```

同时把 schema 里 `read_file` 的 description 补一句：`若需分页读大文件可传 offset/limit。`

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test`
Expected: PASS。read 相关用例（原有 4 个 + 新增 3 个）全过，其余任务用例不受影响。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 1 完成，修改 `src/tools/read.ts`、`tests/read.test.ts`。

---

### Task 2: Session.clear()

**Files:**
- Modify: `src/context/session.ts`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: 现有 `Session`。
- Produces: `Session.clear(): void` —— 清空历史，仅保留第一条 system 消息。

- [ ] **Step 1: 写失败测试（追加到 `tests/session.test.ts` 的 `describe("Session", ...)` 内）**

```ts
  it("clear() 清空历史但保留系统提示", () => {
    const s = new Session("SYS");
    s.addUser("hi");
    s.addAssistant("answer", []);
    s.clear();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toEqual({ role: "system", content: "SYS" });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`s.clear is not a function`）

- [ ] **Step 3: 实现 —— 在 `src/context/session.ts` 的 `Session` 类里增加方法**

在 `addToolResult` 方法后面加：
```ts
  clear(): void {
    this.messages.splice(1); // 删除索引 1 及之后，保留第一条 system 消息
  }
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 2 完成，修改 `src/context/session.ts`、`tests/session.test.ts`。

---

### Task 3: 斜杠命令分发器

**Files:**
- Create: `src/ui/commands.ts`
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: `Session`（Task 2，含 `clear()`）、`ToolRegistry`（`schemas()`）。
- Produces:
  - `interface CommandContext { session: Session; registry: ToolRegistry }`
  - `interface CommandResult { handled: boolean; message?: string; exit?: boolean }`
  - `function handleCommand(input: string, ctx: CommandContext): CommandResult`

- [ ] **Step 1: 写失败测试 `tests/commands.test.ts`**

```ts
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
  return { session, registry };
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
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/ui/commands.js'`）

- [ ] **Step 3: 实现 `src/ui/commands.ts`**

```ts
import { Session } from "../context/session.js";
import { ToolRegistry } from "../tools/registry.js";

export interface CommandContext {
  session: Session;
  registry: ToolRegistry;
}

export interface CommandResult {
  handled: boolean;
  message?: string;
  exit?: boolean;
}

export function handleCommand(input: string, ctx: CommandContext): CommandResult {
  if (!input.startsWith("/")) return { handled: false };

  const cmd = input.slice(1).trim().split(/\s+/)[0];
  switch (cmd) {
    case "help":
      return { handled: true, message: helpText(ctx.registry) };
    case "clear":
      ctx.session.clear();
      return { handled: true, message: "已清空会话历史（系统提示保留）。" };
    case "exit":
      return { handled: true, exit: true };
    default:
      return { handled: true, message: `未知命令 /${cmd}，输入 /help 查看可用命令。` };
  }
}

function helpText(registry: ToolRegistry): string {
  const tools = registry
    .schemas()
    .map((s) => `  ${s.function.name} — ${s.function.description}`)
    .join("\n");
  return [
    "可用命令：",
    "  /help  — 显示本帮助",
    "  /clear — 清空会话历史",
    "  /exit  — 退出",
    "",
    "可用工具：",
    tools,
  ].join("\n");
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test`
Expected: PASS（commands 5 个用例 + 其余全部）

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 3 完成，新增 `src/ui/commands.ts`、`tests/commands.test.ts`。

---

### Task 4: Provider 层 token usage + signal

**Files:**
- Modify: `src/provider/types.ts`, `src/provider/assemble.ts`, `src/provider/openai-compatible.ts`
- Test: `tests/assemble.test.ts`, `tests/openai-compatible.test.ts`

**Interfaces:**
- Consumes: 现有 `StreamAssembler`、`OpenAICompatibleProvider`、`ChatResult`、`ChatParams`。
- Produces:
  - `interface Usage { promptTokens: number; completionTokens: number; totalTokens: number }`
  - `ChatResult` 增加 `usage?: Usage`
  - `ChatParams` 增加 `signal?: AbortSignal`
  - `StreamAssembler.setUsage(raw: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): void`，`result()` 携带 `usage`

- [ ] **Step 1: 修改 `src/provider/types.ts`**

在文件中增加 `Usage` 类型，并修改 `ChatResult`、`ChatParams`：
```ts
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```
`ChatResult` 改为：
```ts
export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage?: Usage;
}
```
`ChatParams` 改为：
```ts
export interface ChatParams {
  messages: ChatMessage[];
  tools: ToolSchema[];
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}
```

- [ ] **Step 2: 写失败测试（追加到 `tests/assemble.test.ts`）**

```ts
  it("setUsage 转驼峰并带进 result", () => {
    const a = new StreamAssembler();
    a.setUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(a.result().usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });
```
追加到 `tests/openai-compatible.test.ts`（在现有 describe 内）：
```ts
  it("捕获流末尾 chunk 的 usage", async () => {
    async function* withUsage() {
      yield { choices: [{ delta: { content: "hi" } }] };
      yield { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } };
    }
    const provider = new OpenAICompatibleProvider(
      { apiKey: "k", baseURL: "http://x", model: "glm-4-flash", maxTokens: 100 },
      async () => withUsage() as any
    );
    const r = await provider.chat({ messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(r.usage).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
  });
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`setUsage is not a function`；usage 为 undefined）

- [ ] **Step 4: 实现 —— 修改 `src/provider/assemble.ts`**

文件顶部 import 增加 `Usage`：
```ts
import { ChatResult, ToolCall, Usage } from "./types.js";
```
在 `StreamAssembler` 类里增加字段与方法，并修改 `result()`：
```ts
export class StreamAssembler {
  private text = "";
  private toolCalls: ToolCall[] = [];
  private usage?: Usage;

  // ...（addDelta 保持不变）...

  setUsage(raw: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): void {
    this.usage = {
      promptTokens: raw.prompt_tokens ?? 0,
      completionTokens: raw.completion_tokens ?? 0,
      totalTokens: raw.total_tokens ?? 0,
    };
  }

  result(): ChatResult {
    return { text: this.text, toolCalls: this.toolCalls.filter(Boolean), usage: this.usage };
  }
}
```

- [ ] **Step 5: 实现 —— 修改 `src/provider/openai-compatible.ts`**

`StreamChunk` 接口增加可选 `usage` 字段：
```ts
interface StreamChunk {
  choices: Array<{ delta?: StreamDelta }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
```
默认 `streamFactory` 的请求体增加 `stream_options` 并透传 `signal`（把整段默认工厂替换为）：
```ts
    this.streamFactory =
      streamFactory ??
      (async (params) =>
        (await client.chat.completions.create(
          {
            model: opts.model,
            messages: params.messages as any,
            tools: params.tools.length ? (params.tools as any) : undefined,
            max_tokens: opts.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: params.signal }
        )) as unknown as AsyncIterable<StreamChunk>);
```
`chat()` 的 for-await 循环里增加捕获 usage：
```ts
  async chat(params: ChatParams): Promise<ChatResult> {
    const stream = await this.streamFactory(params);
    const assembler = new StreamAssembler();
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta) assembler.addDelta(delta, params.onTextDelta);
      if (chunk.usage) assembler.setUsage(chunk.usage);
    }
    return assembler.result();
  }
```

- [ ] **Step 6: 运行测试确认全绿**

Run: `npm test`
Expected: PASS（新增 2 个 usage 用例 + 其余全部）

- [ ] **Step 7: 报告完成（不自动提交）**

报告：Task 4 完成，修改 `src/provider/types.ts`、`assemble.ts`、`openai-compatible.ts` 及对应测试。

---

### Task 5: Agent 主循环串入 signal 与 token 累加

**Files:**
- Modify: `src/agent/loop.ts`
- Test: `tests/loop.test.ts`

**Interfaces:**
- Consumes: `Provider`、`ChatResult.usage`、`ChatParams.signal`、`Usage`（Task 4）。
- Produces:
  - `interface TurnUsage { promptTokens: number; completionTokens: number }`
  - `runTurn(input: string, deps: LoopDeps, signal?: AbortSignal): Promise<TurnUsage>` —— 累加本轮各次请求的 usage 并返回；捕获中断（AbortError/APIUserAbortError）后调用 `ui.info` 并优雅返回。
  - `LoopUI`、`LoopDeps` 字段不变。

- [ ] **Step 1: 写失败测试（追加到 `tests/loop.test.ts` 的 `describe("runTurn", ...)` 内）**

```ts
  it("累加本轮多次请求的 token 并返回", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const session = new Session("SYS");
    const ui = makeUI();
    const provider = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", type: "function", function: { name: "echo", arguments: "{}" } }], usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      { text: "完成", toolCalls: [], usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 } },
    ]);
    const used = await runTurn("做事", { provider, registry, session, ui, maxIterations: 25 });
    expect(used).toEqual({ promptTokens: 30, completionTokens: 13 });
  });

  it("中断错误被捕获，提示并优雅返回（不抛）", async () => {
    const registry = new ToolRegistry();
    const session = new Session("SYS");
    const ui = makeUI();
    const provider = {
      async chat() {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
    } as any;
    const used = await runTurn("x", { provider, registry, session, ui, maxIterations: 25 });
    expect(ui.info).toHaveBeenCalledWith(expect.stringMatching(/中断/));
    expect(used).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
```

> 注：`scriptedProvider` 与 `ChatResult` 现已含可选 `usage` 字段，上面的字面量直接带 `usage` 即可。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（runTurn 返回 undefined、无中断捕获）

- [ ] **Step 3: 实现 —— 替换 `src/agent/loop.ts` 的 `runTurn`（接口与 import 保持，新增 TurnUsage 导出）**

在 `LoopDeps` 之后增加：
```ts
export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
}
```
`runTurn` 整体替换为：
```ts
export async function runTurn(
  input: string,
  deps: LoopDeps,
  signal?: AbortSignal
): Promise<TurnUsage> {
  const { provider, registry, session, ui, maxIterations } = deps;
  session.addUser(input);

  let promptTokens = 0;
  let completionTokens = 0;

  try {
    for (let i = 0; i < maxIterations; i++) {
      const result = await provider.chat({
        messages: session.messages,
        tools: registry.schemas(),
        onTextDelta: (d) => ui.writeText(d),
        signal,
      });
      ui.writeText("\n");
      session.addAssistant(result.text, result.toolCalls);

      if (result.usage) {
        promptTokens += result.usage.promptTokens;
        completionTokens += result.usage.completionTokens;
      }

      if (result.toolCalls.length === 0) return { promptTokens, completionTokens };

      for (const call of result.toolCalls) {
        ui.toolCall(call.function.name, call.function.arguments);
        const isWrite = registry.isWriteOrExec(call.function.name);
        const approved = await approveIfNeeded(call, isWrite, ui);
        const output = approved ? await registry.execute(call) : "用户拒绝了该操作。";
        ui.toolResult(output);
        session.addToolResult(call.id, output);
      }
    }

    ui.info(`已达到单轮最大迭代次数 (${maxIterations})，已中止。`);
    return { promptTokens, completionTokens };
  } catch (e) {
    if (e instanceof Error && (e.name === "AbortError" || e.name === "APIUserAbortError")) {
      ui.info("已中断当前操作。");
      return { promptTokens, completionTokens };
    }
    throw e;
  }
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test`
Expected: PASS（新增 2 个用例 + 原有 loop 用例 + 全部其它）

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 5 完成，修改 `src/agent/loop.ts`、`tests/loop.test.ts`。

---

### Task 6: Terminal 显示与 index 串联（命令 / 累计 / Ctrl+C）

**Files:**
- Modify: `src/ui/terminal.ts`, `src/index.ts`
- 无新增单测（依赖真实 stdin/stdout 与 SIGINT），以全量测试 + 编译 + 手动验收覆盖。

**Interfaces:**
- Consumes: `handleCommand`（Task 3）、`runTurn` + `TurnUsage`（Task 5）。
- Produces: `Terminal` 新增 `usage(line: string): void`、`onSigint(handler: () => void): void`。

- [ ] **Step 1: 修改 `src/ui/terminal.ts` —— 增加两个方法**

在 `Terminal` 类里（`close()` 之前）加：
```ts
  usage(line: string): void {
    stdout.write(`\x1b[2m${line}\x1b[0m\n`); // 暗色显示
  }

  onSigint(handler: () => void): void {
    this.rl.on("SIGINT", handler);
  }
```

- [ ] **Step 2: 修改 `src/index.ts` —— 串联命令分发、token 累计、Ctrl+C 状态机**

把 `main()` 里「组装组件之后到 `ui.close()`」这一段（即 `ui.info("void-code 已启动...")` 起的 REPL 部分）替换为：
```ts
  const ui = new Terminal();
  ui.info(`void-code 已启动（模型 ${config.model}）。输入需求，或 /help 查看命令，exit 退出。`);

  const ctx = { session, registry };
  const deps = { provider, registry, session, ui, maxIterations: config.maxIterations };

  let totalPrompt = 0;
  let totalCompletion = 0;
  let activeController: AbortController | null = null;
  let pendingExit = false;

  // Ctrl+C 两段式：进行中→中断当前轮；空闲连按两次→退出
  ui.onSigint(() => {
    if (activeController) {
      activeController.abort();
      activeController = null;
      return;
    }
    if (pendingExit) {
      ui.close();
      process.exit(0);
    }
    pendingExit = true;
    ui.info("再按一次 Ctrl+C 退出。");
  });

  while (true) {
    const input = await ui.prompt();
    pendingExit = false; // 有新输入即清除待退出标志
    if (!input) continue;

    const cmd = handleCommand(input, ctx);
    if (cmd.handled) {
      if (cmd.message) ui.info(cmd.message);
      if (cmd.exit) break;
      continue;
    }
    if (input === "exit") break; // 兼容旧的纯 exit

    activeController = new AbortController();
    try {
      const used = await runTurn(input, deps, activeController.signal);
      totalPrompt += used.promptTokens;
      totalCompletion += used.completionTokens;
      if (used.promptTokens || used.completionTokens) {
        ui.usage(
          `本轮 prompt ${used.promptTokens} / completion ${used.completionTokens} ｜ 累计 ${totalPrompt + totalCompletion}`
        );
      }
    } catch (e) {
      ui.info(`出错：${(e as Error).message}`);
    } finally {
      activeController = null;
    }
  }

  ui.close();
```
并在文件顶部 import 增加：
```ts
import { handleCommand } from "./ui/commands.js";
```

- [ ] **Step 3: 全量测试 + 编译**

Run: `npm test && npm run build`
Expected: 所有单测 PASS；`tsc` 编译无错误。

- [ ] **Step 4: 手动验收（需用户用真实 GLM key 执行 `npm run dev`）**

逐条验证（记录结果）：
1. `/help` → 打印命令 + 工具清单。
2. 随便聊一句 → 每轮末出现暗色 `本轮 prompt N / completion M ｜ 累计 T`；再聊一句，累计应增大。
3. `/clear` → 提示已清空；之后问「我们刚才聊了什么」应表现为不记得（历史已清）。
4. `read_file` 分页：让它「读 src/index.ts 的第 1 到第 20 行」，观察是否带 offset/limit 调用、行号正确。
5. **Ctrl+C 两段式**：(a) 在模型输出/工具进行中按一次 Ctrl+C → 应中断当前轮、回到 `>` 提示，程序不退出；(b) 空闲时按一次 → 提示「再按一次 Ctrl+C 退出」，再按一次 → 退出。
6. `/exit` 或 `exit` → 退出。

> 备注（Ctrl+C tricky 处）：若实测发现「进行中按 Ctrl+C 没被捕获、程序直接被终止」，说明该平台下 readline 未在请求期间转发 SIGINT。补救：在 `main()` 里额外加 `process.on("SIGINT", handler)`（与 `ui.onSigint` 同一个 handler 函数），并对 handler 做幂等（abort 本身幂等；`pendingExit` toggle 可接受偶发双触发）。先按上面实现验收，按需再加此 fallback。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 6 完成，修改 `src/ui/terminal.ts`、`src/index.ts`，并附手动验收结果。

---

## Self-Review

**Spec 覆盖检查（spec 4 项 + 验收标准 → 任务映射）：**
- 斜杠命令（/help /clear /exit + 未知）→ Task 3（commands.ts）+ Task 2（Session.clear）+ Task 6（index 分发）✅
- read_file 分段读（offset/limit、行号、越界、默认不变）→ Task 1 ✅
- Ctrl+C 两段式（signal 串联 + 状态机）→ Task 4（signal 类型/透传）+ Task 5（loop 串 signal + 捕获中断）+ Task 6（AbortController + SIGINT 状态机）✅
- token 统计（include_usage、本轮累加、全会话累计、展示格式）→ Task 4（取 usage）+ Task 5（本轮累加返回）+ Task 6（全会话累计 + 展示）✅
- 验收标准每条均有对应任务 + Task 6 Step 4 手动核对 ✅
- 不破坏现有行为：每个任务 Step 4 跑全量测试；read_file 默认参数路径在 Task 1 测试覆盖 ✅

**占位符扫描：** 无 TBD/TODO/「类似上面」；每个代码步骤均有完整代码或精确的「改成这样」片段。✅

**类型一致性：** `Usage`{promptTokens,completionTokens,totalTokens}、`ChatResult.usage?`、`ChatParams.signal?`、`TurnUsage`{promptTokens,completionTokens}、`CommandContext`/`CommandResult`、`runTurn(input,deps,signal?):Promise<TurnUsage>`、`Session.clear()`、`Terminal.usage()/onSigint()`、`handleCommand(input,ctx)` 在各任务间签名一致；驼峰命名（promptTokens/completionTokens）贯穿 provider→loop→index 无漂移。✅
