# void-code Skill 系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 void-code 加 skill 系统（渐进式披露）：启动注入 skill 元数据、模型用 `skill` 工具按需加载完整指令、用户可 `/skills` `/skill <name>` 触发。

**Architecture:** `skills/loader.ts` 扫 `.void-code/skills/` 解析 SKILL.md（手写 frontmatter）；`skills/tool.ts` 的 `skill` 工具返回 body 实现第②级加载（复用工具循环）；`commands.ts` 加手动命令；`index.ts` 启动加载/注册/注入。

**Tech Stack:** TypeScript + Node.js (ESM)、node 内置 fs/os/path、`vitest`。

## Global Constraints

- **运行时**：ESM（`"type":"module"`），TypeScript `NodeNext`，源码 import 一律带 `.js` 后缀。
- **测试框架**：`vitest`，测试放 `tests/`；写盘测试用 `tests/.tmp-*`，**不要碰真实 `~/.void-code`**。
- **不破坏现有功能**：现有 106 个单测保持全绿（个别因接口扩展需同步更新的除外）。
- **frontmatter 仅支持 `name`、`description`**，手写解析，不引 yaml 库。
- **skill 目录**：项目 `<cwd>/.void-code/skills/`、全局 `~/.void-code/skills/`，每个子目录含 `SKILL.md`；**项目覆盖全局**同名。
- **`skill` 工具**：name `skill`、`isWriteOrExec: false`。
- **语言**：面向用户文案用中文；标识符用英文。
- **提交策略（覆盖默认）**：禁止自动 `git commit`/`git push`。每个任务最后一步是「向用户报告完成并列出改动文件，由用户自行提交」。

---

## File Structure

| 文件 | 改动 | 任务 |
|------|------|------|
| `src/skills/loader.ts` | **新增** Skill + parseSkillFile + loadSkills + renderSkillsForPrompt | T1 |
| `src/skills/tool.ts` | **新增** makeSkillTool | T2 |
| `src/ui/commands.ts` | CommandContext += skills；/skills + /skill；help | T3 |
| `src/index.ts` | 加载 skill、注册 skill 工具、注入提示、ctx 传 skills | T4 |

---

### Task 1: skill 发现与解析

**Files:**
- Create: `src/skills/loader.ts`
- Test: `tests/skills-loader.test.ts`

**Interfaces:**
- Produces:
  - `interface Skill { name: string; description: string; body: string; path: string }`
  - `function parseSkillFile(content: string, fallbackName: string, path: string): Skill`
  - `function loadSkills(dirs: string[]): Promise<Skill[]>`（约定传 `[项目, 全局]`，项目覆盖全局）
  - `function renderSkillsForPrompt(skills: Skill[]): string`

- [ ] **Step 1: 写失败测试 `tests/skills-loader.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { parseSkillFile, loadSkills, renderSkillsForPrompt } from "../src/skills/loader.js";

const base = "tests/.tmp-skills";
const proj = `${base}/proj`;
const glob = `${base}/glob`;

beforeAll(async () => {
  await mkdir(`${proj}/greet`, { recursive: true });
  await writeFile(`${proj}/greet/SKILL.md`, "---\nname: greet\ndescription: 打招呼\n---\n说你好。");
  await mkdir(`${glob}/greet`, { recursive: true });
  await writeFile(`${glob}/greet/SKILL.md`, "---\nname: greet\ndescription: 全局版本\n---\n全局指令");
  await mkdir(`${glob}/bye`, { recursive: true });
  await writeFile(`${glob}/bye/SKILL.md`, "---\nname: bye\ndescription: 告别\n---\n说再见。");
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("parseSkillFile", () => {
  it("解析 frontmatter 的 name/description 与 body", () => {
    const s = parseSkillFile("---\nname: x\ndescription: 描述\n---\n正文内容", "fallback", "/p");
    expect(s.name).toBe("x");
    expect(s.description).toBe("描述");
    expect(s.body).toBe("正文内容");
  });
  it("无 frontmatter 时 name 用 fallback、body 为全文", () => {
    const s = parseSkillFile("没有 frontmatter 的正文", "mydir", "/p");
    expect(s.name).toBe("mydir");
    expect(s.description).toBe("");
    expect(s.body).toBe("没有 frontmatter 的正文");
  });
});

describe("loadSkills", () => {
  it("扫目录、项目覆盖全局同名", async () => {
    const skills = await loadSkills([proj, glob]);
    expect(skills.find((s) => s.name === "greet")!.description).toBe("打招呼"); // 项目版本胜出
    expect(skills.map((s) => s.name).sort()).toEqual(["bye", "greet"]);
  });
  it("缺目录安全返回 []（不抛）", async () => {
    expect(await loadSkills([`${base}/none1`, `${base}/none2`])).toEqual([]);
  });
});

describe("renderSkillsForPrompt", () => {
  it("含 name 与 description", () => {
    const out = renderSkillsForPrompt([{ name: "a", description: "甲", body: "", path: "" }]);
    expect(out).toContain("可用 Skill");
    expect(out).toContain("a: 甲");
  });
  it("空数组返回空串", () => {
    expect(renderSkillsForPrompt([])).toBe("");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/skills/loader.js'`）

- [ ] **Step 3: 实现 `src/skills/loader.ts`**

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
}

export function parseSkillFile(content: string, fallbackName: string, path: string): Skill {
  const normalized = content.replace(/\r\n/g, "\n");
  let name = fallbackName;
  let description = "";
  let body = normalized.trim();

  const fm = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fm) {
    body = fm[2].trim();
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (key === "name") name = val;
      else if (key === "description") description = val;
    }
  }
  return { name, description, body, path };
}

export async function loadSkills(dirs: string[]): Promise<Skill[]> {
  const byName = new Map<string, Skill>();
  // 约定 [项目, 全局]：倒序处理（先全局后项目），项目最后写入覆盖全局同名
  for (const dir of [...dirs].reverse()) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // 目录不存在
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMd = join(dir, e.name, "SKILL.md");
      let content;
      try {
        content = await readFile(skillMd, "utf8");
      } catch {
        continue; // 子目录没有 SKILL.md
      }
      const skill = parseSkillFile(content, e.name, skillMd);
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()];
}

export function renderSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  return `\n\n# 可用 Skill\n需要时用 skill 工具按名称加载完整指令：\n${lines}`;
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（loader 6 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 1 完成，新增 `src/skills/loader.ts`、`tests/skills-loader.test.ts`。

---

### Task 2: skill 工具（第②级加载）

**Files:**
- Create: `src/skills/tool.ts`
- Test: `tests/skills-tool.test.ts`

**Interfaces:**
- Consumes: `Tool`（`src/tools/registry.js`）、`Skill`（T1）。
- Produces: `function makeSkillTool(skills: Skill[]): Tool`（工具名 `skill`，参数 `{name}`，`isWriteOrExec:false`，execute 返回对应 body）。

- [ ] **Step 1: 写失败测试 `tests/skills-tool.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { makeSkillTool } from "../src/skills/tool.js";
import { Skill } from "../src/skills/loader.js";

const skills: Skill[] = [{ name: "greet", description: "打招呼", body: "说你好。", path: "/p" }];

describe("makeSkillTool", () => {
  it("工具名 skill、只读、有必填 name 参数", () => {
    const tool = makeSkillTool(skills);
    expect(tool.schema.function.name).toBe("skill");
    expect(tool.isWriteOrExec).toBe(false);
    expect(tool.schema.function.parameters).toMatchObject({ required: ["name"] });
  });
  it("execute 返回对应 skill 的 body", async () => {
    expect(await makeSkillTool(skills).execute({ name: "greet" })).toBe("说你好。");
  });
  it("未知 skill 返回错误含可用清单", async () => {
    const out = await makeSkillTool(skills).execute({ name: "nope" });
    expect(out).toMatch(/未找到/);
    expect(out).toContain("greet");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../src/skills/tool.js'`）

- [ ] **Step 3: 实现 `src/skills/tool.ts`**

```ts
import { Tool } from "../tools/registry.js";
import { Skill } from "./loader.js";

export function makeSkillTool(skills: Skill[]): Tool {
  return {
    isWriteOrExec: false,
    schema: {
      type: "function",
      function: {
        name: "skill",
        description:
          "按名称加载一个 skill 的完整指令到上下文，然后按其指示执行。可用 skill 见系统提示中的列表。",
        parameters: {
          type: "object",
          properties: { name: { type: "string", description: "skill 名称" } },
          required: ["name"],
        },
      },
    },
    async execute(args) {
      const name = typeof args.name === "string" ? args.name : "";
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        const available = skills.map((s) => s.name).join(", ") || "（无）";
        return `错误：未找到 skill "${name}"。可用：${available}`;
      }
      return skill.body;
    },
  };
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（tool 3 个用例 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 2 完成，新增 `src/skills/tool.ts`、`tests/skills-tool.test.ts`。

---

### Task 3: /skills 与 /skill 命令

**Files:**
- Modify: `src/ui/commands.ts`
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: `Skill`（T1）。
- Produces: `CommandContext` 增加 `skills: Skill[]`；新增 `/skills`（列清单）、`/skill <name>`（手动触发，返回 `runPrompt`）。

- [ ] **Step 1: 更新测试 `tests/commands.test.ts`**

把 `makeCtx` 的返回增加 `skills`：
```ts
  return {
    session,
    registry,
    model: "glm-4-flash",
    skills: [{ name: "demo", description: "演示", body: "演示指令", path: "/p" }],
  };
```
追加用例：
```ts
  it("/skills 列出可用 skill", () => {
    const r = handleCommand("/skills", makeCtx());
    expect(r.handled).toBe(true);
    expect(r.message).toContain("demo");
  });
  it("/skill <name> 返回 runPrompt=body", () => {
    expect(handleCommand("/skill demo", makeCtx()).runPrompt).toBe("演示指令");
  });
  it("/skill 未知名给提示", () => {
    expect(handleCommand("/skill nope", makeCtx()).message).toMatch(/未找到/);
  });
  it("/skill 无参数给用法", () => {
    expect(handleCommand("/skill", makeCtx()).message).toMatch(/用法/);
  });
  it("/help 含 /skill", () => {
    expect(handleCommand("/help", makeCtx()).message).toContain("/skill");
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`/skills`/`/skill` 走 default；makeCtx 缺 skills 类型不符）

- [ ] **Step 3: 修改 `src/ui/commands.ts`**

(a) 顶部 import 增加：
```ts
import { Skill } from "../skills/loader.js";
```
(b) `CommandContext` 增加字段：
```ts
export interface CommandContext {
  session: Session;
  registry: ToolRegistry;
  model: string;
  skills: Skill[];
}
```
(c) 把 `handleCommand` 里取命令名那行（形如 `const cmd = input.slice(1).trim().split(/\s+/)[0];`）替换为同时取参数：
```ts
  const parts = input.slice(1).trim().split(/\s+/);
  const cmd = parts[0];
  const arg = parts.slice(1).join(" ");
```
(d) 在 `switch (cmd)` 中，`case "model":` 之后插入两个分支：
```ts
    case "skills":
      return { handled: true, message: skillsText(ctx.skills) };
    case "skill": {
      if (!arg) return { handled: true, message: "用法：/skill <name>。用 /skills 查看可用 skill。" };
      const s = ctx.skills.find((x) => x.name === arg);
      if (!s) return { handled: true, message: `未找到 skill "${arg}"。用 /skills 查看可用。` };
      return { handled: true, runPrompt: s.body };
    }
```
(e) 文件底部新增辅助函数：
```ts
function skillsText(skills: Skill[]): string {
  if (skills.length === 0) return "（无可用 skill）";
  const lines = skills.map((s) => `  ${s.name} — ${s.description}`).join("\n");
  return `可用 skill：\n${lines}`;
}
```
(f) 在 `helpText` 的命令清单里（`/init` 那行之后）加两行：
```ts
    "  /skills — 列出可用 skill",
    "  /skill <name> — 手动触发某个 skill",
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npm test && npm run build`
Expected: PASS（commands 新 5 个 + 其余全部）；tsc 无错误。

- [ ] **Step 5: 报告完成（不自动提交）**

报告：Task 3 完成，修改 `src/ui/commands.ts`、`tests/commands.test.ts`。

---

### Task 4: index 集成

**Files:**
- Modify: `src/index.ts`
- 无新增单测（集成 + 读真实目录），靠全量测试 + 编译 + 手动验收。

**Interfaces:**
- Consumes: `loadSkills`/`renderSkillsForPrompt`（T1）、`makeSkillTool`（T2）。

- [ ] **Step 1: 顶部 import 增加**

```ts
import { homedir } from "node:os";
import { loadSkills, renderSkillsForPrompt } from "./skills/loader.js";
import { makeSkillTool } from "./skills/tool.js";
```
（注意：`join` 已在前序 import 过，复用即可，不要重复 import。）

- [ ] **Step 2: 启动时加载 skill 并注册 skill 工具**

在本地工具注册循环（`for (const tool of [readFileTool, ...]) registry.register(tool);`）**之后**插入：
```ts
  const skills = await loadSkills([
    join(process.cwd(), ".void-code", "skills"),
    join(homedir(), ".void-code", "skills"),
  ]);
  registry.register(makeSkillTool(skills));
```

- [ ] **Step 3: 把 skill 列表注入新会话系统提示**

把现有的：
```ts
  const baseSystemPrompt =
    buildSystemPrompt(process.cwd(), process.platform) +
    (await loadProjectContext(process.cwd(), defaultGlobalDir()));
```
改为：
```ts
  const baseSystemPrompt =
    buildSystemPrompt(process.cwd(), process.platform) +
    (await loadProjectContext(process.cwd(), defaultGlobalDir())) +
    renderSkillsForPrompt(skills);
```

- [ ] **Step 4: ctx 传入 skills**

把：
```ts
  const ctx = { session, registry, model: config.model };
```
改为：
```ts
  const ctx = { session, registry, model: config.model, skills };
```

- [ ] **Step 5: 全量测试 + 编译**

Run: `npm test && npm run build`
Expected: 所有单测 PASS；tsc 无错误。

- [ ] **Step 6: 手动验收（需用户执行）**

1. 建一个 skill：`.void-code/skills/commit-msg/SKILL.md`：
   ```
   ---
   name: commit-msg
   description: 根据暂存改动写一条规范的英文 commit message
   ---
   请用 git 工具查看暂存的改动（git diff --cached），然后写一条简洁规范的英文 commit message（祈使句、首字母大写、不超过 72 字），只输出 message 本身。
   ```
2. `npm run dev`（需 GLM key）→ 启动后系统提示里应含「# 可用 Skill … commit-msg: …」。
3. `/skills` → 列出 `commit-msg`。
4. `/skill commit-msg` → 手动触发，模型按 skill 指令执行。
5. 说一句让模型自己判断该用 skill 的话（如「帮我写个 commit message」）→ 观察模型是否**自己调 `skill` 工具**加载 commit-msg 再执行（第②级渐进披露）。
6. 在 `~/.void-code/skills/` 放一个全局 skill，重启验证也被发现。

- [ ] **Step 7: 报告完成（不自动提交）**

报告：Task 4 完成，修改 `src/index.ts`，附手动验收结果。

---

## Self-Review

**Spec 覆盖检查：**
- 发现与解析（parseSkillFile/loadSkills/项目覆盖全局/缺目录安全）→ T1 ✅
- 第①级注入（renderSkillsForPrompt + index 注入新会话提示）→ T1 + T4（Step 3）✅
- 第②级 skill 工具（按名返回 body、未知名清单）→ T2 ✅
- 第③级（附属文件用 read_file）→ 无需代码，skill body 内引用即可（spec 已说明）✅
- 手动触发（/skills 列清单、/skill <name> runPrompt、help）→ T3 ✅
- index 集成（加载/注册/注入/ctx）→ T4 ✅
- 验收标准每条均有任务对应 + T4 Step 6 手动核对 ✅
- 不破坏现有：每任务跑全量测试；注入只加在新会话、skill 工具与本地工具同机制注册 ✅

**占位符扫描：** 无 TBD/TODO/「类似上面」；每个代码步骤均有完整代码或精确改法。✅

**类型一致性：** `Skill{name,description,body,path}`、`parseSkillFile(content,fallbackName,path):Skill`、`loadSkills(dirs):Promise<Skill[]>`、`renderSkillsForPrompt(skills):string`、`makeSkillTool(skills):Tool`、`CommandContext{...,skills}`、index 里 `loadSkills([项目,全局])` + `ctx.skills` 在各任务间一致。skill 工具走现有 `Tool` 接口与 `ToolRegistry.register`。✅
