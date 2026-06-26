# void-code Skill 系统 设计文档

- **日期**: 2026-06-26
- **定位**: 仿 Claude Code 给 void-code 加 skill 系统（渐进式披露三级加载）
- **前置**: 全部前序功能（含 MCP）已完成，106 单测全绿。

## 目标

让 void-code 支持「skill」——把可复用的指令/工作流放进 `SKILL.md`，启动时只注入元数据（name+description），模型按需用 `skill` 工具加载完整指令（第②级），skill 正文里引用的附属文件由模型用 `read_file` 按需读（第③级）。用户也能 `/skill <name>` 手动触发、`/skills` 查看清单。

## 范围（最小可用）

- frontmatter 只支持 `name`、`description`（手写解析，不引 yaml 库）。
- 不做 `allowed-tools`、`context: fork`（子 agent）、`when_to_use` 等高级字段。

## 接口定义

### 发现与解析（`src/skills/loader.ts`）
```ts
export interface Skill {
  name: string;        // frontmatter name，缺省用目录名
  description: string; // frontmatter description，缺省空串
  body: string;        // frontmatter 之后的正文（已 trim）
  path: string;        // SKILL.md 绝对/相对路径
}

export function parseSkillFile(content: string, fallbackName: string, path: string): Skill;
export function loadSkills(dirs: string[]): Promise<Skill[]>;
export function renderSkillsForPrompt(skills: Skill[]): string;
```
- `parseSkillFile`：先把 `\r\n` 归一为 `\n`。若内容以 `---` 起，解析首个 `---`/`---` 之间的 frontmatter，逐行 `key: value`（去引号）取 `name`/`description`，其余为 body；否则整体为 body、name=fallbackName、description=""。
- `loadSkills(dirs)`：扫每个 dir 下的**子目录**，子目录里有 `SKILL.md` 才算 skill；按目录名 fallback。同名 skill **靠后的 dir 不覆盖靠前的**——约定调用方传 `[项目目录, 全局目录]`，**项目优先**。读不到的目录/文件跳过。返回去重后的 `Skill[]`。
- `renderSkillsForPrompt(skills)`：空则返回 `""`；否则返回以 `\n\n` 开头的块：`# 可用 Skill\n需要时用 skill 工具按名称加载完整指令：\n- <name>: <description>\n…`。

### skill 工具（`src/skills/tool.ts`）—— 第②级
```ts
export function makeSkillTool(skills: Skill[]): Tool;
```
- 返回的 `Tool`：name `skill`、`isWriteOrExec: false`、参数 `{ name: string }`（required）。
- `execute({name})`：在 `skills` 里按 name 找；找到返回 `skill.body`（完整指令进 tool_result = 注入 context）；找不到返回 `错误：未找到 skill "<name>"。可用：<逗号分隔的名字>`。

### 命令（`src/ui/commands.ts`）
- `CommandContext` 增加 `skills: Skill[]`。
- `/skills`：返回 message——列出每个 skill 的 `name — description`（无则提示「（无可用 skill）」）。
- `/skill <name>`：找到则返回 `{ handled: true, runPrompt: skill.body }`（当一轮对话跑，模型按指令执行）；无参数返回用法提示 message；未找到返回 message 提示。
- `handleCommand` 需要取命令后的参数（`/skill foo` → cmd=`skill`、arg=`foo`）。
- `helpText` 补 `/skills`、`/skill <name>`。

### index 集成（`src/index.ts`）
- 启动（本地工具注册之后）：
  ```ts
  const skills = await loadSkills([
    join(process.cwd(), ".void-code", "skills"),
    join(homedir(), ".void-code", "skills"),
  ]);
  registry.register(makeSkillTool(skills));
  ```
- 新会话系统提示追加：`baseSystemPrompt = buildSystemPrompt(...) + (await loadProjectContext(...)) + renderSkillsForPrompt(skills)`。
- `ctx` 增加 `skills`。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/skills/loader.ts` | **新增** Skill + parseSkillFile + loadSkills + renderSkillsForPrompt |
| `src/skills/tool.ts` | **新增** makeSkillTool |
| `src/ui/commands.ts` | CommandContext += skills；/skills + /skill；help |
| `src/index.ts` | 加载 skill、注册 skill 工具、注入提示、ctx 传 skills |

## 测试策略

- **单测**：
  - `parseSkillFile`：有 frontmatter（取 name/description、body 正确）；无 frontmatter（name=fallback、body=全文）。
  - `loadSkills`（临时目录）：解析一个 skill；项目覆盖全局同名；缺目录返回 []。
  - `renderSkillsForPrompt`：含 name/description；空 → ""。
  - `makeSkillTool`：execute 返回 body；未知 name 返回错误含可用清单；isWriteOrExec false、name `skill`。
  - `commands`：/skills 列清单；/skill <name> 返回 runPrompt=body；/skill 无参/未知给 message；/help 含 /skill。
- **手动验收**：在 `.void-code/skills/<name>/SKILL.md` 建个真实 skill，启动看系统提示是否注入；`/skills` 列出；`/skill <name>` 手动跑；让模型自己用 `skill` 工具加载。

## 非目标

不做 allowed-tools 免确认、context:fork 子 agent、参数替换（$ARGUMENTS）、嵌套向上发现、自动按 paths 触发。

## 验收标准

- [ ] `parseSkillFile` 正确解析 name/description/body，无 frontmatter 也安全。
- [ ] `loadSkills` 扫两处目录、项目覆盖全局、缺目录安全返回 []。
- [ ] 启动注入 skill 元数据列表进新会话系统提示。
- [ ] `skill` 工具按名加载 body（第②级），未知名返回可用清单。
- [ ] `/skills` 列清单、`/skill <name>` 手动触发、`/help` 含之。
- [ ] 全量单测通过、`npm run build` 无错；现有功能不回归。
