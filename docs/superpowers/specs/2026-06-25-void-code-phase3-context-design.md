# void-code Phase 3 上下文管理 设计文档

- **日期**: 2026-06-25
- **定位**: 给 void-code 补最后一块核心能力——历史压缩 + 会话持久化/恢复
- **前置**: MVP + 小缺口套餐 + A+B 批次均已完成，68 单测全绿。

## 范围（3 块）

### 1. 会话持久化 / 恢复（`src/context/store.ts` 新增）
- **存储位置**：`~/.void-code/sessions/<projectKey>/<sessionId>.json`。
  - `projectKey` = 进程 `cwd` 的 sha256 取前 12 位（按项目分组，不污染仓库）。
  - `sessionId` = 创建时刻的时间戳串（ISO，`:`/`.` 替换为 `-`），便于按字典序取「最近」。
- **文件内容**：`{ id: string; cwd: string; createdAt: string; updatedAt: string; messages: ChatMessage[] }`。
- **保存时机**：每轮对话结束后**自动保存**（崩溃 / Ctrl+C 也不丢）。
- **恢复**：
  - `--resume`：恢复该项目下最近一次会话。
  - `--resume <id>`：恢复指定 id。
  - 无可恢复会话时：打印提示并开新会话。
- `SessionStore` 类（构造接收 baseDir，默认 `~/.void-code`）方法：
  - `newId(now: Date): string`
  - `save(session: { id; cwd; createdAt; messages }): Promise<void>`（更新 updatedAt 后写盘）
  - `loadLatest(cwd: string): Promise<StoredSession | null>`
  - `load(cwd: string, id: string): Promise<StoredSession | null>`
  - `StoredSession = { id; cwd; createdAt; updatedAt; messages: ChatMessage[] }`
- `Session` 构造器小改：`constructor(init: string | ChatMessage[])`——传字符串=系统提示（现状）；传消息数组=从已有消息重建（用于恢复）。保持现有调用方（传字符串）兼容。

### 2. 历史压缩（`src/context/compact.ts` 新增）
- **触发**：`estimateTokens(messages)` 超过阈值时。`estimateTokens` 按「总字符数 / 4」粗估（解耦真实 API token、可单测）。
- **策略**：保留 `messages[0]`（系统提示）+ 把中间旧消息**调模型摘要成一条** + 最近 `keepRecent` 条原样保留。
  - 摘要消息形如 `{ role: "user", content: "（此前对话的摘要）\n<摘要正文>" }`，插在系统提示之后、最近 keepRecent 条之前。
  - 摘要调用：用 `provider.chat`，messages 为 `[{system: 摘要指令}, {user: 被压缩消息的文本拼接}]`，无 tools；摘要指令要求「保留关键事实、决定、文件改动、未完成事项，简洁」。
  - 若待压缩的中间消息为空（消息太少）则不压缩。
- **接口**：`compactIfNeeded(session: Session, provider: Provider, opts: { threshold: number; keepRecent: number }): Promise<boolean>`，返回是否发生了压缩；压缩直接 mutate `session`（替换 messages 内容）。
- **接线**：`index.ts` 每轮结束后 `await compactIfNeeded(...)`，发生压缩时打印「（已压缩历史以节省上下文）」。
- **配置**：`config` 增加 `compactThreshold`（默认 **8000**，env `VOID_COMPACT_THRESHOLD` 可调）、`compactKeepRecent`（默认 6，env `VOID_COMPACT_KEEP_RECENT`）。

### 3. CLI 参数解析（`src/cli.ts` 新增）
- `parseArgs(argv: string[]): { resume: boolean; resumeId?: string }` 纯函数：识别 `--resume`、`--resume <id>`。可单测。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/context/store.ts` | **新增** SessionStore（持久化 + 加载） |
| `src/context/compact.ts` | **新增** estimateTokens + compactIfNeeded |
| `src/cli.ts` | **新增** parseArgs |
| `src/context/session.ts` | 构造器支持 `string \| ChatMessage[]` |
| `src/config.ts` | 加 compactThreshold / compactKeepRecent |
| `src/index.ts` | --resume 解析 + 新建/恢复会话 + 每轮自动保存 + 压缩接线 |

## 测试策略

- **单测**：
  - `parseArgs`：无参、`--resume`、`--resume <id>`。
  - `estimateTokens`：字符数/4 粗估。
  - `compactIfNeeded`：未超阈值不压缩返回 false；超阈值时用 fake provider 返回摘要，断言 messages 被替换为「系统提示 + 摘要 + 最近 keepRecent 条」、返回 true。
  - `SessionStore`：save → loadLatest / load 往返一致；newId 单调；空目录 loadLatest 返回 null（用临时 baseDir，不碰真实 ~/.void-code）。
  - `Session`：`new Session(messages[])` 从消息重建，messages 与传入一致。
- **手动验收**：`--resume` 接最近会话、`--resume <id>` 接指定；长对话触发压缩并打印提示；持久化文件确实生成在 `~/.void-code/sessions/`。

## 非目标

不做子 agent、MCP、自定义工具加载、CLAUDE.md 注入、多 Provider、富交互 TUI（Phase 4）。

## 验收标准

- [ ] 每轮对话后会话自动写入 `~/.void-code/sessions/<projectKey>/<id>.json`。
- [ ] `--resume` 能接最近会话、`--resume <id>` 能接指定会话、无会话时友好提示。
- [ ] 上下文超过 compactThreshold（默认 8000）时自动摘要压缩，保留系统提示+最近若干条，并打印提示。
- [ ] `new Session(messages[])` 能从持久化消息重建会话。
- [ ] 全量单测通过、`npm run build` 无错；现有功能不回归。
