import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { listFilesTool } from "../src/tools/list.js";

const dir = "tests/.tmp-list";

beforeAll(async () => {
  await mkdir(`${dir}/sub`, { recursive: true });
  await writeFile(`${dir}/a.ts`, "");
  await writeFile(`${dir}/sub/b.ts`, "");
  await writeFile(`${dir}/c.md`, "");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("listFilesTool", () => {
  it("按 glob 匹配 .ts 文件（含子目录）", async () => {
    const out = await listFilesTool.execute({ pattern: "**/*.ts", cwd: dir });
    expect(out).toContain("a.ts");
    expect(out).toContain("b.ts");
    expect(out).not.toContain("c.md");
    // 确认返回路径带 cwd 前缀，可直接传给 read_file
    expect(out).toContain("tests/.tmp-list/a.ts");
    expect(out).toContain("tests/.tmp-list/sub/b.ts");
  });

  it("无匹配返回提示", async () => {
    const out = await listFilesTool.execute({ pattern: "**/*.py", cwd: dir });
    expect(out).toMatch(/未找到/);
  });

  it("缺 pattern 返回错误", async () => {
    expect(await listFilesTool.execute({})).toMatch(/缺少必填参数 pattern/);
  });
});
