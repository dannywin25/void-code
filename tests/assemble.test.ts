import { describe, it, expect } from "vitest";
import { StreamAssembler } from "../src/provider/assemble.js";

describe("StreamAssembler", () => {
  it("拼接文本增量并触发 onText 回调", () => {
    const a = new StreamAssembler();
    const seen: string[] = [];
    a.addDelta({ content: "你" }, (d) => seen.push(d));
    a.addDelta({ content: "好" }, (d) => seen.push(d));
    const r = a.result();
    expect(r.text).toBe("你好");
    expect(seen).toEqual(["你", "好"]);
    expect(r.toolCalls).toEqual([]);
  });

  it("按 index 累加分片的 tool_call arguments", () => {
    const a = new StreamAssembler();
    a.addDelta({ tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"pa' } }] });
    a.addDelta({ tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] });
    const r = a.result();
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].id).toBe("call_1");
    expect(r.toolCalls[0].function.name).toBe("read_file");
    expect(r.toolCalls[0].function.arguments).toBe('{"path":"a.ts"}');
  });

  it("支持同一响应里的多个并行 tool_call", () => {
    const a = new StreamAssembler();
    a.addDelta({ tool_calls: [{ index: 0, id: "c0", function: { name: "read_file", arguments: "{}" } }] });
    a.addDelta({ tool_calls: [{ index: 1, id: "c1", function: { name: "bash", arguments: "{}" } }] });
    const r = a.result();
    expect(r.toolCalls.map((t) => t.id)).toEqual(["c0", "c1"]);
  });

  it("setUsage 转驼峰并带进 result", () => {
    const a = new StreamAssembler();
    a.setUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(a.result().usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });
});
