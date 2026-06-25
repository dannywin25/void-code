import { describe, it, expect, vi } from "vitest";
import { runTurn, LoopUI, looksLikeUncalledCommand } from "../src/agent/loop.js";
import { ToolRegistry, Tool } from "../src/tools/registry.js";
import { Session } from "../src/context/session.js";
import { Provider, ChatResult } from "../src/provider/types.js";

function makeUI(): LoopUI {
  return {
    renderAssistant: vi.fn(),
    thinkingStart: vi.fn(),
    thinkingStop: vi.fn(),
    toolCall: vi.fn(),
    toolResult: vi.fn(),
    info: vi.fn(),
    confirm: vi.fn(async () => true),
  };
}

const echoTool: Tool = {
  isWriteOrExec: false,
  schema: { type: "function", function: { name: "echo", description: "", parameters: { type: "object", properties: {} } } },
  async execute() { return "echoed"; },
};

// 第一次回工具调用，第二次回纯文本 —— 模拟模型多轮
function scriptedProvider(results: ChatResult[]): Provider {
  let i = 0;
  return { async chat() { return results[i++]; } };
}

describe("runTurn", () => {
  it("调用工具后把结果回填，再次请求模型，直到纯文本回答", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const session = new Session("SYS");
    const ui = makeUI();
    const provider = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", type: "function", function: { name: "echo", arguments: "{}" } }] },
      { text: "完成了", toolCalls: [] },
    ]);

    await runTurn("做点事", { provider, registry, session, ui, maxIterations: 25 });

    // user, assistant(tool), tool result, assistant(final) —— 加上初始 system 共 5 条
    expect(session.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(session.messages[3]).toMatchObject({ role: "tool", tool_call_id: "c1", content: "echoed" });
    expect(ui.toolCall).toHaveBeenCalledOnce();
  });

  it("写类工具被拒绝时回填「已拒绝」且不执行", async () => {
    const writeTool: Tool = {
      isWriteOrExec: true,
      schema: { type: "function", function: { name: "w", description: "", parameters: { type: "object", properties: {} } } },
      execute: vi.fn(async () => "SHOULD_NOT_RUN"),
    };
    const registry = new ToolRegistry();
    registry.register(writeTool);
    const session = new Session("SYS");
    const ui = makeUI();
    ui.confirm = vi.fn(async () => false);
    const provider = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", type: "function", function: { name: "w", arguments: "{}" } }] },
      { text: "好的", toolCalls: [] },
    ]);

    await runTurn("写文件", { provider, registry, session, ui, maxIterations: 25 });

    expect(writeTool.execute).not.toHaveBeenCalled();
    expect(session.messages[3].content).toMatch(/拒绝/);
  });

  it("confirm 依赖 this 字段的 class UI —— 正确保留 this 绑定", async () => {
    // 用一个依赖 this.allowed 字段的 class UI 来验证 this 绑定被正确保留。
    // 修复前：{ confirm: ui.confirm } 丢失 this，访问 this.allowed 会得到 undefined，
    //         vi.fn 替代时不暴露问题；真实 class 实例则会在修复前以裸函数调用而 this=undefined 崩溃。
    // 修复后：直接传 ui 对象，confirm 以方法调用方式执行，this 正确。
    class ClassUI implements LoopUI {
      allowed: boolean;
      confirmed = false;
      constructor(allowed: boolean) { this.allowed = allowed; }
      renderAssistant = vi.fn();
      thinkingStart = vi.fn();
      thinkingStop = vi.fn();
      toolCall = vi.fn();
      toolResult = vi.fn();
      info = vi.fn();
      async confirm(_message: string): Promise<boolean> {
        // 依赖 this.allowed —— 若 this 丢失则 this.allowed 为 undefined（falsy），
        // 即使 allowed=true 也会返回 false，导致写工具被错误拒绝。
        this.confirmed = true;
        return this.allowed;
      }
    }

    const writeTool: Tool = {
      isWriteOrExec: true,
      schema: { type: "function", function: { name: "w2", description: "", parameters: { type: "object", properties: {} } } },
      execute: vi.fn(async () => "write-done"),
    };
    const registry = new ToolRegistry();
    registry.register(writeTool);
    const session = new Session("SYS");

    // 用 allowed=true 的 class UI：confirm 应返回 true，工具应被执行
    const ui = new ClassUI(true);
    const provider = scriptedProvider([
      { text: "", toolCalls: [{ id: "c2", type: "function", function: { name: "w2", arguments: "{}" } }] },
      { text: "写完了", toolCalls: [] },
    ]);

    await runTurn("写文件", { provider, registry, session, ui, maxIterations: 25 });

    // confirm 被调用，且 this 绑定正确（confirmed 字段被成功写入）
    expect(ui.confirmed).toBe(true);
    // this.allowed=true → confirm 返回 true → 工具被执行
    expect(writeTool.execute).toHaveBeenCalledOnce();
    expect(session.messages[3].content).toBe("write-done");
  });

  it("达到 maxIterations 上限时中止并提示", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const session = new Session("SYS");
    const ui = makeUI();
    // 永远回工具调用，制造死循环
    const provider: Provider = {
      async chat() {
        return { text: "", toolCalls: [{ id: "c", type: "function", function: { name: "echo", arguments: "{}" } }] };
      },
    };

    await runTurn("循环", { provider, registry, session, ui, maxIterations: 3 });
    expect(ui.info).toHaveBeenCalledWith(expect.stringMatching(/最大迭代/));
  });

  it("累加本轮多次请求的 token 并返回", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const session = new Session("SYS");
    const ui = makeUI();
    const provider = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", type: "function", function: { name: "echo", arguments: "{}" } }], usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      { text: "完成", toolCalls: [], usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 } },
    ]);
    const used = await runTurn("做事", { provider, registry, session, ui, maxIterations: 25 });
    expect(used).toEqual({ promptTokens: 30, completionTokens: 13 });
  });

  it("中断错误被捕获，提示并优雅返回（不抛）", async () => {
    const registry = new ToolRegistry();
    const session = new Session("SYS");
    const ui = makeUI();
    const provider = {
      async chat() {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
    } as any;
    const used = await runTurn("x", { provider, registry, session, ui, maxIterations: 25 });
    expect(ui.info).toHaveBeenCalledWith(expect.stringMatching(/中断/));
    expect(used).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("循环开始前 signal 已 abort 则立即中断、不调用 provider", async () => {
    const provider = { chat: vi.fn() } as any;
    const registry = new ToolRegistry();
    const session = new Session("SYS");
    const ui = makeUI();
    const ac = new AbortController();
    ac.abort();
    const used = await runTurn("x", { provider, registry, session, ui, maxIterations: 25 }, ac.signal);
    expect(provider.chat).not.toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringMatching(/中断/));
    expect(used).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("looksLikeUncalledCommand 识别 shell 代码块", () => {
    expect(looksLikeUncalledCommand("先执行：\n```bash\nls\n```")).toBe(true);
    expect(looksLikeUncalledCommand("这是一段普通回答")).toBe(false);
  });

  it("模型只写命令代码块未调工具时，兜底追加一轮", async () => {
    const registry = new ToolRegistry();
    const session = new Session("SYS");
    const ui = makeUI();
    const provider = scriptedProvider([
      { text: "我将运行：\n```bash\nls -R\n```", toolCalls: [] },
      { text: "好的，已说明。", toolCalls: [] },
    ]);
    const chatSpy = vi.spyOn(provider, "chat");
    await runTurn("看下目录", { provider, registry, session, ui, maxIterations: 25 });
    expect(chatSpy).toHaveBeenCalledTimes(2); // 兜底触发了第二轮
    expect(session.messages.some((m) => m.role === "user" && String(m.content).includes("系统提醒"))).toBe(true);
  });
});
