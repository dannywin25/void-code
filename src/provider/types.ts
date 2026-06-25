export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage?: Usage;
}

export interface ChatParams {
  messages: ChatMessage[];
  tools: ToolSchema[];
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface Provider {
  chat(params: ChatParams): Promise<ChatResult>;
}
