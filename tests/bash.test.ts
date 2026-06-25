import { describe, it, expect } from "vitest";
import { bashTool } from "../src/tools/bash.js";

describe("bashTool", () => {
  it("执行成功命令返回 stdout", async () => {
    const out = await bashTool.execute({ command: "echo hello" });
    expect(out).toContain("hello");
    expect(out).toContain("exit 0");
  });

  it("执行失败命令返回非零 exit 和错误（不抛）", async () => {
    const out = await bashTool.execute({ command: "ls /no/such/dir/xyz" });
    expect(out).not.toContain("exit 0");
  });

  it("缺 command 返回错误", async () => {
    expect(await bashTool.execute({})).toMatch(/缺少必填参数 command/);
  });
});
