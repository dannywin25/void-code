# void-code 小缺口套餐 设计文档

- **日期**: 2026-06-25
- **定位**: 在已完成的 MVP 上补 4 项高频实用增强（学习项目）
- **前置**: MVP 已完成（见 `2026-06-25-void-code-mvp-design.md`），8 子系统、四件套工具、权限、错误自愈均已跑通。

## 范围（4 项）

### 1. 斜杠命令
- 新增 `src/ui/commands.ts`：一个纯函数式分发器。REPL 中以 `/` 开头的输入交给它处理、不发给模型。
- 命令：
  - `/help`：打印命令列表 + 工具清单。
  - `/clear`：清空会话历史但保留系统提示（调用 `Session.clear()`）。
  - `/exit`：退出（与 `exit` 等价）。
- 未知 `/xxx`：提示「未知命令，输入 /help 查看」。
- 给 `Session` 增加 `clear()`：把 `messages` 截断回只剩第一条 system 消息。

### 2. read_file 分段读
- 给 `read_file` schema 与 execute 增加两个**可选**参数：
  - `offset`：起始行号（1-based，含）。
  - `limit`：返回的最大行数。
- 不传时行为与现状完全一致（从第 1 行起、最多 2000 行）。
- 输出行号按**文件真实行号**显示（offset-aware）。
- 超出范围（offset 大于总行数）返回明确提示。
- 更新 description 让模型知道可分页读大文件。

### 3. Ctrl+C 两段式
- 给 `ChatParams` 增加可选 `signal?: AbortSignal`，`OpenAICompatibleProvider.chat` 把它透传给 openai SDK 的 `create(params, { signal })`。中断时流式迭代抛错。
- `runTurn` 增加可选 `signal`，传给 `provider.chat`；捕获 abort 错误后优雅返回（不视为崩溃）。
- `index.ts` 维护 SIGINT 状态机：
  - **有活动轮次时**按 Ctrl+C → abort 当前轮的 `AbortController`，打印「已中断」，回到输入提示。
  - **空闲时**按一下 → 打印「再按一次 Ctrl+C 退出」并置一次性标志；标志生效期间再按 → 退出进程。下一次正常输入会清除标志。
- 每轮新建一个 `AbortController`，turn 结束清掉引用。
- 备注：readline + 流中断交互较 tricky，实现以手动验收为准，允许小迭代。

### 4. token 统计
- 请求体加 `stream_options: { include_usage: true }`（GLM OpenAI 兼容支持）。usage 在流末尾的一个 `choices` 为空的 chunk 里以 `chunk.usage` 给出。
- Provider 捕获该 usage，放入 `ChatResult.usage?: { promptTokens; completionTokens; totalTokens }`（字段缺失时为 undefined，不报错）。
- `runTurn` 把**单轮内多次** `provider.chat` 的 usage 累加为本轮用量；通过 `LoopUI` 上报。
- `index.ts` 维护**全会话累计**计数器；`/clear` 不重置累计（累计是「本进程」口径）。
- 展示格式（每轮末一行）：`本轮 prompt N / completion M ｜ 累计 T`。
- `LoopUI` 增加 `usage(line: string): void`（或复用 `info`）；本设计用新方法以便区分样式。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/provider/types.ts` | `ChatResult += usage?`；`ChatParams += signal?`；新增 `Usage` 类型 |
| `src/provider/openai-compatible.ts` | `stream_options` + 透传 `signal` + 捕获 `chunk.usage` |
| `src/provider/assemble.ts` | `StreamAssembler` 接收 usage（新增 `addUsage` 或在 result 里携带） |
| `src/agent/loop.ts` | `runTurn` 串入 `signal`；累加本轮 usage 并上报；`LoopUI += usage()` |
| `src/ui/terminal.ts` | 实现 `usage()`；SIGINT 相关在 index 接线（Terminal 暴露必要钩子） |
| `src/context/session.ts` | 新增 `clear()` |
| `src/ui/commands.ts` | **新增**：斜杠命令分发器 |
| `src/index.ts` | 命令分发 + 累计计数 + per-turn AbortController + SIGINT 状态机 |

## 测试策略

- **单测**：
  - `commands.ts`：`/help`/`/clear`/`/exit`/未知命令 的分发结果。
  - `Session.clear()`：清空后只剩 system 消息；累计历史正确截断。
  - `read_file` 的 offset/limit：默认行为不变、带 offset 行号正确、limit 截断、越界提示。
  - `runTurn` 的 token 累加：fake provider 返回带 usage 的 ChatResult，断言本轮累加值与上报调用。
- **手动验收**：Ctrl+C 两段式（进行中中断 / 空闲两按退出）；真实 GLM 下 token 显示是否合理。

## 非目标

不做 diff/markdown 渲染、错误重试退避、历史压缩、会话持久化（属 Phase 2/3，后续单独处理）。

## 验收标准

- [ ] `/help` `/clear` `/exit` 可用；`/clear` 后历史清空但系统提示仍在、对话能继续。
- [ ] `read_file` 带 offset/limit 能分页读，行号正确；不带参数行为不变；已有 read 测试仍全绿。
- [ ] 进行中 Ctrl+C 能中断当前轮回到提示；空闲连按两次 Ctrl+C 退出。
- [ ] 每轮结束显示「本轮 prompt/completion ｜ 累计」token。
- [ ] 全量单测通过、`npm run build` 无错。
