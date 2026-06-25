# void-code CLAUDE.md 注入 + /init + 文档同步 设计文档

- **日期**: 2026-06-25
- **定位**: 让模型更懂项目（注入 CLAUDE.md）+ 一键生成 CLAUDE.md（/init，仿 Claude Code）+ 文档拉回与代码一致
- **前置**: MVP + 小缺口套餐 + A+B + Phase 3 均已完成，84 单测全绿。

## 范围（3 块）

### 1. CLAUDE.md 注入（`src/context/project-context.ts` 新增）
- 启动**新会话**时，读两处 CLAUDE.md 并合并拼到系统提示之后：
  - 全局：`<globalDir>/CLAUDE.md`（默认 `~/.void-code/CLAUDE.md`）。
  - 项目：`<cwd>/CLAUDE.md`。
- `loadProjectContext(cwd: string, globalDir: string): Promise<string>`：
  - 读不到的文件跳过（不报错）。
  - 都没有 → 返回空字符串 `""`。
  - 有内容时返回形如：`\n\n# 全局记忆（~/.void-code/CLAUDE.md）\n<全局内容>\n\n# 项目记忆（CLAUDE.md）\n<项目内容>`，只包含存在的段。
- `index.ts`：新会话的系统提示 = `buildSystemPrompt(cwd, platform) + (await loadProjectContext(cwd, globalDir))`。
- `--resume` 旧会话**不注入**（沿用 stored.messages 里的系统提示，保持忠实恢复）。

### 2. /init 斜杠命令（`src/ui/commands.ts` + `src/index.ts`）
- `CommandResult` 增加可选字段 `runPrompt?: string`。
- `handleCommand` 新增 `case "init"`：返回 `{ handled: true, runPrompt: INIT_PROMPT }`。
- `INIT_PROMPT`（commands.ts 内常量）大意：
  > 「请分析当前项目并生成/更新一份 CLAUDE.md（让 AI 编码助手快速理解本项目）。步骤：用 list_files/read_file/search 查看项目结构、package.json、README 和关键源码；总结项目用途、技术栈、构建/测试/运行命令、目录结构与架构、代码约定；最后用 write_file 写入 ./CLAUDE.md。若已存在 CLAUDE.md，先 read_file 读它、在其基础上更新。内容简洁、面向 AI 助手。」
- `index.ts`：`handleCommand` 返回 `runPrompt` 时，把它当作一次普通用户输入跑 `runTurn`（模型据此探索 + 写文件，写文件经现有 y/n 确认 + diff）。
- `/help` 文本补上 `/init` 说明。

### 3. 文档同步
- `README.md`：命令表补 `/init`，工具表补 `list_files`，补 `--resume`、CLAUDE.md 注入、配置项（`VOID_COMPACT_THRESHOLD` 等）。
- `docs/ARCHITECTURE.md`：在「已知缺口」与子系统说明中反映已实现的 Phase 2-3 能力（diff/markdown 渲染、token 统计、Ctrl+C、工具兜底、list_files、会话持久化/压缩、CLAUDE.md 注入与 /init）；把这些从「未实现」挪到「已实现」。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/context/project-context.ts` | **新增** loadProjectContext |
| `src/ui/commands.ts` | CommandResult += runPrompt；/init + INIT_PROMPT；help 补 /init |
| `src/index.ts` | 新会话注入 CLAUDE.md；处理 cmd.runPrompt 跑一轮 |
| `README.md` | 同步新能力 |
| `docs/ARCHITECTURE.md` | 同步新能力 |

## 测试策略

- **单测**：
  - `loadProjectContext`：仅项目 / 仅全局 / 两者都有 / 都没有（用临时目录，不碰真实 `~/.void-code`）→ 返回内容正确、缺失返回 ""。
  - `handleCommand`：`/init` 返回 `{ handled: true, runPrompt: <非空> }`；`/help` 文本包含 "init"。
- **手动验收**：REPL 里 `/init` 真实生成 CLAUDE.md；之后重启（新会话）看系统提示是否注入了项目/全局 CLAUDE.md（可让模型复述项目约定验证）。
- **文档**：人工检查 README/ARCHITECTURE 与当前代码一致。

## 非目标

不做多 Provider、MCP、子 agent、富 TUI（Phase 4 其余项）。CLAUDE.md 注入只读 cwd 与全局两处，不做向上递归父目录查找。

## 验收标准

- [ ] `loadProjectContext` 能正确合并项目 + 全局 CLAUDE.md，缺失安全跳过。
- [ ] 新会话启动时，存在的 CLAUDE.md 被拼进系统提示；`--resume` 不重复注入。
- [ ] REPL 输入 `/init` 能触发 agent 探索并写出 ./CLAUDE.md（写文件经 y/n 确认）。
- [ ] `/help` 列出 `/init`。
- [ ] README 与 ARCHITECTURE 反映当前已实现的全部能力。
- [ ] 全量单测通过、`npm run build` 无错；现有功能不回归。
