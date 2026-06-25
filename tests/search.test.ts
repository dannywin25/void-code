import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { searchTool } from "../src/tools/search.js";

const dir = "tests/.tmp-search";

beforeAll(async () => {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/a.ts`, "const x = 1;\n// TODO: fix this\n");
  await writeFile(`${dir}/b.ts`, "console.log('ok');\n");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("searchTool", () => {
  it("找到匹配行并带文件名与行号", async () => {
    const out = await searchTool.execute({ pattern: "TODO", path: dir });
    expect(out).toContain("a.ts");
    expect(out).toMatch(/:2:/);
  });

  it("无匹配时返回提示", async () => {
    const out = await searchTool.execute({ pattern: "NOTHING_HERE", path: dir });
    expect(out).toMatch(/未找到/);
  });

  it("缺 pattern 返回错误", async () => {
    expect(await searchTool.execute({ path: dir })).toMatch(/缺少必填参数 pattern/);
  });

  it("非法正则被上层 registry 视为异常（execute 抛错）", async () => {
    await expect(searchTool.execute({ pattern: "(", path: dir })).rejects.toThrow();
  });
});
