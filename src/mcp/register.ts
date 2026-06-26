import { Tool, ToolRegistry } from "../tools/registry.js";
import { McpClient, McpToolDef } from "./client.js";
import { McpServerConfig } from "./config.js";
import { StdioTransport, HttpTransport, Transport } from "./transport.js";

function makeTransport(cfg: McpServerConfig): Transport {
  if (cfg.url) return new HttpTransport(cfg.url);
  if (cfg.command) return new StdioTransport(cfg.command, cfg.args ?? [], cfg.env);
  throw new Error(`MCP server "${cfg.name}" 配置缺少 command 或 url`);
}

export function wrapMcpTool(client: McpClient, serverName: string, def: McpToolDef): Tool {
  return {
    isWriteOrExec: true,
    schema: {
      type: "function",
      function: {
        name: `mcp__${serverName}__${def.name}`,
        description: def.description ?? "",
        parameters: def.inputSchema ?? { type: "object", properties: {} },
      },
    },
    async execute(args) {
      return client.callTool(def.name, args);
    },
  };
}

export async function connectAndRegisterMcp(
  servers: McpServerConfig[],
  registry: ToolRegistry,
  log: (msg: string) => void
): Promise<McpClient[]> {
  const clients: McpClient[] = [];
  for (const cfg of servers) {
    try {
      const client = new McpClient(makeTransport(cfg));
      await client.connect();
      const tools = await client.listTools();
      for (const t of tools) registry.register(wrapMcpTool(client, cfg.name, t));
      clients.push(client);
      log(`已连接 MCP server "${cfg.name}"（${tools.length} 个工具）`);
    } catch (e) {
      log(`连接 MCP server "${cfg.name}" 失败，已跳过：${(e as Error).message}`);
    }
  }
  return clients;
}
