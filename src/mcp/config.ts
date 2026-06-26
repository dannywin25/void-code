import { readFile } from "node:fs/promises";

export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export async function loadMcpConfig(path: string): Promise<McpServerConfig[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return []; // 文件不存在 → 无 MCP server
  }
  const parsed = JSON.parse(raw); // 解析失败抛错，交由调用方处理
  const servers = (parsed && parsed.mcpServers) || {};
  return Object.entries(servers).map(([name, cfg]) => {
    const c = cfg as Record<string, unknown>;
    return {
      name,
      command: c.command as string | undefined,
      args: c.args as string[] | undefined,
      env: c.env as Record<string, string> | undefined,
      url: c.url as string | undefined,
    };
  });
}
