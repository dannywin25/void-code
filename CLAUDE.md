# void-code

一个对标 Claude Code 的最小 agentic 编码 CLI（学习项目）。在终端用自然语言提需求，模型自主调用工具（读 / 写 / 执行 / 搜索）来完成编码任务。

## 技术栈
TypeScript + Node.js (ESM)，对接免费的智谱 GLM-4-Flash（OpenAI 兼容接口）。

## 构建/测试/运行命令
- 构建：npm run build
- 测试：npm test
- 运行：npm run dev

## 目录结构与架构
- 包含 `src` 目录，其中是 TypeScript 源代码。
- 包含 `dist` 目录，用于存放编译后的文件。
- 包含 `tests` 目录，用于存放测试文件。

## 代码约定
- 使用 TypeScript 编写代码。
- 使用 Node.js (ESM) 模块系统。
- 使用 vitest 进行测试。