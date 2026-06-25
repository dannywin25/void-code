import { Provider } from "../provider/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { Session } from "../context/session.js";
import { approveIfNeeded } from "../permission/approve.js";

export interface LoopUI {
  renderAssistant(text: string): void;
  thinkingStart(): void;
  thinkingStop(): void;
  toolCall(name: string, preview: string): void;
  toolResult(s: string): void;
  info(s: string): void;
  confirm(message: string): Promise<boolean>;
}

export interface LoopDeps {
  provider: Provider;
  registry: ToolRegistry;
  session: Session;
  ui: LoopUI;
  maxIterations: number;
}

export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
}

// 启发式：文本里出现 shell 类围栏代码块，疑似模型只描述命令而没真正调用工具
export function looksLikeUncalledCommand(text: string): boolean {
  return /```(bash|sh|shell|zsh|console)\b/i.test(text);
}

export async function runTurn(
  input: string,
  deps: LoopDeps,
  signal?: AbortSignal
): Promise<TurnUsage> {
  const { provider, registry, session, ui, maxIterations } = deps;
  session.addUser(input);

  let promptTokens = 0;
  let completionTokens = 0;
  let nudged = false;

  try {
    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) {
        ui.info("已中断当前操作。");
        return { promptTokens, completionTokens };
      }

      ui.thinkingStart();
      let result;
      try {
        result = await provider.chat({
          messages: session.messages,
          tools: registry.schemas(),
          signal,
        });
      } finally {
        ui.thinkingStop();
      }

      session.addAssistant(result.text, result.toolCalls);
      ui.renderAssistant(result.text);

      if (result.usage) {
        promptTokens += result.usage.promptTokens;
        completionTokens += result.usage.completionTokens;
      }

      if (result.toolCalls.length === 0) {
        // 工具调用兜底：疑似只写了命令代码块、未真正调用工具 → 督促一次
        if (!nudged && looksLikeUncalledCommand(result.text)) {
          nudged = true;
          session.addUser("（系统提醒）请直接调用工具来执行，不要只在回答里用代码块写出命令。");
          continue;
        }
        return { promptTokens, completionTokens };
      }

      for (const call of result.toolCalls) {
        ui.toolCall(call.function.name, call.function.arguments);
        const isWrite = registry.isWriteOrExec(call.function.name);
        const approved = await approveIfNeeded(call, isWrite, ui);
        const output = approved ? await registry.execute(call) : "用户拒绝了该操作。";
        ui.toolResult(output);
        session.addToolResult(call.id, output);
      }
    }

    ui.info(`已达到单轮最大迭代次数 (${maxIterations})，已中止。`);
    return { promptTokens, completionTokens };
  } catch (e) {
    if (e instanceof Error && (e.name === "AbortError" || e.name === "APIUserAbortError")) {
      ui.info("已中断当前操作。");
      return { promptTokens, completionTokens };
    }
    throw e;
  }
}
