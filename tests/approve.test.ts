import { describe, it, expect } from "vitest";
import { approveIfNeeded, buildPreview, Confirmer } from "../src/permission/approve.js";
import { ToolCall } from "../src/provider/types.js";

function call(name: string, args: object): ToolCall {
  return { id: "c", type: "function", function: { name, arguments: JSON.stringify(args) } };
}

const yes: Confirmer = { async confirm() { return true; } };
const no: Confirmer = { async confirm() { return false; } };

describe("approveIfNeeded", () => {
  it("读类工具直接放行，不询问", async () => {
    expect(await approveIfNeeded(call("read_file", { path: "a" }), false, no)).toBe(true);
  });

  it("写类工具：用户同意则 true", async () => {
    expect(await approveIfNeeded(call("write_file", { path: "a", content: "x" }), true, yes)).toBe(true);
  });

  it("写类工具：用户拒绝则 false", async () => {
    expect(await approveIfNeeded(call("write_file", { path: "a", content: "x" }), true, no)).toBe(false);
  });
});

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("buildPreview", () => {
  it("bash 显示完整命令", async () => {
    expect(await buildPreview(call("bash", { command: "ls -la" }))).toContain("ls -la");
  });

  it("edit_file 显示 old→new 的 diff", async () => {
    const p = strip(await buildPreview(call("edit_file", { path: "x.ts", old_string: "foo", new_string: "bar" })));
    expect(p).toContain("x.ts");
    expect(p).toContain("- foo");
    expect(p).toContain("+ bar");
  });

  it("write_file 对不存在的文件显示全新增", async () => {
    const p = strip(await buildPreview(call("write_file", { path: "tests/.nope-xyz-123.txt", content: "hi" })));
    expect(p).toContain("+ hi");
  });
});
