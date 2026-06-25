# void-code A+B 批次 设计文档

- **日期**: 2026-06-25
- **定位**: 在 MVP + 小缺口套餐之上，加 A（让弱模型稳定调工具）+ B（体验：diff/markdown/重试）
- **前置**: MVP、小缺口套餐均已完成，56 单测全绿。

## 关键设计变化：文本输出从「流式」改为「缓冲后 markdown 渲染」

当前助手文本是逐字流式打印（`onTextDelta` → `ui.writeText`）。本批改为：**每段助手回复在 `provider.chat` 返回后，整段用 markdown 渲染输出**。Provider 内部仍走流式（需末尾 chunk 的 usage），但不再实时打字。等待期间显示一个轻量「生成中…」提示，渲染前清除。

## A —— 让弱模型听话

### A1. 工具调用兜底（`agent/loop.ts`）
- 某轮 `provider.chat` 返回 `toolCalls` 为空时，正常本应结束本轮；但若该轮文本**疑似只描述命令未真正调用**，则追加一轮督促。
- 检测（启发式，`looksLikeUncalledCommand(text)`）：文本包含围栏代码块且语言是 shell 类——正则匹配 ` ```(bash|sh|shell|zsh|console) `。
- 命中且本轮兜底次数 < 1 时：`session.addUser("（系统提醒）请直接调用工具来执行，不要只在回答里用代码块写出命令。")`，兜底计数 +1，**继续循环**（不 return）；否则正常 return。
- 每轮最多兜底 1 次，避免与模型互相空转。

### A2. list_files glob 工具（新 `src/tools/list.ts`，用 `glob` 库）
- 工具名 `list_files`，参数：`pattern`（glob，必填，如 `src/**/*.ts`）、`cwd`（可选，默认当前目录）。
- `isWriteOrExec: false`（只读，无需确认）。
- 返回匹配到的文件路径列表（每行一个），最多 200 条，超出截断提示；无匹配返回提示。
- 在 `index.ts` 注册进 registry。

### A3. /tools 与 /model 命令（`src/ui/commands.ts`）
- `/tools`：列出已注册工具（名 + 描述）。
- `/model`：显示当前模型名。
- 需给 `CommandContext` 增加 `model: string` 字段；`index.ts` 传入 `config.model`。

## B —— 体验

### B1. diff 彩色渲染（新 `src/ui/diff.ts`，用 `diff` + `chalk`）
- `renderDiff(oldStr: string, newStr: string): string`：基于 `diffLines`，新增行绿色（前缀 `+`）、删除行红色（前缀 `-`）、未变行灰色或省略上下文。
- 接入权限预览：`permission/approve.ts` 在 `write_file`/`edit_file` 确认时展示 diff。
  - `edit_file`：直接 `renderDiff(old_string, new_string)`。
  - `write_file`：读磁盘现有文件内容与新 `content` 做 diff；文件不存在则视为全新增。
- 为读现有文件，**权限预览改为异步**：`approveIfNeeded` 内部 `await` 构造预览（对 write_file 读文件，catch 则当作空）。`describeCall` 对 bash/未知工具保持同步文本。

### B2. markdown 渲染（新 `src/ui/markdown.ts`，用 `marked` + `marked-terminal`）
- `renderMarkdown(text: string): string`：用 `marked` + `marked-terminal` 渲染器把 markdown 转 ANSI 终端文本。
- `Terminal` 增加 `renderAssistant(text: string): void`：非空时 `renderMarkdown` 后输出。
- `agent/loop.ts` 不再用 `onTextDelta` 实时打印，改为 `provider.chat` 返回后 `ui.renderAssistant(result.text)`。
- 等待提示：`Terminal` 增加 `thinkingStart()/thinkingStop()`（打印「生成中…」并在渲染前用 `\r` 清行）；loop 在每次 `provider.chat` 前后调用。

### B3. 错误重试 / 退避（`provider/openai-compatible.ts`）
- 用 openai SDK 内置能力：`new OpenAI({ ..., maxRetries: 3 })`。SDK 对 429/5xx/网络错误自动指数退避重试。
- 仅影响默认 streamFactory（真实 SDK），不影响注入式测试。

## 新依赖

`diff`、`chalk`、`marked`、`marked-terminal`、`glob`，以及 `@types/diff`、`@types/marked-terminal`（`glob`/`chalk`/`marked` 自带类型）。重试用 SDK 自带，不加依赖。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/tools/list.ts` | **新增** list_files glob 工具 |
| `src/ui/diff.ts` | **新增** renderDiff |
| `src/ui/markdown.ts` | **新增** renderMarkdown |
| `src/ui/commands.ts` | /tools /model；CommandContext += model |
| `src/permission/approve.ts` | 预览异步化 + write/edit 接入 diff |
| `src/agent/loop.ts` | 工具调用兜底 + 改用 renderAssistant + thinking 提示 |
| `src/ui/terminal.ts` | renderAssistant / thinkingStart / thinkingStop |
| `src/provider/openai-compatible.ts` | maxRetries |
| `src/index.ts` | 注册 list_files；CommandContext 传 model |
| `package.json` | 新依赖 |

## 测试策略

- **单测**：
  - `looksLikeUncalledCommand` + loop 兜底（fake provider：首轮文本含 ```bash 无 toolCall → 应追加提醒并再跑一轮）。
  - `list_files`：匹配、无匹配、缺 pattern、截断。
  - `/tools` `/model` 命令分发。
  - `renderDiff`：增/删/无变化行的标记与（去除 ANSI 后的）内容正确。
  - `renderMarkdown`：输入 markdown，输出含预期文本（断言去 ANSI 后包含原文要点，不断言具体色码）。
- **手动验收**：真机下 markdown 缓冲渲染观感、「生成中…」提示、写操作确认时的彩色 diff、（构造网络错误较难，重试仅确认 maxRetries 已配置）。

## 非目标

不做历史压缩、会话持久化、子 agent、MCP、富交互 TUI（Phase 3/4）。

## 验收标准

- [ ] 模型只在代码块里写命令、未调工具时，能被检测并自动督促一轮（每轮最多 1 次）。
- [ ] `list_files` 可按 glob 匹配返回文件；`/tools` `/model` 可用。
- [ ] `write_file`/`edit_file` 确认时显示彩色 diff（增绿删红）。
- [ ] 助手文本以 markdown 渲染整段输出；等待时有「生成中…」提示。
- [ ] openai client 配置了 `maxRetries`。
- [ ] 全量单测通过、`npm run build` 无错；现有功能不回归。
