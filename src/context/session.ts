import { ChatMessage, ToolCall } from "../provider/types.js";

export class Session {
  readonly messages: ChatMessage[] = [];

  constructor(init: string | ChatMessage[]) {
    if (typeof init === "string") {
      this.messages.push({ role: "system", content: init });
    } else {
      this.messages.push(...init);
    }
  }

  addUser(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistant(text: string, toolCalls: ToolCall[]): void {
    this.messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });
  }

  addToolResult(toolCallId: string, content: string): void {
    this.messages.push({ role: "tool", tool_call_id: toolCallId, content });
  }

  clear(): void {
    this.messages.splice(1); // 删除索引 1 及之后，保留第一条 system 消息
  }
}
