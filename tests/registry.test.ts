import { describe, it, expect } from "vitest";
import { ToolRegistry, Tool } from "../src/tools/registry.js";
import { ToolCall } from "../src/provider/types.js";

function call(name: string, args: string): ToolCall {
  return { id: "c", type: "function", function: { name, arguments: args } };
}

const echoTool: Tool = {
  isWriteOrExec: false,
  schema: { type: "function", function: { name: "echo", description: "回显", parameters: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } } },
  async execute(args) {
    if (!args.msg) return "错误：缺少必填参数 msg";
    return `echo: ${args.msg}`;
  },
};

const boomTool: Tool = {
  isWriteOrExec: true,
  schema: { type: "function", function: { name: "boom", description: "炸", parameters: { type: "object", properties: {} } } },
  async execute() {
    throw new Error("kaboom");
  },
};

describe("ToolRegistry", () => {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  reg.register(boomTool);

  it("schemas 返回所有已注册工具", () => {
    expect(reg.schemas().map((s) => s.function.name).sort()).toEqual(["boom", "echo"]);
  });

  it("isWriteOrExec 反映工具风险级别", () => {
    expect(reg.isWriteOrExec("echo")).toBe(false);
    expect(reg.isWriteOrExec("boom")).toBe(true);
  });

  it("正常执行返回工具输出", async () => {
    expect(await reg.execute(call("echo", '{"msg":"hi"}'))).toBe("echo: hi");
  });

  it("未知工具返回错误而不抛", async () => {
    expect(await reg.execute(call("nope", "{}"))).toMatch(/未知工具/);
  });

  it("非法 JSON 参数返回错误而不抛", async () => {
    expect(await reg.execute(call("echo", "{not json"))).toMatch(/合法 JSON/);
  });

  it("工具内部抛异常被捕获为错误字符串", async () => {
    expect(await reg.execute(call("boom", "{}"))).toMatch(/kaboom/);
  });
});
