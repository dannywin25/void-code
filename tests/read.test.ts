import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { readFileTool } from "../src/tools/read.js";

const dir = "tests/.tmp-read";

beforeAll(async () => {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/a.txt`, "line1\nline2\nline3");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readFileTool", () => {
  it("返回带行号的内容", async () => {
    const out = await readFileTool.execute({ path: `${dir}/a.txt` });
    expect(out).toContain("1\tline1");
    expect(out).toContain("3\tline3");
  });

  it("缺 path 返回错误字符串", async () => {
    expect(await readFileTool.execute({})).toMatch(/缺少必填参数 path/);
  });

  it("文件不存在时抛错（交由 registry 捕获）", async () => {
    await expect(readFileTool.execute({ path: `${dir}/nope.txt` })).rejects.toThrow();
  });

  it("path 是目录时返回条目列表（目录名带尾部 /）", async () => {
    await mkdir(`${dir}/sub`, { recursive: true });
    const out = await readFileTool.execute({ path: dir });
    expect(out).toMatch(/条目/);
    expect(out).toContain("a.txt");
    expect(out).toContain("sub/");
  });

  it("offset 从指定行开始，行号按真实行号显示", async () => {
    await writeFile(`${dir}/big.txt`, "L1\nL2\nL3\nL4\nL5");
    const out = await readFileTool.execute({ path: `${dir}/big.txt`, offset: 3 });
    expect(out).toContain("3\tL3");
    expect(out).toContain("5\tL5");
    expect(out).not.toContain("1\tL1");
  });

  it("limit 限制返回行数并提示剩余", async () => {
    await writeFile(`${dir}/big2.txt`, "L1\nL2\nL3\nL4\nL5");
    const out = await readFileTool.execute({ path: `${dir}/big2.txt`, offset: 1, limit: 2 });
    expect(out).toContain("1\tL1");
    expect(out).toContain("2\tL2");
    expect(out).not.toContain("3\tL3");
    expect(out).toMatch(/还有 3 行/);
  });

  it("offset 越界返回错误提示", async () => {
    await writeFile(`${dir}/big3.txt`, "L1\nL2");
    const out = await readFileTool.execute({ path: `${dir}/big3.txt`, offset: 99 });
    expect(out).toMatch(/超出/);
  });
});
