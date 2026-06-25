# void-code A+B 批次 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加入 A（工具调用兜底、list_files、/tools /model 命令）与 B（diff 彩色渲染、markdown 渲染、错误重试），让弱模型更稳、终端体验更好。

**Architecture:** 沿用现有 8 子系统。新增 `tools/list.ts`、`ui/diff.ts`、`ui/markdown.ts` 三个聚焦模块；diff/glob/markdown 用成熟库（`diff`/`glob`/`marked`+`marked-terminal`），重试用 openai SDK 内置 `maxRetries`；助手文本从「流式逐字」改为「整段缓冲后 markdown 渲染」。

**Tech Stack:** TypeScript + Node.js (ESM)、`openai`、`vitest`、新库 `diff`/`chalk`/`marked`/`marked-terminal`/`glob`。

## Global Constraints

- **运行时**：ESM（`"type":"module"`），TypeScript `NodeNext`，源码 import 一律带 `.js` 后缀。
- **测试框架**：`vitest`，测试放 `tests/`，命名 `*.test.ts`。断言彩色输出时先用 `s.replace(/\x1b\[[0-9;]*m/g, "")` 去掉 ANSI 再断言文本，**不要**断言具体色码。
- **工具结果一律返回字符串**，工具层不抛异常崩进程。
- **不破坏现有功能**：现有 56 个单测必须保持全绿（个别因接口调整需同步更新的测试除外，见对应任务）。
- **关键体验变化**：助手文本不再流式逐字打印，改为每段回复收完后整段 markdown 渲染；等待期间显示「生成中…」并在渲染前清行。
- **语言**：面向用户文案用中文；标识符用英文。
- **提交策略（覆盖默认）**：禁止自动 `git commit`/`git push`。每个任务最后一步是「向用户报告完成并列出改动文件，由用户自行提交」。

---

## File Structure

| 文件 | 改动 | 任务 |
|------|------|------|
| `package.json` | 新依赖 diff/chalk/marked/marked-terminal/glob (+@types/diff) | Task 1 |
| `src/tools/list.ts` | **新增** list_files glob 工具 | Task 1 |
| `src/index.ts` | 注册 list_files；CommandContext 传 model | Task 1 / Task 2 |
| `src/ui/commands.ts` | /tools /model；CommandContext += model | Task 2 |
| `src/ui/diff.ts` | **新增** renderDiff | Task 3 |
| `src/permission/approve.ts` | 预览异步化（buildPreview）+ 接入 diff | Task 4 |
| `src/ui/markdown.ts` | **新增** renderMarkdown | Task 5 |
| `src/ui/terminal.ts` | renderAssistant / thinkingStart / thinkingStop | Task 6 |
| `src/agent/loop.ts` | 工具调用兜底 + 改用 renderAssistant + thinking；LoopUI 调整 | Task 7 |
| `src/provider/openai-compatible.ts` | maxRetries | Task 7 |

---

### Task 1: 装依赖 + list_files glob 工具

**Files:**
- Modify: `package.json`（装依赖）, `src/index.ts`（注册工具）
- Create: `src/tools/list.ts`
- Test: `tests/list.test.ts`

**Interfaces:**
- Consumes: `Tool`（`src/tools/registry.ts`）、`glob` 库。
- Produces: `export const listFilesTool: Tool`（工具名 `list_files`，参数 `pattern` 必填、`cwd` 可选，`isWriteOrExec: false`）。

- [ ] **Step 1: 装依赖**

```bash
cd /Users/daguang.li/workspace/void-code
npm install diff chalk marked marked-terminal glob
npm install -D @types/diff
```

- [ ] **Step 2: 写失败测试 `tests/list.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { listFilesTool } from "../src/tools/list.js";

const dir = "tests/.tmp-list";

beforeAll(async () => {
  await mkdir(`${dir}/sub`, { recursive: true });
  await writeFile(`${dir}/a.ts`, "");
  await writeFile(`${dir}/sub/b.ts`, "");
  await writeFile(`${dir}/c.md`, "");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("listFilesTool", () => {
  it("按 glob 匹配 .ts 文件（含子目录）", async () => {
    const out = await listFilesTool.execute({ pattern: "**/*.ts", cwd: dir });
    expect(out).toContain("a.ts");
    expect(out).toContain("b.ts");
    expect(out).not.toContain("c.md");
  });

  it("无匹配返回提示", async () => {
    const out = await listFilesTool.execute({ pattern: "**/*.py", cwd: dir });
    expect(out).toMatch(/未找到/);
  });

  it("缺 pattern 返回错误", async () => {
    expect(await listFilesTool.execute({})).toMatch(/缺少必填参数 pattern/);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/tools/list.js'`）

- [ ] **Step 4: 实现 `src/tools/list.ts`**

```ts
import { glob } from "glob";
import { Tool } from "./registry.js";

const MAX_RESULTS = 200;

export const listFilesTool: Tool = {
  isWriteOrExec: false,
  schema: {
    type: "function",
    function: {
      name: "list_files",
      description: '用 glob 模式列出匹配的文件路径（如 "src/**/*.ts"）。用于按模式查找文件。',
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 模式，如 src/**/*.ts" },
          cwd: { type: "string", description: "可选：搜索根目录，默认当前目录" },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args) {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) return "错误：缺少必填参数 pattern";
    const cwd = typeof args.cwd === "string" && args.cwd ? args.cwd : ".";

    const matches = await glob(pattern, {
      cwd,
      nodir: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    });

    if (matches.length === 0) return `未找到匹配 "${pattern}" 的文件`;
    const shown = [...matches].sort().slice(0, MAX_RESULTS);
    const suffix =
      matches.length > MAX_RESULTS ? `\n...（共 ${matches.length} 个，已截断到 ${MAX_RESULTS}）` : "";
    return shown.join("\n") + suffix;
  },
};
```

- [ ] **Step 5: 在 `src/index.ts` 注册 list_files**

把工具注册数组那行：
```ts
  for (const tool of [readFileTool, writeFileTool, editFileTool, bashTool, searchTool]) {
```
改为：
```ts
  for (const tool of [readFileTool, writeFileTool, editFileTool, bashTool, searchTool, listFilesTool]) {
```
并在顶部 import 增加：
```ts
import { listFilesTool } from "./tools/list.js";
```

- [ ] **Step 6: 运行测试 + 编译确认全绿**

Run: `npm test && npm run build`
Expected: PASS（list 3 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 7: 报告完成（不自动提交）**

报告：Task 1 完成，新增 `src/tools/list.ts`、`tests/list.test.ts`，修改 `package.json`、`src/index.ts`。

---

### Task 2: /tools 与 /model 命令

**Files:**
- Modify: `src/ui/commands.ts`, `src/index.ts`
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: `Session`、`ToolRegistry`。
- Produces: `CommandContext` 增加 `model: string`；新增命令 `/tools`（列工具）、`/model`（显示当前模型）。

- [ ] **Step 1: 写失败测试（追加到 `tests/commands.test.ts`，并更新 makeCtx）**

把现有 `makeCtx` 的返回改为带 model：
```ts
  return { session, registry, model: "glm-4-flash" };
```
追加两个用例：
```ts
  it("/tools 列出工具", () => {
    const r = handleCommand("/tools", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.message).toContain("read_file");
  });

  it("/model 显示当前模型", () => {
    const r = handleCommand("/model", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.message).toContain("glm-4-flash");
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`/tools`/`/model` 走到 default 未知命令分支，断言不通过）

- [ ] **Step 3: 修改 `src/ui/commands.ts`**

`CommandContext` 改为：
```ts
export interface CommandContext {
  session: Session;
  registry: ToolRegistry;
  model: string;
}
```
在 `switch (cmd)` 中，`case "exit"` 之前加：
```ts
    case "tools":
      return { handled: true, message: toolsText(ctx.registry) };
    case "model":
      return { handled: true, message: `当前模型：${ctx.model}` };
```
并把 `helpText` 改名/复用：新增 `toolsText` 并让 `helpText` 复用它，同时在帮助里补 /tools /model。把文件底部的 `helpText` 函数替换为：
```ts
function toolsText(registry: ToolRegistry): string {
  const tools = registry
    .schemas()
    .map((s) => `  ${s.function.name} — ${s.function.description}`)
    .join("\n");
  return `可用工具：\n${tools}`;
}

function helpText(registry: ToolRegistry): string {
  return [
    "可用命令：",
    "  /help  — 显示本帮助",
    "  /tools — 列出可用工具",
    "  /model — 显示当前模型",
    "  /clear — 清空会话历史",
    "  /exit  — 退出",
    "",
    toolsText(registry),
  ].join("\n");
}
```

- [ ] **Step 4: 修改 `src/index.ts` 传入 model**

把：
```ts
  const ctx = { session, registry };
```
改为：
```ts
  const ctx = { session, registry, model: config.model };
```

- [ ] **Step 5: 运行测试 + 编译确认全绿**

Run: `npm test && npm run build`
Expected: PASS（commands 原 5 个 + 新 2 个 + 其余全部）；tsc 无错误。

- [ ] **Step 6: 报告完成（不自动提交）**

报告：Task 2 完成，修改 `src/ui/commands.ts`、`src/index.ts`、`tests/commands.test.ts`。

---

### Task 3: diff 彩色渲染

**Files:**
- Create: `src/ui/diff.ts`
- Test: `tests/diff.test.ts`

**Interfaces:**
- Consumes: `diff` 库（`diffLines`）、`chalk`。
- Produces: `export function renderDiff(oldStr: string, newStr: string): string`（新增行 `+` 绿、删除行 `-` 红、未变行 `  ` 灰）。

- [ ] **Step 1: 写失败测试 `tests/diff.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { renderDiff } from "../src/ui/diff.js";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderDiff", () => {
  it("标记新增与删除行", () => {
    const out = strip(renderDiff("a\nb\n", "a\nc\n"));
    expect(out).toContain("- b");
    expect(out).toContain("+ c");
    expect(out).toContain("  a");
  });

  it("旧内容为空时全部按新增", () => {
    const out = strip(renderDiff("", "x\ny\n"));
    expect(out).toContain("+ x");
    expect(out).toContain("+ y");
    expect(out).not.toContain("- ");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/ui/diff.js'`）

- [ ] **Step 3: 实现 `src/ui/diff.ts`**

```ts
import { diffLines } from "diff";
import chalk from "chalk";

export function renderDiff(oldStr: string, newStr: string): string {
  const parts = diffLines(oldStr, newStr);
  const out: string[] = [];
  for (const part of parts) {
    const lines = part.value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop(); // 去掉末尾空行
    for (const line of lines) {
      if (part.added) out.push(chalk.green(`+ ${line}`));
      else if (part.removed) out.push(chalk.red(`- ${line}`));
      else out.push(chalk.dim(`  ${line}`));
    }
  }
  return out.join("\n");
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test`
Expected: PASS（diff 2 个用例 + 其余全部）

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 3 完成，新增 `src/ui/diff.ts`、`tests/diff.test.ts`。

---

### Task 4: 权限预览异步化 + 接入 diff

**Files:**
- Modify: `src/permission/approve.ts`
- Test: `tests/approve.test.ts`

**Interfaces:**
- Consumes: `ToolCall`、`renderDiff`（Task 3）。
- Produces:
  - `export async function buildPreview(call: ToolCall): Promise<string>`（替代原 `describeCall`；write/edit 渲染 diff，bash/其它返回文本）
  - `approveIfNeeded(call, isWriteOrExec, confirmer)` 改为内部 `await buildPreview(...)`，签名（返回 `Promise<boolean>`）不变。
  - `Confirmer` 接口不变。

- [ ] **Step 1: 改写测试 `tests/approve.test.ts`（把 describeCall 相关替换为 buildPreview）**

把顶部 import 改为：
```ts
import { approveIfNeeded, buildPreview, Confirmer } from "../src/permission/approve.js";
```
把原来的 `describe("describeCall", ...)` 整块替换为：
```ts
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("buildPreview", () => {
  it("bash 显示完整命令", async () => {
    expect(await buildPreview(call("bash", { command: "ls -la" }))).toContain("ls -la");
  });

  it("edit_file 显示 old→new 的 diff", async () => {
    const p = strip(await buildPreview(call("edit_file", { path: "x.ts", old_string: "foo", new_string: "bar" })));
    expect(p).toContain("x.ts");
    expect(p).toContain("- foo");
    expect(p).toContain("+ bar");
  });

  it("write_file 对不存在的文件显示全新增", async () => {
    const p = strip(await buildPreview(call("write_file", { path: "tests/.nope-xyz-123.txt", content: "hi" })));
    expect(p).toContain("+ hi");
  });
});
```
`approveIfNeeded` 的现有 3 个用例（读类放行、yes、no）保持不变。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`buildPreview` 未导出）

- [ ] **Step 3: 重写 `src/permission/approve.ts`**

```ts
import { readFile } from "node:fs/promises";
import { ToolCall } from "../provider/types.js";
import { renderDiff } from "../ui/diff.js";

export interface Confirmer {
  confirm(message: string): Promise<boolean>;
}

function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments || "{}");
  } catch {
    return {};
  }
}

export async function buildPreview(call: ToolCall): Promise<string> {
  const args = parseArgs(call);
  switch (call.function.name) {
    case "edit_file":
      return `编辑文件 ${args.path}：\n${renderDiff(String(args.old_string ?? ""), String(args.new_string ?? ""))}`;
    case "write_file": {
      const path = String(args.path ?? "");
      let existing = "";
      try {
        existing = await readFile(path, "utf8");
      } catch {
        existing = ""; // 文件不存在 → 全部按新增
      }
      return `写入文件 ${path}：\n${renderDiff(existing, String(args.content ?? ""))}`;
    }
    case "bash":
      return `执行命令：${args.command}`;
    default:
      return `${call.function.name}(${call.function.arguments})`;
  }
}

export async function approveIfNeeded(
  call: ToolCall,
  isWriteOrExec: boolean,
  confirmer: Confirmer
): Promise<boolean> {
  if (!isWriteOrExec) return true;
  return confirmer.confirm(await buildPreview(call));
}
```

- [ ] **Step 4: 运行测试 + 编译确认全绿**

Run: `npm test && npm run build`
Expected: PASS（approve 用例全过）；tsc 无错误（注意：原 `describeCall` 已无引用，确认没有其它文件 import 它）。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 4 完成，修改 `src/permission/approve.ts`、`tests/approve.test.ts`。

---

### Task 5: markdown 渲染

**Files:**
- Create: `src/ui/markdown.ts`
- Test: `tests/markdown.test.ts`

**Interfaces:**
- Consumes: `marked`、`marked-terminal`。
- Produces: `export function renderMarkdown(text: string): string`（markdown → ANSI 终端文本，末尾去多余换行）。

- [ ] **Step 1: 写失败测试 `tests/markdown.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/ui/markdown.js";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderMarkdown", () => {
  it("渲染标题与列表后仍含原文要点", () => {
    const out = strip(renderMarkdown("# 标题\n\n- 项目一\n- 项目二"));
    expect(out).toContain("标题");
    expect(out).toContain("项目一");
    expect(out).toContain("项目二");
  });

  it("普通文本原样保留", () => {
    expect(strip(renderMarkdown("你好世界"))).toContain("你好世界");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/ui/markdown.js'`）

- [ ] **Step 3: 实现 `src/ui/markdown.ts`**

```ts
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

// 注册终端渲染器（模块级一次性）。markedTerminal 的类型与 marked 的 use() 略有出入，用 as any 兼容。
marked.use(markedTerminal() as any);

export function renderMarkdown(text: string): string {
  const rendered = marked.parse(text, { async: false }) as string;
  return rendered.trimEnd();
}
```

> 说明：若 `npm run build` 因 `marked-terminal` 的导出/类型报错，可改为 `import markedTerminal from "marked-terminal";`（默认导入）后再 `marked.use((markedTerminal as any)())`。以实际安装版本的导出为准，保证 tsc 通过。

- [ ] **Step 4: 运行测试 + 编译确认全绿**

Run: `npm test && npm run build`
Expected: PASS（markdown 2 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 5 完成，新增 `src/ui/markdown.ts`、`tests/markdown.test.ts`。

---

### Task 6: Terminal 渲染与「生成中」提示

**Files:**
- Modify: `src/ui/terminal.ts`
- 无新增单测（依赖 stdout），靠编译 + Task 7 集成与手动验收。

**Interfaces:**
- Consumes: `renderMarkdown`（Task 5）。
- Produces: `Terminal` 新增 `renderAssistant(text: string): void`、`thinkingStart(): void`、`thinkingStop(): void`。
- 注意：本任务**只**给 Terminal 增加方法（保留现有方法），不改 `LoopUI` 接口、不改 `loop.ts`，以保证编译始终通过。

- [ ] **Step 1: 修改 `src/ui/terminal.ts`**

顶部 import 增加：
```ts
import { renderMarkdown } from "./markdown.js";
```
在 `Terminal` 类里（`close()` 之前）增加：
```ts
  renderAssistant(text: string): void {
    if (!text.trim()) return;
    stdout.write(renderMarkdown(text) + "\n");
  }

  thinkingStart(): void {
    stdout.write("生成中…");
  }

  thinkingStop(): void {
    stdout.write("\r\x1b[K"); // 回到行首并清除整行
  }
```

- [ ] **Step 2: 编译 + 全量测试确认全绿**

Run: `npm run build && npm test`
Expected: tsc 无错误（Terminal 仍实现 LoopUI，新增方法为额外方法）；所有单测保持通过。

- [ ] **Step 3: 报告完成（不自动提交）**

报告：Task 6 完成，修改 `src/ui/terminal.ts`。

---

### Task 7: 主循环工具调用兜底 + 改用 markdown 渲染 + 重试

**Files:**
- Modify: `src/agent/loop.ts`, `src/provider/openai-compatible.ts`
- Test: `tests/loop.test.ts`

**Interfaces:**
- Consumes: `Terminal.renderAssistant/thinkingStart/thinkingStop`（Task 6）、`approveIfNeeded`、`Provider`。
- Produces:
  - `LoopUI` 接口：移除 `writeText`，新增 `renderAssistant(text: string): void`、`thinkingStart(): void`、`thinkingStop(): void`（其余 `toolCall`/`toolResult`/`info`/`confirm` 不变）。
  - `export function looksLikeUncalledCommand(text: string): boolean`
  - `runTurn` 行为：不再流式打印；每次 `provider.chat` 用 thinking 包裹、返回后 `ui.renderAssistant`；无 tool_call 时若疑似只写命令代码块则每轮兜底一次。
- `provider/openai-compatible.ts`：OpenAI client 配置 `maxRetries: 3`。

- [ ] **Step 1: 更新测试 `tests/loop.test.ts`**

把 `makeUI()` 改为（移除 writeText，新增 3 个方法）：
```ts
function makeUI(): LoopUI {
  return {
    renderAssistant: vi.fn(),
    thinkingStart: vi.fn(),
    thinkingStop: vi.fn(),
    toolCall: vi.fn(),
    toolResult: vi.fn(),
    info: vi.fn(),
    confirm: vi.fn(async () => true),
  };
}
```
追加 2 个用例：
```ts
  it("looksLikeUncalledCommand 识别 shell 代码块", () => {
    expect(looksLikeUncalledCommand("先执行：\n```bash\nls\n```")).toBe(true);
    expect(looksLikeUncalledCommand("这是一段普通回答")).toBe(false);
  });

  it("模型只写命令代码块未调工具时，兜底追加一轮", async () => {
    const registry = new ToolRegistry();
    const session = new Session("SYS");
    const ui = makeUI();
    const provider = scriptedProvider([
      { text: "我将运行：\n```bash\nls -R\n```", toolCalls: [] },
      { text: "好的，已说明。", toolCalls: [] },
    ]);
    const chatSpy = vi.spyOn(provider, "chat");
    await runTurn("看下目录", { provider, registry, session, ui, maxIterations: 25 });
    expect(chatSpy).toHaveBeenCalledTimes(2); // 兜底触发了第二轮
    expect(session.messages.some((m) => m.role === "user" && String(m.content).includes("系统提醒"))).toBe(true);
  });
```
并在顶部 import 增加 `looksLikeUncalledCommand`：
```ts
import { runTurn, LoopUI, looksLikeUncalledCommand } from "../src/agent/loop.js";
```

> 注：`scriptedProvider` 当前返回的对象需要可被 `vi.spyOn(provider, "chat")` 监听——确认其实现是对象方法 `chat`（现有实现即如此）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`looksLikeUncalledCommand` 未导出；makeUI 类型/兜底行为不满足）

- [ ] **Step 3: 重写 `src/agent/loop.ts`**

完整替换文件内容为：
```ts
import { Provider } from "../provider/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { Session } from "../context/session.js";
import { approveIfNeeded } from "../permission/approve.js";

export interface LoopUI {
  renderAssistant(text: string): void;
  thinkingStart(): void;
  thinkingStop(): void;
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

export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
}

// 启发式：文本里出现 shell 类围栏代码块，疑似模型只描述命令而没真正调用工具
export function looksLikeUncalledCommand(text: string): boolean {
  return /```(bash|sh|shell|zsh|console)\b/i.test(text);
}

export async function runTurn(
  input: string,
  deps: LoopDeps,
  signal?: AbortSignal
): Promise<TurnUsage> {
  const { provider, registry, session, ui, maxIterations } = deps;
  session.addUser(input);

  let promptTokens = 0;
  let completionTokens = 0;
  let nudged = false;

  try {
    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) {
        ui.info("已中断当前操作。");
        return { promptTokens, completionTokens };
      }

      ui.thinkingStart();
      let result;
      try {
        result = await provider.chat({
          messages: session.messages,
          tools: registry.schemas(),
          signal,
        });
      } finally {
        ui.thinkingStop();
      }

      session.addAssistant(result.text, result.toolCalls);
      ui.renderAssistant(result.text);

      if (result.usage) {
        promptTokens += result.usage.promptTokens;
        completionTokens += result.usage.completionTokens;
      }

      if (result.toolCalls.length === 0) {
        // 工具调用兜底：疑似只写了命令代码块、未真正调用工具 → 督促一次
        if (!nudged && looksLikeUncalledCommand(result.text)) {
          nudged = true;
          session.addUser("（系统提醒）请直接调用工具来执行，不要只在回答里用代码块写出命令。");
          continue;
        }
        return { promptTokens, completionTokens };
      }

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

- [ ] **Step 4: 修改 `src/provider/openai-compatible.ts` 加 maxRetries**

把构造里：
```ts
    const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
```
改为：
```ts
    const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 3 });
```

- [ ] **Step 5: 运行测试 + 编译确认全绿**

Run: `npm test && npm run build`
Expected: PASS（loop 新 2 个用例 + 原有 loop 用例 + 全部其它）；tsc 无错误（Terminal 已在 Task 6 实现 LoopUI 的新方法）。

- [ ] **Step 6: 手动验收（需用户用真实 GLM key 执行 `npm run dev`）**

逐条验证：
1. 随便问一句 → 助手回答应以 **markdown 渲染**整段输出；等待时短暂出现「生成中…」再被清除。
2. 「帮我分析项目目录结构」→ 这次更可能真正调用工具（read_file/list_files/bash）；若它仍只写命令代码块，应观察到自动追加「（系统提醒）…」并再跑一轮。
3. 「用 list_files 找出所有 .ts 文件」→ 触发 `list_files`，返回路径列表。
4. 「在 hello.txt 写入 abc」→ 确认时显示**彩色 diff**（新增绿色）；对已存在文件做 edit 应显示增删对比。
5. `/tools` 列工具、`/model` 显示模型。
6. （重试较难构造，确认 `openai-compatible.ts` 已配 `maxRetries: 3` 即可。）

- [ ] **Step 7: 报告完成（不自动提交）**

报告：Task 7 完成，修改 `src/agent/loop.ts`、`src/provider/openai-compatible.ts`、`tests/loop.test.ts`，附手动验收结果。

---

## Self-Review

**Spec 覆盖检查：**
- A1 工具调用兜底 → Task 7（`looksLikeUncalledCommand` + nudge，max 1）✅
- A2 list_files glob → Task 1 ✅
- A3 /tools /model → Task 2 ✅
- B1 diff 渲染 → Task 3（renderDiff）+ Task 4（接入 write/edit 预览，异步读文件）✅
- B2 markdown 渲染 → Task 5（renderMarkdown）+ Task 6（Terminal.renderAssistant）+ Task 7（loop 改用 renderAssistant + thinking）✅
- B3 错误重试 → Task 7 Step 4（maxRetries）✅
- 关键体验变化（流式→缓冲渲染 + 生成中提示）→ Task 6 + Task 7 ✅
- 验收标准每条均有任务对应 + Task 7 Step 6 手动核对 ✅

**占位符扫描：** 无 TBD/TODO/「类似上面」；每个代码步骤均有完整代码或精确改法。markdown 库导出差异已给出确定的 fallback 写法。✅

**类型一致性：** `renderDiff(old,new):string`、`renderMarkdown(text):string`、`buildPreview(call):Promise<string>`、`listFilesTool`、`CommandContext{session,registry,model}`、`looksLikeUncalledCommand(text):boolean`、`LoopUI{renderAssistant,thinkingStart,thinkingStop,toolCall,toolResult,info,confirm}`、`runTurn(input,deps,signal?):Promise<TurnUsage>` 在各任务间一致。`describeCall` 被 `buildPreview` 取代且确认无其它引用（Task 4 Step 4 校验）。LoopUI 移除 writeText 的影响仅限 loop.ts 与 loop.test 的 makeUI（Task 7 同步处理）。✅
