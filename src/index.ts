import "dotenv/config";
import { loadConfig } from "./config.js";
import { OpenAICompatibleProvider } from "./provider/openai-compatible.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read.js";
import { writeFileTool, editFileTool } from "./tools/write.js";
import { bashTool } from "./tools/bash.js";
import { searchTool } from "./tools/search.js";
import { listFilesTool } from "./tools/list.js";
import { Session } from "./context/session.js";
import { buildSystemPrompt } from "./context/system-prompt.js";
import { Terminal } from "./ui/terminal.js";
import { runTurn } from "./agent/loop.js";
import { handleCommand } from "./ui/commands.js";
import { parseArgs } from "./cli.js";
import { SessionStore, sanitizeMessages } from "./context/store.js";
import { compactIfNeeded } from "./context/compact.js";
import { loadProjectContext, defaultGlobalDir } from "./context/project-context.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const provider = new OpenAICompatibleProvider({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    model: config.model,
    maxTokens: config.maxTokens,
  });

  const registry = new ToolRegistry();
  for (const tool of [readFileTool, writeFileTool, editFileTool, bashTool, searchTool, listFilesTool]) {
    registry.register(tool);
  }

  const ui = new Terminal();
  const store = new SessionStore();
  const args = parseArgs(process.argv.slice(2));

  const baseSystemPrompt =
    buildSystemPrompt(process.cwd(), process.platform) +
    (await loadProjectContext(process.cwd(), defaultGlobalDir()));

  let session: Session;
  let sessionId: string;
  let createdAt: string;

  if (args.resume) {
    const stored = args.resumeId
      ? await store.load(process.cwd(), args.resumeId)
      : await store.loadLatest(process.cwd());
    if (stored) {
      session = new Session(sanitizeMessages(stored.messages));
      sessionId = stored.id;
      createdAt = stored.createdAt;
      ui.info(`已恢复会话 ${stored.id}（${stored.messages.length} 条消息）。`);
    } else {
      ui.info("没有可恢复的会话，开始新会话。");
      session = new Session(baseSystemPrompt);
      sessionId = store.newId(new Date());
      createdAt = new Date().toISOString();
    }
  } else {
    session = new Session(baseSystemPrompt);
    sessionId = store.newId(new Date());
    createdAt = new Date().toISOString();
  }

  ui.info(`void-code 已启动（模型 ${config.model}）。输入需求，或 /help 查看命令，exit 退出。`);

  const ctx = { session, registry, model: config.model };
  const deps = { provider, registry, session, ui, maxIterations: config.maxIterations };

  let totalPrompt = 0;
  let totalCompletion = 0;
  let activeController: AbortController | null = null;
  let pendingExit = false;

  // Ctrl+C 两段式：进行中→中断当前轮；空闲连按两次→退出。
  // 同时挂 readline 与 process 两条路径：rl.question 期间(raw模式)走 rl 事件，
  // runTurn 进行中走 process 事件。用 sigintLock 吞掉同一次按键的重复触发。
  let sigintLock = false;
  const onInterrupt = () => {
    if (sigintLock) return;
    sigintLock = true;
    setTimeout(() => {
      sigintLock = false;
    }, 0);

    if (activeController) {
      activeController.abort();
      activeController = null;
      return;
    }
    if (pendingExit) {
      ui.close();
      process.exit(0);
    }
    pendingExit = true;
    ui.info("再按一次 Ctrl+C 退出。");
  };
  ui.onSigint(onInterrupt);
  process.on("SIGINT", onInterrupt);

  while (true) {
    const input = await ui.prompt();
    pendingExit = false; // 有新输入即清除待退出标志
    if (!input) continue;

    const cmd = handleCommand(input, ctx);
    if (cmd.handled) {
      if (cmd.message) ui.info(cmd.message);
      if (cmd.exit) break;
      if (!cmd.runPrompt) continue;
    } else if (input === "exit") {
      break; // 兼容旧的纯 exit
    }

    const turnInput = cmd.runPrompt ?? input;
    activeController = new AbortController();
    try {
      const used = await runTurn(turnInput, deps, activeController.signal);
      totalPrompt += used.promptTokens;
      totalCompletion += used.completionTokens;
      if (used.promptTokens || used.completionTokens) {
        ui.usage(
          `本轮 prompt ${used.promptTokens} / completion ${used.completionTokens} ｜ 累计 ${totalPrompt + totalCompletion}`
        );
      }
      try {
        if (
          await compactIfNeeded(
            session,
            provider,
            { threshold: config.compactThreshold, keepRecent: config.compactKeepRecent },
            activeController.signal
          )
        ) {
          ui.info("（已压缩历史以节省上下文）");
        }
      } catch {
        // 压缩失败不影响主流程
      }
    } catch (e) {
      ui.info(`出错：${(e as Error).message}`);
    } finally {
      try {
        await store.save({ id: sessionId, cwd: process.cwd(), createdAt, messages: session.messages });
      } catch {
        // 保存失败不影响主流程
      }
      activeController = null;
    }
  }

  ui.close();
}

main();
