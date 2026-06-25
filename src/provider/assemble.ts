import { ChatResult, ToolCall, Usage } from "./types.js";

export interface StreamDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

export class StreamAssembler {
  private text = "";
  private toolCalls: ToolCall[] = [];
  private usage?: Usage;

  addDelta(delta: StreamDelta, onText?: (d: string) => void): void {
    if (delta.content) {
      this.text += delta.content;
      onText?.(delta.content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        let existing = this.toolCalls[tc.index];
        if (!existing) {
          existing = { id: "", type: "function", function: { name: "", arguments: "" } };
          this.toolCalls[tc.index] = existing;
        }
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  setUsage(raw: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): void {
    this.usage = {
      promptTokens: raw.prompt_tokens ?? 0,
      completionTokens: raw.completion_tokens ?? 0,
      totalTokens: raw.total_tokens ?? 0,
    };
  }

  result(): ChatResult {
    return { text: this.text, toolCalls: this.toolCalls.filter(Boolean), usage: this.usage };
  }
}
