# void-code

一个对标 Claude Code 的最小 **agentic 编码 CLI**（学习项目）。在终端用自然语言提需求，模型自主调用工具（读 / 写 / 执行 / 搜索）来完成编码任务。

技术栈：TypeScript + Node.js (ESM)，对接免费的智谱 **GLM-4-Flash**（OpenAI 兼容接口）。

## 快速开始

1. 安装依赖：

   ```bash
   npm install
   ```

2. 配置 API Key —— 到 [bigmodel.cn](https://open.bigmodel.cn) 注册拿免费 key，复制 `.env.example` 为 `.env` 并填入：

   ```
   GLM_API_KEY=你的key
   ```

   > `.env` 已被 `.gitignore` 忽略，不会提交。

3. 启动：

   ```bash
   npm run dev
   ```

   然后直接说需求，例如：
   - `了解一下这个项目的结构`
   - `新建 hello.txt 内容是 hello`（写文件会弹 y/n 确认）
   - `运行 ls 看看有哪些文件`
   - `找出代码里所有 TODO`

   输入 `/exit` 或 `exit` 退出。

## 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式运行（tsx） |
| `npm test` | 跑单元测试（vitest） |
| `npm run build` | 编译到 `dist/` |

## 斜杠命令

对话过程中可输入以下斜杠命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息（含可用工具列表） |
| `/tools` | 列出当前可用工具 |
| `/model` | 显示当前使用的模型 |
| `/clear` | 清空会话历史（系统提示保留） |
| `/init` | 分析当前项目并生成 / 更新 `CLAUDE.md` |
| `/exit` | 退出程序 |

## 工具与权限

| 工具 | 作用 | 是否需确认 |
|------|------|-----------|
| `read_file` | 读文件（含 offset/limit 分段读）；路径为目录时列出条目 | 否 |
| `list_files` | 用 glob 模式列出匹配文件路径 | 否 |
| `search` | 递归正则搜索文件内容 | 否 |
| `write_file` | 覆盖写文件（确认时展示彩色 diff） | ✅ y/n |
| `edit_file` | 精确替换文件片段（确认时展示彩色 diff） | ✅ y/n |
| `bash` | 执行 shell 命令 | ✅ y/n |

读取类直接放行，写 / 执行类每次执行前要你确认。

## 会话恢复

每轮对话结束后会自动持久化到 `~/.void-code/sessions/`。

```bash
# 恢复最近一次会话
npm run dev -- --resume

# 恢复指定会话（id 格式：ISO 时间戳，如 2026-06-25T10-00-00-000Z）
npm run dev -- --resume <id>
```

> `--resume` 恢复的会话**不会**重新注入 CLAUDE.md，以避免污染已有的上下文。

## CLAUDE.md 项目记忆

启动新会话时，void-code 会自动读取并注入：

- `./CLAUDE.md`（当前项目根目录）
- `~/.void-code/CLAUDE.md`（全局约定）

两者都有时，全局内容在前、项目内容在后，一起作为系统提示的一部分发送给模型。

使用 `/init` 命令可以让模型探索当前项目并自动生成或更新 `./CLAUDE.md`：

```
> /init
```

## 文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) —— **代码结构与核心实现逻辑**（想读懂代码从这里开始）
- `docs/superpowers/specs/` —— 设计文档
- `docs/superpowers/plans/` —— 实现计划

## 配置项（环境变量）

| 变量 | 默认 | 说明 |
|------|------|------|
| `GLM_API_KEY` | （必填） | 智谱 API Key |
| `GLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 接口地址 |
| `GLM_MODEL` | `glm-4-flash` | 模型 |
| `GLM_MAX_TOKENS` | `4096` | 单次最大输出 |
| `VOID_MAX_ITERATIONS` | `25` | 单轮工具循环上限（防死循环） |
| `VOID_COMPACT_THRESHOLD` | `8000` | 估算 token 数超过此值时触发历史压缩 |
| `VOID_COMPACT_KEEP_RECENT` | `6` | 历史压缩时保留最近几条消息不压缩 |
