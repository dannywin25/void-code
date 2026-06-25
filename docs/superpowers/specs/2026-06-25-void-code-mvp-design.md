# void-code MVP 设计文档

- **日期**: 2026-06-25
- **定位**: 学习/练手 —— 搞懂 agentic 编码 CLI（对标 Claude Code）的核心原理
- **范围**: 仅锁定 Phase 1 (MVP)。Phase 2-4 仅作为「未来方向」列在末尾，不展开。

## 1. 目标与非目标

### 目标

- 在终端里跑通一个**完整的 agentic 编码闭环**：用户用自然语言提需求 → 模型自主调用工具（读文件、改文件、执行命令、搜索）→ 把结果喂回模型 → 模型继续决策，直到任务完成。
- 把「Agent 主循环」「工具系统」「工具调用（function calling）解析」这些**最值得学的核心**完整手写出来，不依赖高层 Agent SDK 封装。
- 代码量小、结构清晰，每个子系统职责单一、可独立理解。

### 非目标 (本期不做)

- 富交互 TUI（状态栏、弹窗、动画）—— 用 readline 问答式即可。
- 上下文压缩、会话持久化/恢复。
- 子 agent、MCP、自定义工具加载、项目级 `CLAUDE.md` 注入。
- 多 Provider 同时支持（架构上预留抽象，但只实现 OpenAI 兼容一种）。
- 生产级健壮性（完善的重试退避、费用统计、并发等）。

## 2. 技术选型基线

| 维度 | 选择 | 说明 |
|---|---|---|
| 语言/运行时 | TypeScript + Node.js | npm 生态成熟，终端/异步友好 |
| 模型接入 | OpenAI 兼容 Provider | 走 Chat Completions 协议 |
| 具体模型 | 智谱 GLM-4-Flash（免费） | `base_url`: `https://open.bigmodel.cn/api/paas/v4`，`model`: `glm-4-flash` |
| 认证 | 环境变量 API Key | 到 bigmodel.cn 注册获取免费 key |
| 终端交互 | readline 问答式 | 多轮对话 + 流式输出 + 工具展示 |
| 工具集 | 核心四件套 | read / write·edit / bash / search |
| 权限策略 | 每次确认 | 写/执行前 y/n，读取直接放行 |

> ⚠️ **学习注意点**：GLM-4-Flash 的 function calling 能力弱于 Claude，复杂任务可能偶尔不调工具、漏参数或参数格式错。本设计在「工具系统」和「Agent 主循环」中专门处理这类工具调用错误（见 §5.4、§6），这正是理解 agent 鲁棒性的好素材。

## 3. 整体架构

8 个子系统，自上而下：

```
┌─────────────────────────────────────────────────────┐
│  1. CLI 入口 / 配置      启动、读 API key、初始化会话     │
├─────────────────────────────────────────────────────┤
│  2. 终端 UI (readline)   输入、流式输出、工具展示、y/n    │
├─────────────────────────────────────────────────────┤
│  3. Agent 主循环 ★核心   发请求→收响应→执行工具→回填→循环  │
├──────────────────┬──────────────────────────────────┤
│  4. Provider 层   │  5. 工具系统 (注册表+schema+执行)    │
│  (OpenAI 兼容)    │   read / write·edit / bash / search │
├──────────────────┴──────────────────────────────────┤
│  6. 权限/审批层          按风险分级，写/执行前 y/n        │
├─────────────────────────────────────────────────────┤
│  7. 上下文/会话管理      messages 历史、系统提示、环境信息  │
├─────────────────────────────────────────────────────┤
│  8. 系统提示             角色设定 + 工具用法 + 工作目录    │
└─────────────────────────────────────────────────────┘
```

### 建议目录结构

```
void-code/
├── package.json
├── tsconfig.json
├── .env.example                 # GLM_API_KEY=...
└── src/
    ├── index.ts                 # 1. CLI 入口
    ├── config.ts                # 1. 配置加载
    ├── ui/
    │   └── terminal.ts          # 2. readline + 流式渲染 + y/n
    ├── agent/
    │   └── loop.ts              # 3. Agent 主循环
    ├── provider/
    │   ├── types.ts             # Provider 接口抽象
    │   └── openai-compatible.ts # 4. OpenAI 兼容客户端
    ├── tools/
    │   ├── registry.ts          # 5. 工具注册表 + 类型
    │   ├── read.ts
    │   ├── write.ts             # write + edit
    │   ├── bash.ts
    │   └── search.ts
    ├── permission/
    │   └── approve.ts           # 6. 权限审批
    └── context/
        ├── session.ts           # 7. messages 历史管理
        └── system-prompt.ts     # 8. 系统提示拼装
```

## 4. 核心数据流：Agent 主循环

这是整个工具的灵魂，伪代码：

```
function runTurn(userInput):
    session.addUserMessage(userInput)
    loop:
        response = provider.chat({
            messages: session.messages,
            tools: registry.schemas(),
            stream: true,
        })
        # 流式渲染 assistant 文本到终端
        # 收齐后得到 assistant message，可能含 tool_calls

        session.addAssistantMessage(response)

        if response 没有 tool_calls:
            break          # 模型给出最终回答，本轮结束

        for each toolCall in response.tool_calls:
            if 工具属于写/执行类:
                if not permission.approve(toolCall):
                    result = "用户拒绝了该操作"
                else:
                    result = registry.execute(toolCall)   # try/catch
            else:
                result = registry.execute(toolCall)
            session.addToolResult(toolCall.id, result)
        # 回到 loop 顶部，把工具结果喂回模型
    # 安全保护：单轮最多 N 次循环，超出则中止并提示
```

关键点：

- **循环的退出条件**是「模型这次回复里没有再请求工具」。
- **工具结果必须以 `role: "tool"` 消息**（带 `tool_call_id`）回填，模型才能在下一轮看到执行结果。
- **单轮最大迭代次数保护**（如 25 次），防止模型陷入死循环空烧额度。

## 5. 子系统详细设计

### 5.1 CLI 入口 / 配置 (`index.ts`, `config.ts`)

- 启动时加载配置：从环境变量读 `GLM_API_KEY`，缺失则报错退出并提示去 bigmodel.cn 获取。
- 配置项（MVP 写死合理默认值即可）：`baseUrl`、`model`、`maxIterations`、`maxOutputTokens`。
- 初始化 session（注入系统提示）、provider、工具注册表、终端 UI，进入 REPL 循环：读一行输入 → `runTurn` → 等下一行。
- 输入 `exit` / Ctrl+C 退出。

### 5.2 Provider 层 (`provider/`)

- `types.ts` 定义抽象接口，隔离「具体厂商」：
  ```
  interface Provider {
    chat(params: { messages, tools, stream }): AsyncIterable<Chunk> | Response
  }
  ```
- `openai-compatible.ts`：用 `fetch` 或 `openai` npm 包，POST 到 `{baseUrl}/chat/completions`。
- 负责：构造请求体（messages + tools schema + stream=true）、解析 SSE 流式分片、把分片拼成「文本增量」和「tool_calls」两部分输出给上层。
- **流式下 tool_calls 的拼装**：OpenAI 协议里 tool_calls 的 `arguments` 是分片累加的字符串，需要按 `index` 累加后再 `JSON.parse`。这是一个易错点，设计上单独封装。
- MVP 仅做最小错误处理：网络错误/非 2xx 时抛出可读错误，由主循环捕获并提示用户。

### 5.3 工具系统 (`tools/`)

- `registry.ts`：维护 `name -> { schema, execute, isWriteOrExec }` 映射。提供 `schemas()`（给 Provider）和 `execute(toolCall)`。
- 每个工具定义：
  - **JSON Schema**（name / description / parameters）——直接喂给模型。
  - **execute 函数**——接收解析后的参数，返回字符串结果（成功输出或错误信息）。
- 四件套：

  | 工具 | 参数 | 行为 | 风险级别 |
  |---|---|---|---|
  | `read_file` | `path` | 返回文件内容（带行号），大文件截断 | 读（放行） |
  | `write_file` | `path`, `content` | 覆盖写整个文件（含新建）；`edit_file` 用 `old_string`/`new_string` 精确替换 | 写（确认） |
  | `bash` | `command` | 在工作目录执行 shell，返回 stdout+stderr+exit code，带超时 | 执行（确认） |
  | `search` | `pattern`, `path?` | grep/glob 搜索文件名或内容，返回匹配列表 | 读（放行） |

  > MVP 把 `write_file` 和 `edit_file` 放在 `write.ts` 同一文件里，作为两个独立工具注册。

### 5.4 工具调用错误处理（学习重点）

由于 GLM-4-Flash 可能给出不合法的工具调用，`registry.execute` 必须：

- `JSON.parse(arguments)` 失败 → 返回「参数不是合法 JSON，请重试」给模型，而非崩溃。
- 缺必填参数 / 参数类型错 → 返回明确错误描述给模型。
- execute 内部异常（文件不存在、命令失败）→ 捕获后把错误信息**作为 tool_result 回填**，让模型自己看到并纠正。
- 模型请求了不存在的工具名 → 返回「未知工具」错误。

原则：**工具层永不让单个工具错误把整个进程搞挂**，而是把错误转成模型能理解的反馈，交给 agent 循环自愈。

### 5.5 权限/审批层 (`permission/approve.ts`)

- 仅对 `isWriteOrExec` 为真的工具触发。
- 在终端清晰展示「即将执行什么」：工具名 + 关键参数（write 显示路径+内容预览/diff，bash 显示完整命令）。
- 提示 `y/n`，默认 n（回车=拒绝）。
- 拒绝时不执行，把「用户拒绝」作为 tool_result 回填，模型可改用别的方式。

### 5.6 终端 UI (`ui/terminal.ts`)

- 基于 Node `readline` 的多轮输入。
- 流式渲染：把 Provider 的文本增量实时 `process.stdout.write`。
- 工具调用展示：模型决定调工具时，打印一行（如 `⚙ read_file(path="src/index.ts")`）。
- 工具结果可折叠/截断展示，避免刷屏。
- 提供 `confirm(prompt): boolean` 给权限层用。
- MVP 不做 markdown / diff 彩色渲染（列入 Phase 2）。

### 5.7 上下文/会话管理 (`context/`)

- `session.ts`：持有 `messages` 数组，提供 `addUserMessage` / `addAssistantMessage` / `addToolResult`，以及 `messages` getter。
- MVP 不做压缩；超长直接发，靠 `maxIterations` 控制单轮规模。
- `system-prompt.ts`：拼装系统提示（见 §5.8），在 session 初始化时作为第一条 `role: "system"` 消息。

### 5.8 系统提示 (`context/system-prompt.ts`)

至少包含：

- 角色设定：「你是一个运行在用户终端里的编码助手，能通过工具读写文件、执行命令」。
- 工作环境信息：当前工作目录绝对路径、操作系统、（可选）目录文件列表。
- 工具使用约定：鼓励先读后写、改动前说明意图、命令要安全。
- 行为约束：简洁、面向终端输出。

## 6. 错误处理与边界情况汇总

| 场景 | 处理 |
|---|---|
| 缺 API Key | 启动即报错退出，提示获取方式 |
| 网络/API 报错 | 主循环捕获，打印可读错误，回到 REPL 等待下一句 |
| 工具参数非法 JSON | 作为 tool_result 反馈给模型自愈 |
| 工具执行抛异常 | 捕获并作为 tool_result 反馈 |
| 模型不调工具直接乱答 | 正常结束本轮（这是合法结束） |
| 单轮工具循环失控 | `maxIterations` 上限中止，提示用户 |
| 用户拒绝授权 | 「已拒绝」回填，模型可换方案 |
| bash 命令超时/卡死 | 设超时，超时杀进程并返回错误 |
| Ctrl+C | 优雅退出当前轮 / 退出程序 |

## 7. 测试策略

MVP 以「能跑通闭环」为验收核心，辅以关键单元测试：

- **单元测试**（重点是纯逻辑、易错处）：
  - Provider 层：流式分片 → 文本/tool_calls 的拼装（尤其 tool_calls arguments 累加）。
  - 工具系统：每个工具的 execute（正常 + 错误参数 + 目标不存在）。
  - 工具调用错误处理：非法 JSON、未知工具、缺参数。
  - 权限层：写/执行类触发确认，读类放行。
- **手动端到端验收**（用真实 GLM-4-Flash）：
  1. 「读一下 `src/index.ts` 并总结」→ 触发 read_file，无需确认，正常返回。
  2. 「在根目录新建 `hello.txt`，内容 hello」→ 触发 write_file，弹 y/n，确认后文件真实生成。
  3. 「跑一下 `ls` 看看有哪些文件」→ 触发 bash，弹 y/n，确认后返回结果。
  4. 「找出所有包含 TODO 的文件」→ 触发 search，返回匹配。
  5. 一个需要「读→改→验证」多步的任务，观察 agent 多轮循环。

## 8. 未来方向 (本期不做，仅备忘)

- **Phase 2 — 体验**：diff 彩色渲染、markdown 渲染、token/费用统计、`/help` `/clear` 等斜杠命令、错误重试退避。
- **Phase 3 — 上下文**：长会话历史压缩、会话保存与恢复。
- **Phase 4 — 进阶**：子 agent、MCP、自定义工具加载、项目级 `CLAUDE.md` 注入、多 Provider 切换、富交互 TUI (Ink)。

## 9. MVP 验收标准 (Definition of Done)

- [ ] 能用环境变量里的免费 GLM key 启动进入 REPL。
- [ ] 四件套工具全部可被模型调用并真实执行。
- [ ] 写/执行类操作执行前有 y/n 确认，读类直接放行。
- [ ] Agent 主循环能多轮调用工具并把结果喂回模型，直到给出最终回答。
- [ ] 工具/网络/参数错误不会让进程崩溃，能转成模型反馈或 REPL 提示。
- [ ] 上述 §7 的 5 个手动端到端场景全部通过。
- [ ] 关键单元测试通过。
