# void-code Phase 3 上下文管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加历史压缩（超阈值时模型摘要旧消息）+ 会话持久化/恢复（`--resume`），补齐最后一块核心能力。

**Architecture:** 新增 `context/store.ts`（持久化到 `~/.void-code/sessions/<项目哈希>/`）、`context/compact.ts`（字符数粗估触发 + 模型摘要）、`cli.ts`（解析 --resume）；`Session` 构造器支持从消息数组重建；`index.ts` 串联恢复 + 每轮自动保存 + 压缩。

**Tech Stack:** TypeScript + Node.js (ESM)、node 内置 fs/os/path/crypto、`vitest`。

## Global Constraints

- **运行时**：ESM（`"type":"module"`），TypeScript `NodeNext`，源码 import 一律带 `.js` 后缀。
- **测试框架**：`vitest`，测试放 `tests/`，命名 `*.test.ts`；写盘测试用 `tests/.tmp-*` 临时目录，**不要碰真实 `~/.void-code`**。
- **不破坏现有功能**：现有 68 个单测保持全绿（个别因接口扩展需同步更新的除外，见任务）。
- **压缩默认阈值**：`compactThreshold` 默认 **8000**（env `VOID_COMPACT_THRESHOLD`）；`compactKeepRecent` 默认 **6**（env `VOID_COMPACT_KEEP_RECENT`）。
- **token 粗估**：`estimateTokens` = 总字符数 / 4（向上取整）。
- **语言**：面向用户文案用中文；标识符用英文。
- **提交策略（覆盖默认）**：禁止自动 `git commit`/`git push`。每个任务最后一步是「向用户报告完成并列出改动文件，由用户自行提交」。

---

## File Structure

| 文件 | 改动 | 任务 |
|------|------|------|
| `src/cli.ts` | **新增** parseArgs(--resume) | Task 1 |
| `src/context/session.ts` | 构造器支持 `string \| ChatMessage[]` | Task 2 |
| `src/config.ts` | 加 compactThreshold / compactKeepRecent | Task 3 |
| `src/context/compact.ts` | **新增** estimateTokens + compactIfNeeded | Task 4 |
| `src/context/store.ts` | **新增** SessionStore | Task 5 |
| `src/index.ts` | --resume + 每轮自动保存 + 压缩接线 | Task 6 |

---

### Task 1: CLI 参数解析

**Files:**
- Create: `src/cli.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Produces: `interface ParsedArgs { resume: boolean; resumeId?: string }`；`function parseArgs(argv: string[]): ParsedArgs`。

- [ ] **Step 1: 写失败测试 `tests/cli.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("无 --resume", () => {
    expect(parseArgs([])).toEqual({ resume: false });
  });
  it("--resume 无 id", () => {
    expect(parseArgs(["--resume"])).toEqual({ resume: true });
  });
  it("--resume 带 id", () => {
    expect(parseArgs(["--resume", "abc123"])).toEqual({ resume: true, resumeId: "abc123" });
  });
  it("--resume 后跟另一个 flag 不当作 id", () => {
    expect(parseArgs(["--resume", "--foo"])).toEqual({ resume: true });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/cli.js'`）

- [ ] **Step 3: 实现 `src/cli.ts`**

```ts
export interface ParsedArgs {
  resume: boolean;
  resumeId?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const idx = argv.indexOf("--resume");
  if (idx === -1) return { resume: false };
  const next = argv[idx + 1];
  if (next && !next.startsWith("--")) return { resume: true, resumeId: next };
  return { resume: true };
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test`
Expected: PASS（cli 4 个用例 + 其余全部）

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 1 完成，新增 `src/cli.ts`、`tests/cli.test.ts`。

---

### Task 2: Session 构造器支持消息数组重建

**Files:**
- Modify: `src/context/session.ts`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`。
- Produces: `Session` 构造器签名改为 `constructor(init: string | ChatMessage[])`——字符串=系统提示（现状）；消息数组=从已有消息重建。其余方法不变。

- [ ] **Step 1: 写失败测试（追加到 `tests/session.test.ts` 的 `describe("Session", ...)` 内）**

```ts
  it("用消息数组构造时直接重建历史", () => {
    const msgs: import("../src/provider/types.js").ChatMessage[] = [
      { role: "system", content: "SYS" },
      { role: "user", content: "hi" },
    ];
    const s = new Session([...msgs]);
    expect(s.messages).toEqual(msgs);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（传数组时类型不符 / messages 不等）

- [ ] **Step 3: 实现 —— 修改 `src/context/session.ts` 的构造器**

把：
```ts
  constructor(systemPrompt: string) {
    this.messages.push({ role: "system", content: systemPrompt });
  }
```
改为：
```ts
  constructor(init: string | ChatMessage[]) {
    if (typeof init === "string") {
      this.messages.push({ role: "system", content: init });
    } else {
      this.messages.push(...init);
    }
  }
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（现有 `new Session("SYS")` 调用仍兼容）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 2 完成，修改 `src/context/session.ts`、`tests/session.test.ts`。

---

### Task 3: config 增加压缩阈值

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `Config` 增加 `compactThreshold: number`、`compactKeepRecent: number`；默认 8000 / 6，env `VOID_COMPACT_THRESHOLD` / `VOID_COMPACT_KEEP_RECENT` 可覆盖。

- [ ] **Step 1: 写失败测试（追加到 `tests/config.test.ts`）**

```ts
  it("压缩阈值默认值与 env 覆盖", () => {
    const def = loadConfig({ GLM_API_KEY: "k" });
    expect(def.compactThreshold).toBe(8000);
    expect(def.compactKeepRecent).toBe(6);
    const ov = loadConfig({ GLM_API_KEY: "k", VOID_COMPACT_THRESHOLD: "100", VOID_COMPACT_KEEP_RECENT: "2" });
    expect(ov.compactThreshold).toBe(100);
    expect(ov.compactKeepRecent).toBe(2);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`compactThreshold` 为 undefined）

- [ ] **Step 3: 实现 —— 修改 `src/config.ts`**

`Config` 接口增加两个字段：
```ts
  compactThreshold: number;
  compactKeepRecent: number;
```
`loadConfig` 的 return 对象增加两行：
```ts
    compactThreshold: Number(env.VOID_COMPACT_THRESHOLD ?? 8000),
    compactKeepRecent: Number(env.VOID_COMPACT_KEEP_RECENT ?? 6),
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 3 完成，修改 `src/config.ts`、`tests/config.test.ts`。

---

### Task 4: 历史压缩

**Files:**
- Create: `src/context/compact.ts`
- Test: `tests/compact.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`、`Provider`（`src/provider/types.js`）、`Session`（`src/context/session.js`）。
- Produces:
  - `function estimateTokens(messages: ChatMessage[]): number`
  - `interface CompactOptions { threshold: number; keepRecent: number }`
  - `function compactIfNeeded(session: Session, provider: Provider, opts: CompactOptions): Promise<boolean>`（超阈值则用模型摘要中间消息、原地替换 `session.messages`、返回 true；否则 false）

- [ ] **Step 1: 写失败测试 `tests/compact.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { estimateTokens, compactIfNeeded } from "../src/context/compact.js";
import { Session } from "../src/context/session.js";
import { ChatMessage, Provider } from "../src/provider/types.js";

describe("estimateTokens", () => {
  it("按字符数/4 粗估", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "12345678" }]; // 8 字符
    expect(estimateTokens(msgs)).toBe(2);
  });
});

function fakeProvider(summary: string): Provider {
  return { chat: vi.fn(async () => ({ text: summary, toolCalls: [] })) } as unknown as Provider;
}

describe("compactIfNeeded", () => {
  it("未超阈值不压缩，返回 false", async () => {
    const s = new Session("SYS");
    s.addUser("hi");
    expect(await compactIfNeeded(s, fakeProvider("S"), { threshold: 100000, keepRecent: 6 })).toBe(false);
  });

  it("超阈值时摘要中间消息，保留系统提示+摘要+最近 keepRecent 条", async () => {
    const s = new Session("SYS");
    for (let i = 0; i < 10; i++) s.addUser("x".repeat(50));
    const compacted = await compactIfNeeded(s, fakeProvider("这是摘要"), { threshold: 10, keepRecent: 2 });
    expect(compacted).toBe(true);
    expect(s.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(s.messages[1].content).toContain("此前对话的摘要");
    expect(s.messages[1].content).toContain("这是摘要");
    expect(s.messages).toHaveLength(4); // system + 摘要 + 最近 2 条
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/context/compact.js'`）

- [ ] **Step 3: 实现 `src/context/compact.ts`**

```ts
import { ChatMessage, Provider } from "../provider/types.js";
import { Session } from "./session.js";

export function estimateTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((sum, m) => {
    const content = m.content ? m.content.length : 0;
    const tools = m.tool_calls ? JSON.stringify(m.tool_calls).length : 0;
    return sum + content + tools;
  }, 0);
  return Math.ceil(chars / 4);
}

export interface CompactOptions {
  threshold: number;
  keepRecent: number;
}

export async function compactIfNeeded(
  session: Session,
  provider: Provider,
  opts: CompactOptions
): Promise<boolean> {
  const msgs = session.messages;
  if (estimateTokens(msgs) <= opts.threshold) return false;

  const system = msgs[0];
  const recentStart = Math.max(1, msgs.length - opts.keepRecent);
  const toCompact = msgs.slice(1, recentStart);
  if (toCompact.length === 0) return false; // 没有可压缩的中间消息

  const recent = msgs.slice(recentStart);
  const summaryText = await summarize(provider, toCompact);
  const summaryMsg: ChatMessage = {
    role: "user",
    content: `（此前对话的摘要）\n${summaryText}`,
  };

  // 原地替换 session.messages 内容（messages 属性 readonly，但数组可变）
  session.messages.splice(0, session.messages.length, system, summaryMsg, ...recent);
  return true;
}

async function summarize(provider: Provider, messages: ChatMessage[]): Promise<string> {
  const text = messages.map((m) => `[${m.role}] ${m.content ?? ""}`).join("\n");
  const result = await provider.chat({
    messages: [
      {
        role: "system",
        content:
          "把下面的对话历史压缩成简洁摘要，保留关键事实、做出的决定、文件改动和未完成的事项。只输出摘要正文，不要寒暄。",
      },
      { role: "user", content: text },
    ],
    tools: [],
  });
  return result.text;
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（compact 3 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 4 完成，新增 `src/context/compact.ts`、`tests/compact.test.ts`。

---

### Task 5: 会话持久化 SessionStore

**Files:**
- Create: `src/context/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`、node 内置 fs/os/path/crypto。
- Produces:
  - `interface StoredSession { id: string; cwd: string; createdAt: string; updatedAt: string; messages: ChatMessage[] }`
  - `class SessionStore`，构造 `(baseDir?: string)`（默认 `~/.void-code`），方法：
    - `newId(now: Date): string`
    - `save(session: { id: string; cwd: string; createdAt: string; messages: ChatMessage[] }): Promise<void>`
    - `load(cwd: string, id: string): Promise<StoredSession | null>`
    - `loadLatest(cwd: string): Promise<StoredSession | null>`

- [ ] **Step 1: 写失败测试 `tests/store.test.ts`**

```ts
import { describe, it, expect, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { SessionStore } from "../src/context/store.js";
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/context/store.js'`）

- [ ] **Step 3: 实现 `src/context/store.ts`**

```ts
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ChatMessage } from "../provider/types.js";

export interface StoredSession {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

function projectKey(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

export class SessionStore {
  constructor(private baseDir: string = join(homedir(), ".void-code")) {}

  private dirFor(cwd: string): string {
    return join(this.baseDir, "sessions", projectKey(cwd));
  }

  newId(now: Date): string {
    return now.toISOString().replace(/[:.]/g, "-");
  }

  async save(session: {
    id: string;
    cwd: string;
    createdAt: string;
    messages: ChatMessage[];
  }): Promise<void> {
    const dir = this.dirFor(session.cwd);
    await mkdir(dir, { recursive: true });
    const stored: StoredSession = {
      id: session.id,
      cwd: session.cwd,
      createdAt: session.createdAt,
      updatedAt: new Date().toISOString(),
      messages: session.messages,
    };
    await writeFile(join(dir, `${session.id}.json`), JSON.stringify(stored, null, 2), "utf8");
  }

  async load(cwd: string, id: string): Promise<StoredSession | null> {
    try {
      const raw = await readFile(join(this.dirFor(cwd), `${id}.json`), "utf8");
      return JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
  }

  async loadLatest(cwd: string): Promise<StoredSession | null> {
    let files: string[];
    try {
      files = (await readdir(this.dirFor(cwd))).filter((f) => f.endsWith(".json"));
    } catch {
      return null;
    }
    if (files.length === 0) return null;
    files.sort();
    const latest = files[files.length - 1].replace(/\.json$/, "");
    return this.load(cwd, latest);
  }
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（store 4 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 5 完成，新增 `src/context/store.ts`、`tests/store.test.ts`。

---

### Task 6: index 串联 —— 恢复 + 自动保存 + 压缩

**Files:**
- Modify: `src/index.ts`
- 无新增单测（集成 + 写真实盘），靠全量测试 + 编译 + 手动验收。

**Interfaces:**
- Consumes: `parseArgs`（Task 1）、`new Session(messages[])`（Task 2）、`config.compactThreshold/compactKeepRecent`（Task 3）、`compactIfNeeded`（Task 4）、`SessionStore`（Task 5）。

- [ ] **Step 1: 修改 `src/index.ts` 顶部 import**

增加：
```ts
import { parseArgs } from "./cli.js";
import { SessionStore } from "./context/store.js";
import { compactIfNeeded } from "./context/compact.js";
```

- [ ] **Step 2: 修改 `main()` —— 会话初始化（恢复或新建）**

把现有这段（注意保留 provider/registry 的创建）：
```ts
  const session = new Session(buildSystemPrompt(process.cwd(), process.platform));
  const ui = new Terminal();
  ui.info(`void-code 已启动（模型 ${config.model}）。输入需求，或 /help 查看命令，exit 退出。`);
```
替换为：
```ts
  const ui = new Terminal();
  const store = new SessionStore();
  const args = parseArgs(process.argv.slice(2));

  let session: Session;
  let sessionId: string;
  let createdAt: string;

  if (args.resume) {
    const stored = args.resumeId
      ? await store.load(process.cwd(), args.resumeId)
      : await store.loadLatest(process.cwd());
    if (stored) {
      session = new Session(stored.messages);
      sessionId = stored.id;
      createdAt = stored.createdAt;
      ui.info(`已恢复会话 ${stored.id}（${stored.messages.length} 条消息）。`);
    } else {
      ui.info("没有可恢复的会话，开始新会话。");
      session = new Session(buildSystemPrompt(process.cwd(), process.platform));
      sessionId = store.newId(new Date());
      createdAt = new Date().toISOString();
    }
  } else {
    session = new Session(buildSystemPrompt(process.cwd(), process.platform));
    sessionId = store.newId(new Date());
    createdAt = new Date().toISOString();
  }

  ui.info(`void-code 已启动（模型 ${config.model}）。输入需求，或 /help 查看命令，exit 退出。`);
```

- [ ] **Step 3: 修改 REPL 循环 —— 每轮后自动保存 + 压缩**

在 `runTurn` 那段的 `try` 块里，把 token 显示之后、`catch` 之前的位置补上保存与压缩（即在 `ui.usage(...)` 那个 `if` 块之后）：
```ts
      await store.save({ id: sessionId, cwd: process.cwd(), createdAt, messages: session.messages });
      try {
        if (
          await compactIfNeeded(session, provider, {
            threshold: config.compactThreshold,
            keepRecent: config.compactKeepRecent,
          })
        ) {
          ui.info("（已压缩历史以节省上下文）");
          await store.save({ id: sessionId, cwd: process.cwd(), createdAt, messages: session.messages });
        }
      } catch {
        // 压缩失败不影响主流程
      }
```

> 完整的 try 块结构应为：`runTurn` → 累加并显示 token → `store.save` → 压缩（best-effort）→ `catch (e) { ui.info("出错：...") }` → `finally { activeController = null }`。

- [ ] **Step 4: 全量测试 + 编译**

Run: `npm test && npm run build`
Expected: 所有单测 PASS；tsc 无错误。

- [ ] **Step 5: 手动验收（需用户用真实 GLM key 执行）**

1. `npm run dev`，聊几句后退出 → 检查 `~/.void-code/sessions/<哈希>/` 下生成了 `.json` 文件。
2. `npm run dev -- --resume` → 应打印「已恢复会话 …（N 条消息）」，且模型记得之前聊的内容。
3. 复制某个 session id，`npm run dev -- --resume <id>` → 恢复指定会话。
4. 把阈值调小快速验证压缩：`VOID_COMPACT_THRESHOLD=200 npm run dev`，多聊几轮 → 应出现「（已压缩历史以节省上下文）」，且对话仍连贯。
5. 在没有任何历史的新目录里 `npm run dev -- --resume` → 应提示「没有可恢复的会话，开始新会话」。

- [ ] **Step 6: 报告完成（不自动提交）**

报告：Task 6 完成，修改 `src/index.ts`，附手动验收结果。

---

## Self-Review

**Spec 覆盖检查：**
- 会话持久化（路径/内容/保存时机/SessionStore）→ Task 5 + Task 6（接线、自动保存）✅
- 恢复（--resume / --resume id / 无会话提示）→ Task 1（parseArgs）+ Task 6（恢复逻辑）✅
- Session 从消息重建 → Task 2 ✅
- 历史压缩（estimateTokens 触发 + 模型摘要 + 保留 system+摘要+最近）→ Task 4 + Task 6（接线）✅
- 配置阈值 → Task 3 ✅
- 验收标准每条均有任务对应 + Task 6 Step 5 手动核对 ✅
- 不破坏现有：每个任务 Step 跑全量测试；Session 构造器 string 路径、config 既有字段均保持 ✅

**占位符扫描：** 无 TBD/TODO/「类似上面」；每个代码步骤均有完整代码或精确改法。✅

**类型一致性：** `ParsedArgs{resume,resumeId?}`、`parseArgs(argv):ParsedArgs`、`Session(init: string|ChatMessage[])`、`Config.compactThreshold/compactKeepRecent`、`estimateTokens(messages):number`、`CompactOptions{threshold,keepRecent}`、`compactIfNeeded(session,provider,opts):Promise<boolean>`、`StoredSession{id,cwd,createdAt,updatedAt,messages}`、`SessionStore.newId(now)/save/load/loadLatest` 在各任务与 index 串联中一致。index 用到的 `sessionId/createdAt` 在新建与恢复两路径都被赋值。✅
