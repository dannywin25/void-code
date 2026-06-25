import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { writeFileTool, editFileTool } from "../src/tools/write.js";

const dir = "tests/.tmp-write";

beforeEach(async () => {
  await mkdir(dir, { recursive: true });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileTool", () => {
  it("写入新文件", async () => {
    const out = await writeFileTool.execute({ path: `${dir}/new.txt`, content: "hello" });
    expect(out).toMatch(/已写入/);
    expect(await readFile(`${dir}/new.txt`, "utf8")).toBe("hello");
  });

  it("缺参数返回错误", async () => {
    expect(await writeFileTool.execute({ path: `${dir}/x.txt` })).toMatch(/缺少必填参数/);
  });
});

describe("editFileTool", () => {
  it("唯一匹配时替换成功", async () => {
    await writeFile(`${dir}/e.txt`, "foo bar baz");
    const out = await editFileTool.execute({ path: `${dir}/e.txt`, old_string: "bar", new_string: "QUX" });
    expect(out).toMatch(/已编辑/);
    expect(await readFile(`${dir}/e.txt`, "utf8")).toBe("foo QUX baz");
  });

  it("匹配不到时返回错误且不改文件", async () => {
    await writeFile(`${dir}/e2.txt`, "abc");
    const out = await editFileTool.execute({ path: `${dir}/e2.txt`, old_string: "zzz", new_string: "x" });
    expect(out).toMatch(/未找到/);
    expect(await readFile(`${dir}/e2.txt`, "utf8")).toBe("abc");
  });

  it("匹配多处时报错要求唯一", async () => {
    await writeFile(`${dir}/e3.txt`, "x x x");
    const out = await editFileTool.execute({ path: `${dir}/e3.txt`, old_string: "x", new_string: "y" });
    expect(out).toMatch(/多处/);
  });
});
