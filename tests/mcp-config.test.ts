import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { loadMcpConfig } from "../src/mcp/config.js";

const dir = "tests/.tmp-mcp";
beforeAll(async () => {
  await mkdir(dir, { recursive: true });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadMcpConfig", () => {
  it("文件不存在返回 []", async () => {
    expect(await loadMcpConfig(`${dir}/nope.json`)).toEqual([]);
  });

  it("解析 stdio 与 http 两类配置", async () => {
    await writeFile(
      `${dir}/.mcp.json`,
      JSON.stringify({
        mcpServers: {
          fs: { command: "npx", args: ["-y", "server-fs", "."] },
          remote: { url: "https://x/mcp" },
        },
      })
    );
    const servers = await loadMcpConfig(`${dir}/.mcp.json`);
    expect(servers).toHaveLength(2);
    const fs = servers.find((s) => s.name === "fs")!;
    expect(fs.command).toBe("npx");
    expect(fs.args).toEqual(["-y", "server-fs", "."]);
    expect(servers.find((s) => s.name === "remote")!.url).toBe("https://x/mcp");
  });
});
