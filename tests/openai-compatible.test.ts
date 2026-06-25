import { describe, it, expect } from "vitest";
import { OpenAICompatibleProvider } from "../src/provider/openai-compatible.js";

// 伪造一个 OpenAI 流式响应（async iterable of chunks）
async function* fakeStream() {
  yield { choices: [{ delta: { content: "处理中" } }] };
  yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: '{"path":"a"}' } }] } }] };
}

describe("OpenAICompatibleProvider", () => {
  it("把流式 chunk 拼装成 ChatResult，并回调文本增量", async () => {
    const provider = new OpenAICompatibleProvider(
      { apiKey: "k", baseURL: "http://x", model: "glm-4-flash", maxTokens: 100 },
      // 注入 streamFactory，绕过真实网络
      async () => fakeStream() as any
    );
    const seen: string[] = [];
    const result = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      onTextDelta: (d) => seen.push(d),
    });
    expect(result.text).toBe("处理中");
    expect(seen).toEqual(["处理中"]);
    expect(result.toolCalls[0].function.name).toBe("read_file");
  });

  it("捕获流末尾 chunk 的 usage", async () => {
    async function* withUsage() {
      yield { choices: [{ delta: { content: "hi" } }] };
      yield { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } };
    }
    const provider = new OpenAICompatibleProvider(
      { apiKey: "k", baseURL: "http://x", model: "glm-4-flash", maxTokens: 100 },
      async () => withUsage() as any
    );
    const r = await provider.chat({ messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(r.usage).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
  });
});
