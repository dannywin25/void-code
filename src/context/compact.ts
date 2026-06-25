import { ChatMessage, Provider } from "../provider/types.js";
import { Session } from "./session.js";

export function estimateTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((sum, m) => {
    const content = m.content ? m.content.length : 0;
    const tools = m.tool_calls ? JSON.stringify(m.tool_calls).length : 0;
    return sum + content + tools;
  }, 0);
  return Math.ceil(chars / 4);
}

export interface CompactOptions {
  threshold: number;
  keepRecent: number;
}

export async function compactIfNeeded(
  session: Session,
  provider: Provider,
  opts: CompactOptions,
  signal?: AbortSignal
): Promise<boolean> {
  const msgs = session.messages;
  if (estimateTokens(msgs) <= opts.threshold) return false;

  const system = msgs[0];
  const recentStart = Math.max(1, msgs.length - opts.keepRecent);
  const toCompact = msgs.slice(1, recentStart);
  if (toCompact.length === 0) return false; // 没有可压缩的中间消息

  const recent = msgs.slice(recentStart);
  const summaryText = await summarize(provider, toCompact, signal);
  const summaryMsg: ChatMessage = {
    role: "user",
    content: `（此前对话的摘要）\n${summaryText}`,
  };

  // 原地替换 session.messages 内容（messages 属性 readonly，但数组可变）
  session.messages.splice(0, session.messages.length, system, summaryMsg, ...recent);
  return true;
}

async function summarize(provider: Provider, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const text = messages.map((m) => `[${m.role}] ${m.content ?? ""}`).join("\n");
  const result = await provider.chat({
    messages: [
      {
        role: "system",
        content:
          "把下面的对话历史压缩成简洁摘要，保留关键事实、做出的决定、文件改动和未完成的事项。只输出摘要正文，不要寒暄。",
      },
      { role: "user", content: text },
    ],
    tools: [],
    signal,
  });
  return result.text;
}
