# void-code CLAUDE.md 注入 + /init + 文档同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 启动时注入项目+全局 CLAUDE.md 到系统提示；新增 `/init` 斜杠命令（agent 探索项目并生成 CLAUDE.md）；同步 README/ARCHITECTURE 文档。

**Architecture:** 新增 `context/project-context.ts`（读并合并两处 CLAUDE.md）；`/init` 通过给 `CommandResult` 加 `runPrompt` 字段、由 index 当一次普通对话跑来复用主循环；文档更新到与当前代码一致。

**Tech Stack:** TypeScript + Node.js (ESM)、node 内置 fs/os/path、`vitest`。

## Global Constraints

- **运行时**：ESM（`"type":"module"`），TypeScript `NodeNext`，源码 import 一律带 `.js` 后缀。
- **测试框架**：`vitest`，测试放 `tests/`；写盘测试用 `tests/.tmp-*` 临时目录，**不要碰真实 `~/.void-code` 或项目根的真实 CLAUDE.md**。
- **不破坏现有功能**：现有 84 个单测保持全绿（个别因接口扩展需同步更新的除外）。
- **CLAUDE.md 注入仅作用于新会话**；`--resume` 不注入。
- **语言**：面向用户文案用中文；标识符用英文。
- **提交策略（覆盖默认）**：禁止自动 `git commit`/`git push`。每个任务最后一步是「向用户报告完成并列出改动文件，由用户自行提交」。

---

## File Structure

| 文件 | 改动 | 任务 |
|------|------|------|
| `src/context/project-context.ts` | **新增** loadProjectContext + defaultGlobalDir | Task 1 |
| `src/ui/commands.ts` | CommandResult += runPrompt；/init + INIT_PROMPT；help 补 /init | Task 2 |
| `src/index.ts` | 新会话注入 CLAUDE.md；处理 cmd.runPrompt 跑一轮 | Task 3 |
| `README.md` | 同步新能力 | Task 4 |
| `docs/ARCHITECTURE.md` | 同步新能力 | Task 4 |

---

### Task 1: CLAUDE.md 读取与合并

**Files:**
- Create: `src/context/project-context.ts`
- Test: `tests/project-context.test.ts`

**Interfaces:**
- Produces:
  - `function defaultGlobalDir(): string`（返回 `~/.void-code`）
  - `function loadProjectContext(cwd: string, globalDir: string): Promise<string>`（合并全局+项目 CLAUDE.md；缺失跳过；都无返回 `""`；有内容时以 `\n\n` 开头）

- [ ] **Step 1: 写失败测试 `tests/project-context.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { loadProjectContext } from "../src/context/project-context.js";

const base = "tests/.tmp-ctx";
const proj = `${base}/proj`;
const glob = `${base}/glob`;

beforeAll(async () => {
  await mkdir(proj, { recursive: true });
  await mkdir(glob, { recursive: true });
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("loadProjectContext", () => {
  it("都没有时返回空字符串", async () => {
    expect(await loadProjectContext(proj, `${base}/none`)).toBe("");
  });

  it("仅项目 CLAUDE.md", async () => {
    await writeFile(`${proj}/CLAUDE.md`, "项目约定A");
    const out = await loadProjectContext(proj, `${base}/none`);
    expect(out).toContain("项目记忆");
    expect(out).toContain("项目约定A");
    expect(out).not.toContain("全局记忆");
  });

  it("项目 + 全局都有时合并，全局在前", async () => {
    await writeFile(`${proj}/CLAUDE.md`, "项目约定A");
    await writeFile(`${glob}/CLAUDE.md`, "全局约定B");
    const out = await loadProjectContext(proj, glob);
    expect(out).toContain("全局约定B");
    expect(out).toContain("项目约定A");
    expect(out.indexOf("全局约定B")).toBeLessThan(out.indexOf("项目约定A"));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/context/project-context.js'`）

- [ ] **Step 3: 实现 `src/context/project-context.ts`**

```ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultGlobalDir(): string {
  return join(homedir(), ".void-code");
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function loadProjectContext(cwd: string, globalDir: string): Promise<string> {
  const globalContent = await readIfExists(join(globalDir, "CLAUDE.md"));
  const projectContent = await readIfExists(join(cwd, "CLAUDE.md"));

  const parts: string[] = [];
  if (globalContent && globalContent.trim()) {
    parts.push(`# 全局记忆（~/.void-code/CLAUDE.md）\n${globalContent.trim()}`);
  }
  if (projectContent && projectContent.trim()) {
    parts.push(`# 项目记忆（CLAUDE.md）\n${projectContent.trim()}`);
  }
  if (parts.length === 0) return "";
  return "\n\n" + parts.join("\n\n");
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（project-context 3 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 1 完成，新增 `src/context/project-context.ts`、`tests/project-context.test.ts`。

---

### Task 2: /init 命令 + runPrompt

**Files:**
- Modify: `src/ui/commands.ts`
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: 现有 `handleCommand`、`CommandContext`。
- Produces:
  - `CommandResult` 增加可选 `runPrompt?: string`。
  - `export const INIT_PROMPT: string`。
  - `/init` → `{ handled: true, runPrompt: INIT_PROMPT }`；`/help` 文本含 `/init`。

- [ ] **Step 1: 写失败测试（追加到 `tests/commands.test.ts`）**

```ts
  it("/init 返回 runPrompt（含 CLAUDE.md 指令）", () => {
    const r = handleCommand("/init", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.runPrompt).toBeTruthy();
    expect(r.runPrompt).toContain("CLAUDE.md");
  });

  it("/help 列出 /init", () => {
    const r = handleCommand("/help", makeCtx());
    expect(r.message).toContain("/init");
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`/init` 走到 default 未知命令；help 不含 /init）

- [ ] **Step 3: 修改 `src/ui/commands.ts`**

`CommandResult` 接口增加字段：
```ts
export interface CommandResult {
  handled: boolean;
  message?: string;
  exit?: boolean;
  runPrompt?: string;
}
```
在文件顶部（import 之后、handleCommand 之前）增加常量：
```ts
export const INIT_PROMPT = `请分析当前项目并生成或更新一份 CLAUDE.md 文件，用于让 AI 编码助手快速理解本项目。请按以下步骤：
1. 用 list_files、read_file、search 查看项目结构、package.json、README 和关键源码；
2. 总结：项目用途、技术栈、构建/测试/运行命令、目录结构与架构、代码约定；
3. 用 write_file 写入 ./CLAUDE.md。若已存在 CLAUDE.md，先用 read_file 读它、在其基础上更新。
内容要简洁、面向 AI 助手。`;
```
在 `switch (cmd)` 中 `case "model":` 之后、`case "exit":` 之前增加：
```ts
    case "init":
      return { handled: true, runPrompt: INIT_PROMPT };
```
在 `helpText` 的命令清单里（`/model` 那行之后）加一行：
```ts
    "  /init  — 分析当前项目并生成 CLAUDE.md",
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（commands 新 2 个 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 2 完成，修改 `src/ui/commands.ts`、`tests/commands.test.ts`。

---

### Task 3: index 串联 —— 注入 CLAUDE.md + 跑 /init

**Files:**
- Modify: `src/index.ts`
- 无新增单测（集成 + 读真实文件），靠全量测试 + 编译 + 手动验收。

**Interfaces:**
- Consumes: `loadProjectContext`/`defaultGlobalDir`（Task 1）、`CommandResult.runPrompt`（Task 2）、现有 `runTurn`/`handleCommand`/`buildSystemPrompt`/`Session`。

- [ ] **Step 1: 顶部 import 增加**

```ts
import { loadProjectContext, defaultGlobalDir } from "./context/project-context.js";
```

- [ ] **Step 2: 新会话系统提示注入 CLAUDE.md**

在「会话初始化」之前，先算好注入后的系统提示（放在 `const args = parseArgs(...)` 之后、`let session...` 之前）：
```ts
  const baseSystemPrompt =
    buildSystemPrompt(process.cwd(), process.platform) +
    (await loadProjectContext(process.cwd(), defaultGlobalDir()));
```
然后把两个**新建会话**分支里的 `new Session(buildSystemPrompt(process.cwd(), process.platform))` 都改为：
```ts
      session = new Session(baseSystemPrompt);
```
（`--resume` 成功分支保持 `new Session(sanitizeMessages(stored.messages))` 不变——不注入。）

- [ ] **Step 3: REPL 处理 cmd.runPrompt（把 /init 当一次对话跑）**

把现有 REPL 循环里命令分发那段：
```ts
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
```
替换为：
```ts
    const cmd = handleCommand(input, ctx);
    if (cmd.handled) {
      if (cmd.message) ui.info(cmd.message);
      if (cmd.exit) break;
      if (!cmd.runPrompt) continue;
    } else if (input === "exit") {
      break; // 兼容旧的纯 exit
    }

    const turnInput = cmd.runPrompt ?? input;
    activeController = new AbortController();
    try {
      const used = await runTurn(turnInput, deps, activeController.signal);
```
（其余 token 显示 / 压缩 / finally 保存逻辑不变。）

- [ ] **Step 4: 全量测试 + 编译**

Run: `npm test && npm run build`
Expected: 所有单测 PASS；tsc 无错误。

- [ ] **Step 5: 手动验收（需用户用真实 GLM key 执行 `npm run dev`）**

1. 在项目根 `npm run dev`，输入 `/init` → 模型应调用 list_files/read_file 等探索项目，最后 `write_file` 写 `./CLAUDE.md`（弹 y/n 确认，已存在则显示 diff）。确认后检查 CLAUDE.md 内容合理。
2. `/help` → 应列出 `/init`。
3. 退出后**新开**一轮 `npm run dev`（新会话），问「这个项目的构建命令是什么/有哪些约定」→ 模型应能答出 CLAUDE.md 里的内容（说明注入生效）。
4. （可选）在 `~/.void-code/CLAUDE.md` 放一条全局约定，重启后验证也被注入。
5. `npm run dev -- --resume` 恢复旧会话 → 不应重复注入（行为正常即可）。

- [ ] **Step 6: 报告完成（不自动提交）**

报告：Task 3 完成，修改 `src/index.ts`，附手动验收结果。

---

### Task 4: 文档同步（README + ARCHITECTURE）

**Files:**
- Modify: `README.md`, `docs/ARCHITECTURE.md`
- 无测试（文档），靠人工检查。

**Interfaces:**
- Consumes: 当前已实现的全部功能（实现者需先通读 `src/` 与现有两份文档确认现状）。

- [ ] **Step 1: 通读现状**

先 `Read` 当前 `README.md`、`docs/ARCHITECTURE.md`，并扫一遍 `src/`（尤其 `ui/commands.ts`、`tools/`、`agent/loop.ts`、`context/`、`cli.ts`），确认当前真实能力，避免写出与代码不符的内容。

- [ ] **Step 2: 更新 `README.md`**

按以下清单更新（保持原有风格与结构）：
- **命令表**：补 `/help`、`/tools`、`/model`、`/clear`、`/init`、`/exit` 各一行说明。
- **工具表**：补 `list_files`（glob 列文件，只读，无需确认）。
- **会话恢复**：新增一小节说明 `npm run dev -- --resume`（接最近）与 `--resume <id>`（接指定）。
- **CLAUDE.md**：新增一小节说明启动时会注入 `./CLAUDE.md` 与 `~/.void-code/CLAUDE.md`，以及可用 `/init` 生成项目 CLAUDE.md。
- **配置项（环境变量）表**：补 `VOID_COMPACT_THRESHOLD`（默认 8000）、`VOID_COMPACT_KEEP_RECENT`（默认 6）。

- [ ] **Step 3: 更新 `docs/ARCHITECTURE.md`**

- 在「代码结构地图」表中补上新增模块：`ui/commands.ts`（斜杠命令）、`ui/diff.ts`、`ui/markdown.ts`、`tools/list.ts`、`context/store.ts`（会话持久化）、`context/compact.ts`（历史压缩）、`context/project-context.ts`（CLAUDE.md 注入）、`cli.ts`（参数解析）。
- 「§7 已知缺口」：把已实现的项移除/标注为已完成——`read_file` 分段读、`list_files`、历史压缩、diff/markdown 渲染、token 统计、斜杠命令、Ctrl+C、会话持久化/恢复、CLAUDE.md 注入 均已实现；保留仍未做的（如 `search` 单文件大小上限、多 Provider、MCP、子 agent、富 TUI）。
- 在「§4 核心实现」或合适位置补一两句：助手输出现为 markdown 缓冲渲染、写操作确认含彩色 diff、每轮显示 token、会话每轮自动持久化、超阈值自动压缩、`/init` 可生成 CLAUDE.md、启动注入 CLAUDE.md。

- [ ] **Step 4: 自查一致性**

通读改完的两份文档，确认：没有把未实现的说成已实现；命令/工具/配置名与代码完全一致（如 `list_files`、`VOID_COMPACT_THRESHOLD`、`/init`）。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 4 完成，修改 `README.md`、`docs/ARCHITECTURE.md`，并列出主要更新点。

---

## Self-Review

**Spec 覆盖检查：**
- CLAUDE.md 注入（loadProjectContext + 新会话注入 + resume 不注入）→ Task 1 + Task 3（Step 2）✅
- /init（CommandResult.runPrompt + INIT_PROMPT + index 跑一轮 + help）→ Task 2 + Task 3（Step 3）✅
- 文档同步（README + ARCHITECTURE）→ Task 4 ✅
- 验收标准每条均有任务对应 + Task 3 Step 5 手动核对 ✅
- 不破坏现有：每任务跑全量测试；注入只加在新会话、resume 路径不变 ✅

**占位符扫描：** 无 TBD/TODO/「类似上面」；代码步骤均有完整代码；文档任务给出了具体改动清单（非泛化「补文档」）。✅

**类型一致性：** `defaultGlobalDir():string`、`loadProjectContext(cwd,globalDir):Promise<string>`、`CommandResult.runPrompt?`、`INIT_PROMPT`、index 里 `turnInput = cmd.runPrompt ?? input`、新会话用 `baseSystemPrompt`、resume 仍用 `sanitizeMessages(stored.messages)` 在各任务间一致。✅
