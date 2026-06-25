# void-code 架构与实现说明

> 一个对标 Claude Code 的最小 agentic 编码 CLI（学习项目）。本文讲清楚**代码结构**和**关键实现逻辑**，帮你快速建立全局心智模型。
>
> 配套文档：设计 spec 见 `docs/superpowers/specs/`，实现计划见 `docs/superpowers/plans/`。

---

## 1. 一句话定位

你在终端用自然语言提需求，程序把你的话连同「可用工具清单」发给大模型（GLM-4-Flash）；模型决定要调用哪个工具（读文件 / 写文件 / 执行命令 / 搜索），程序**真实执行**这些工具、把结果喂回模型，如此往复，直到模型不再需要工具、给出最终回答。

这个「**模型决策 → 执行工具 → 喂回结果 → 再决策**」的循环，就是所有 vibe coding 工具的灵魂。

---

## 2. 顶层数据流：一次对话发生了什么

```
你输入一句话
   │
   ▼
┌─────────────────────────────────────────────┐
│ Agent 主循环 (runTurn)                         │
│                                                │
│  ① 把 [系统提示 + 历史消息 + 工具定义] 发给模型   │
│         （Provider 层 → GLM 流式接口）           │
│                                                │
│  ② 流式收到回复：文本 + 可能的 tool_calls        │
│                                                │
│  ③ 没有 tool_calls？→ 这是最终回答，结束本轮 ✅  │
│                                                │
│  ④ 有 tool_calls？→ 逐个：                       │
│       · 写/执行类先问你 y/n（权限层）            │
│       · 执行工具（工具系统）                      │
│       · 把结果作为 tool 消息塞回历史              │
│     然后回到 ①，让模型看着结果继续决策            │
│                                                │
│  （④↔① 最多循环 maxIterations 次，防死循环）     │
└─────────────────────────────────────────────┘
```

对应代码就是 `src/agent/loop.ts` 里的 `runTurn` —— 短小但承载了全部精髓，建议从它读起。

---

## 3. 代码结构地图

按「数据流上下游」排列，每个文件职责单一：

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `src/index.ts` | **入口**：加载 `.env` → 构造所有组件 → 进入 REPL 循环；处理会话恢复与 CLAUDE.md 注入 | `main()` |
| `src/cli.ts` | **参数解析**：解析 `--resume [id]` 等命令行参数 | `parseArgs()`, `ParsedArgs` |
| `src/config.ts` | 配置加载（API key / baseURL / model / 上限 / 压缩参数） | `loadConfig()`, `Config` |
| `src/ui/terminal.ts` | **终端 UI**：readline 输入、流式打印、markdown 渲染、工具展示、y/n | `Terminal`（实现 `LoopUI`） |
| `src/ui/commands.ts` | **斜杠命令**：解析并处理 /help /tools /model /clear /init /exit | `handleCommand()`, `INIT_PROMPT`, `CommandResult` |
| `src/ui/diff.ts` | **彩色 diff 渲染**：写操作确认时展示新旧内容差异 | `renderDiff()` |
| `src/ui/markdown.ts` | **Markdown 渲染**：助手输出缓冲后终端渲染 | `renderMarkdown()` |
| `src/agent/loop.ts` | ★ **Agent 主循环**：串联所有子系统的核心闭环 | `runTurn()`, `LoopUI`, `LoopDeps`, `TurnUsage` |
| `src/provider/types.ts` | 所有消息 / 工具 / Provider 的类型定义 | `ChatMessage`, `ToolCall`, `ToolSchema`, `Provider`… |
| `src/provider/assemble.ts` | **流式分片拼装**：把碎片 chunk 拼成完整文本 + 工具调用 | `StreamAssembler` |
| `src/provider/openai-compatible.ts` | **Provider 层**：用 openai SDK 调 GLM 的兼容接口；带 maxRetries 重试 | `OpenAICompatibleProvider` |
| `src/tools/registry.ts` | **工具注册表**：登记工具、给模型 schema、执行 + 错误自愈 | `ToolRegistry`, `Tool` |
| `src/tools/read.ts` | 工具：读文件（支持 offset/limit 分段读；目录则列条目） | `readFileTool` |
| `src/tools/list.ts` | 工具：glob 模式列出匹配文件路径 | `listFilesTool` |
| `src/tools/write.ts` | 工具：写整文件 / 精确替换（含彩色 diff 预览） | `writeFileTool`, `editFileTool` |
| `src/tools/bash.ts` | 工具：执行 shell 命令 | `bashTool` |
| `src/tools/search.ts` | 工具：递归正则搜索文件内容 | `searchTool` |
| `src/permission/approve.ts` | **权限层**：写/执行类操作前 y/n 确认 | `approveIfNeeded()`, `buildPreview()`, `Confirmer` |
| `src/context/session.ts` | **会话历史**：维护 messages 数组 | `Session` |
| `src/context/store.ts` | **会话持久化**：保存 / 恢复会话到 `~/.void-code/sessions/` | `SessionStore`, `sanitizeMessages()` |
| `src/context/compact.ts` | **历史压缩**：超阈值时用模型摘要压缩旧消息 | `compactIfNeeded()`, `estimateTokens()` |
| `src/context/project-context.ts` | **CLAUDE.md 注入**：读取项目与全局 CLAUDE.md 并合并为系统提示 | `loadProjectContext()`, `defaultGlobalDir()` |
| `src/context/system-prompt.ts` | 拼装系统提示（角色 + 环境 + 约定） | `buildSystemPrompt()` |

依赖方向（谁用谁）：

```
index.ts ──► 所有组件，组装后交给 runTurn
              │
runTurn ──► provider（要回复）
        ├──► registry（要 schema、要执行工具）
        ├──► approveIfNeeded（要权限）
        ├──► session（读写历史）
        └──► ui（输入输出）

provider ──► assemble（拼装流式分片）
所有 tool ──► registry 的 Tool 接口
context/store ◄──► index（REPL 前后保存/恢复）
context/compact ◄── index（每轮后检查是否需要压缩）
context/project-context ◄── index（新会话启动时注入）
```

---

## 4. 核心实现逐个讲

### 4.1 ★ Agent 主循环 `agent/loop.ts`

整个项目最值得理解的部分。`runTurn` 处理「你说一句话」到「模型给出最终回答」的一整轮：

```ts
export async function runTurn(input: string, deps: LoopDeps, signal?: AbortSignal): Promise<TurnUsage> {
  const { provider, registry, session, ui, maxIterations } = deps;
  session.addUser(input);                          // 把你的话记进历史

  for (let i = 0; i < maxIterations; i++) {        // 防死循环的上限
    ui.thinkingStart();                            // 显示"生成中…"
    const result = await provider.chat({           // ① 发给模型
      messages: session.messages,                  //    带上全部历史
      tools: registry.schemas(),                   //    带上工具清单
      signal,                                      //    可中断
    });
    ui.thinkingStop();
    session.addAssistant(result.text, result.toolCalls);
    ui.renderAssistant(result.text);               // markdown 渲染输出

    if (result.toolCalls.length === 0) return ...; // ② 没要工具 = 最终回答，结束

    for (const call of result.toolCalls) {         // ③ 模型要调工具，逐个处理
      const isWrite = registry.isWriteOrExec(call.function.name);
      const approved = await approveIfNeeded(call, isWrite, ui);  // 写/执行先问 y/n
      const output = approved
        ? await registry.execute(call)             // 真实执行
        : "用户拒绝了该操作。";
      session.addToolResult(call.id, output);      // ④ 结果塞回历史（关键！）
    }
    // 回到 for 顶部 → 带着工具结果再次请求模型
  }
}
```

**理解三个要点：**

1. **退出条件**是「模型这次回复里没有 `tool_calls`」。模型自己决定什么时候活干完了。
2. **工具结果必须回填历史**（`addToolResult`）。下一次 `provider.chat` 把整个 `session.messages` 又发过去，模型才能「看到」上一步工具的输出，从而继续推理。这是循环能成立的根本。
3. **`maxIterations` 是安全闸**。模型万一陷入「调工具→看结果→再调」的死循环，到上限会强制中止，不会无限烧 token。

**额外兜底**：若模型回复里只有 shell 代码块而没有真正调用工具（`looksLikeUncalledCommand`），会自动插入一条系统提醒「请直接调用工具」并再跑一轮，触发一次后不再重复。

每轮结束返回 `TurnUsage`（本轮 prompt/completion token 数），由 index 累加并通过 `ui.usage()` 以暗色字显示给用户。

### 4.2 Provider 层 `provider/openai-compatible.ts` + `assemble.ts`

职责：把「一次对话请求」翻译成对 GLM 的 HTTP 调用，并把流式返回拼成结构化结果。

**为什么拆成两个文件？** 传输（调 SDK）和拼装（处理分片）是两件事，分开后**拼装逻辑可以纯函数式地单测**，不用真联网。

`OpenAICompatibleProvider` 使用 openai SDK 的 `maxRetries` 配置（本项目设为 3）自动处理瞬时网络错误（429/5xx/网络）的指数退避重试。

**关键易错点：流式 tool_calls 的拼装**（`StreamAssembler`）。OpenAI 协议流式返回时，一个工具调用的 `arguments`（JSON 字符串）是**一片一片**传来的，比如先 `{"pa`、再 `th":"a.ts"}`，要按 `index` 累加拼接后才能 `JSON.parse`：

```ts
addDelta(delta) {
  if (delta.content) { this.text += delta.content; ... }   // 文本累加
  for (const tc of delta.tool_calls ?? []) {
    const e = this.toolCalls[tc.index] ??= 空壳;
    if (tc.id) e.id = tc.id;                                // id 用赋值
    e.function.name += tc.function?.name ?? "";             // name/arguments 累加
    e.function.arguments += tc.function?.arguments ?? "";
  }
}
```

> 设计细节：构造函数接受一个可选的 `streamFactory` 注入参数，单测时传入「假的流」就能完全绕过网络——这是让网络代码可测的常用手法（依赖注入）。

### 4.3 工具系统 `tools/`

**统一接口** `Tool`（`registry.ts`）：

```ts
interface Tool {
  schema: ToolSchema;        // 给模型看的「说明书」(JSON Schema)
  isWriteOrExec: boolean;    // 风险标记：true 需要 y/n 确认
  execute(args): Promise<string>;  // 实际干活，永远返回字符串
}
```

**注册表** `ToolRegistry` 做三件事：
- `schemas()`：把所有工具的 schema 汇总给模型（模型据此知道有哪些工具、怎么调）。
- `isWriteOrExec(name)`：查风险级别（给权限层用）。
- `execute(call)`：**错误自愈的关键所在**——

```ts
async execute(call) {
  const tool = this.tools.get(call.function.name);
  if (!tool) return `错误：未知工具 "${...}"`;          // ① 模型调了不存在的工具
  let args;
  try { args = JSON.parse(call.function.arguments || "{}"); }
  catch { return `错误：工具参数不是合法 JSON：...`; }   // ② 参数 JSON 坏了
  try { return await tool.execute(args); }
  catch (e) { return `错误：工具执行失败：${e.message}`; } // ③ 执行抛异常
}
```

**核心思想：工具层永不让错误把进程搞挂**。无论是模型瞎调、参数格式错、还是文件不存在，都转成一段**给模型看的错误字符串**回填历史，模型读到后会自己纠正重试。这对 GLM-4-Flash 这种 function calling 偏弱的模型尤其重要。

**五件套工具**各自的要点：
- `read.ts`：带行号返回；超 2000 行截断；支持 `offset`/`limit` 分段读；**path 是目录时返回条目列表**（方便模型探索仓库）。
- `list.ts`：接受 glob 模式（如 `src/**/*.ts`），忽略 `node_modules`/`.git`/`dist`，最多返回 200 条，路径相对当前目录。
- `write.ts`：`write_file` 覆盖整个文件；`edit_file` 做精确替换，要求 `old_string` 在文件中**唯一**（0 处/多处都返回错误，避免改错地方）；确认前展示彩色 diff。
- `bash.ts`：30s 超时；命令失败**不抛异常**，而是返回含 `exit code` + stdout/stderr 的字符串。
- `search.ts`：递归正则搜内容；跳过 `node_modules`/`.git`/`dist`；最多 200 条。

### 4.4 权限层 `permission/approve.ts`

```ts
async approveIfNeeded(call, isWriteOrExec, confirmer) {
  if (!isWriteOrExec) return true;                   // 读类（read/list/search）直接放行
  return confirmer.confirm(await buildPreview(call)); // 写/执行类问 y/n
}
```

`buildPreview` 是个异步函数，把工具调用渲染成人能看懂的预览（`edit_file` 用 old/new 直接出彩色 diff、`write_file` 与磁盘现有内容做 diff、bash 显示完整命令）；因为 write_file 要读现有文件，所以做成异步。`Confirmer` 是个只有 `confirm()` 方法的小接口——`Terminal` 正好实现了它，所以主循环里直接把 `ui` 当 confirmer 传进来。

> 历史上这里踩过一个坑：曾写成 `{ confirm: ui.confirm }`，把方法摘下来当裸函数传，丢了 `this`，真机调用 `this.rl` 时崩。改成直接传 `ui` 实例就对了——这是 JS 方法 `this` 绑定的经典陷阱。

### 4.5 会话历史与持久化 `context/session.ts` + `context/store.ts`

**`session.ts`** 是对 `messages` 数组的一层薄封装，保证消息格式符合 OpenAI 协议：
- 构造时把系统提示作为第一条 `role:"system"`。
- `addAssistant(text, toolCalls)`：无工具调用时**不带** `tool_calls` 字段（设为 undefined）。
- `addToolResult(id, content)`：产生 `role:"tool"` 且带 `tool_call_id`，让模型能把结果对应到它发起的那个调用。

**`store.ts`** 负责持久化：每轮对话结束后，`index.ts` 调用 `store.save()` 把完整 `messages` 写入 `~/.void-code/sessions/<projectHash>/<sessionId>.json`。启动时若传 `--resume`，调用 `store.loadLatest()`（或 `store.load(id)`）恢复。`sanitizeMessages` 会裁掉末尾未闭合的 tool_calls，防止恢复时协议错乱。

### 4.6 历史压缩 `context/compact.ts`

每轮对话后，`compactIfNeeded` 用字符数估算 token 数；超过 `VOID_COMPACT_THRESHOLD`（默认 8000）时，把中间旧消息发给模型做摘要，再拼成 `[system, 摘要消息, 最近 N 条]` 的紧凑结构，其中 N 由 `VOID_COMPACT_KEEP_RECENT`（默认 6）控制。压缩失败不影响主流程。

### 4.7 CLAUDE.md 注入 `context/project-context.ts`

`loadProjectContext(cwd, globalDir)` 分别读取 `<globalDir>/CLAUDE.md` 和 `<cwd>/CLAUDE.md`，都有时全局在前、项目在后，合并后追加到系统提示末尾。`defaultGlobalDir()` 返回 `~/.void-code`。注入**仅在新会话**时发生；`--resume` 恢复时沿用已存储的 messages，不重新注入。

`/init` 命令会让模型自主探索项目并调用 `write_file` 生成或更新 `./CLAUDE.md`，供下次启动时自动注入。

### 4.8 斜杠命令 `ui/commands.ts`

`handleCommand(input, ctx)` 拦截 `/` 开头的输入，返回 `CommandResult`：
- `handled: true` + `message`：显示信息，继续等待。
- `handled: true` + `exit: true`：退出 REPL。
- `handled: true` + `runPrompt: string`：把 `runPrompt` 当作用户输入跑一轮 `runTurn`（`/init` 用此机制）。

可用命令：`/help`、`/tools`、`/model`、`/clear`、`/init`、`/exit`。

### 4.9 系统提示 `context/system-prompt.ts`

`buildSystemPrompt(cwd, platform)` 拼出告诉模型「你是谁、在什么环境、有什么工具、怎么干活」的开场白，包含当前工作目录和操作系统。它是模型行为的「人设 + 说明书」。

### 4.10 终端 UI `ui/terminal.ts`

基于 Node `readline`：`prompt()` 读一行输入；`renderAssistant()` 把助手输出缓冲后做 markdown 渲染（`ui/markdown.ts`）；`toolCall()`/`toolResult()` 展示工具调用与结果（超长截断）；`confirm()` 弹 y/n；`usage()` 以暗色字显示 token 统计。

它实现了主循环需要的 `LoopUI` 接口，所以主循环不依赖具体终端实现——以后换成富交互 TUI 只要换这一个文件。

### 4.11 入口 `index.ts`

```
import "dotenv/config"          // ★ 必须第一行：先把 .env 读进 process.env
  ↓
loadConfig()                    // 读配置，缺 key 直接报错退出
  ↓
构造 provider + registry（注册6个工具）+ ui + store
  ↓
parseArgs()                     // 解析 --resume [id]
  ↓
loadProjectContext()            // 新会话时拼入 CLAUDE.md（resume 跳过）
  ↓
while(true) {
  读输入
    → 斜杠命令处理（handleCommand）
    → runTurn（含 Ctrl+C 两段式中断）
    → token 统计显示
    → compactIfNeeded（超阈值压缩历史）
    → store.save（持久化本轮）
}
```

---

## 5. 端到端时序：「帮我新建 hello.txt」

```
你: 帮我新建 hello.txt 内容 hello
 │
 ├─ session.addUser("帮我新建...")
 ├─ provider.chat(历史+工具)  ──► GLM 返回 tool_call: write_file({path,content})
 ├─ session.addAssistant("", [write_file调用])
 ├─ isWriteOrExec("write_file") = true
 ├─ approveIfNeeded → Terminal 弹彩色 diff + "确认执行? [y/N]"
 │      你输入 y
 ├─ registry.execute → writeFileTool 真实写盘 → "已写入 hello.txt（5 字符）"
 ├─ session.addToolResult(id, "已写入...")
 ├─ provider.chat(更新后的历史)  ──► GLM 这次只回文本: "已为你创建 hello.txt"
 ├─ toolCalls 为空 → return ✅
 ├─ ui.usage("本轮 prompt X / completion Y ｜ 累计 Z")
 ├─ compactIfNeeded（检查是否需要压缩历史）
 ├─ store.save（持久化本轮）
 └─ 回到 REPL 等下一句
```

---

## 6. 关键设计决策与「为什么」

| 决策 | 为什么 |
|------|-------|
| 工具错误转成字符串回填，不抛异常 | 让模型自愈重试；进程不崩。弱模型尤其需要 |
| 传输与拼装分离（provider / assemble） | 拼装逻辑可纯函数单测，不用联网 |
| Provider 接受注入的 `streamFactory` | 单测绕过真实网络 |
| 工具用统一 `Tool` 接口 + 注册表 | 加新工具零侵入：实现接口 + 注册一行 |
| `LoopUI` / `Confirmer` 抽象接口 | 主循环不绑定具体终端，便于测试和未来换 UI |
| `maxIterations` 上限 | 防模型死循环烧 token |
| `edit_file` 要求 old_string 唯一 | 避免改错位置 |
| 会话每轮持久化到 `~/.void-code/sessions/` | 意外退出后可 `--resume` 恢复，不丢上下文 |
| 历史压缩保留最近 N 条 | 平衡上下文长度与近期对话连贯性 |
| `runPrompt` 字段让 `/init` 复用主循环 | 无需重复实现「跑一轮 agent」逻辑 |
| CLAUDE.md 注入仅在新会话 | 避免 `--resume` 时重复污染已有上下文 |

---

## 7. 已知缺口（Phase 2 候选）

- `search` 对单个超大文件无大小上限。
- 单一 Provider（GLM），尚不支持切换到其他大模型（OpenAI / Anthropic 等）。
- 无 MCP（Model Context Protocol）支持。
- 无子 agent / 并行任务能力。
- 终端 UI 为纯文本，无富交互 TUI（光标定位、面板布局等）。

---

## 8. 想加一个新工具？三步

以加一个假想的 `fetch_url` 工具为例：

1. **新建** `src/tools/fetch.ts`，导出一个满足 `Tool` 接口的对象：写好 `schema`（name/description/parameters）、`isWriteOrExec: false`、`execute(args)` 返回字符串。
2. **注册**：在 `src/index.ts` 的工具数组里加上它。
3. **加测试** `tests/fetch.test.ts`，覆盖正常 + 缺参数 + 出错路径。

工具系统的注册表设计让这件事零侵入——主循环、Provider、权限层都不用改。
