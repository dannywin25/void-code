---
name: commit-msg
description: 查看已暂存的改动并生成一条规范的英文 commit message（不自动提交）
---

请按以下步骤为当前暂存的改动生成一条规范的 git commit message：

1. 用 bash 运行 `git diff --cached --stat` 看改动概览，再用 `git diff --cached` 看具体内容。
   - 若暂存区为空（无输出），告诉用户「暂存区为空，请先 git add」，然后停止。
2. 理解这批改动整体在做什么（新增功能 / 修复 bug / 重构 / 文档 / 测试 等）。
3. 写一条规范的**英文** commit message：
   - 首行（subject）：祈使句、首字母大写、结尾不加句号、不超过 72 个字符。
     例如 `Add request timeout to MCP client`、`Fix orphaned subprocess on exit`。
   - 若改动较多，空一行后用 `-` 要点列出关键改动；简单改动只要首行即可。
4. 只输出最终的 commit message 本身（用代码块包裹），不要附加多余解释。
5. **不要自动执行 `git commit`**——把 message 交给用户，由用户自己提交。
