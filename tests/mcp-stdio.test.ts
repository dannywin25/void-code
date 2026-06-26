import { describe, it, expect } from "vitest";
import { StdioTransport } from "../src/mcp/transport.js";
import { McpClient } from "../src/mcp/client.js";

describe("StdioTransport + McpClient（集成 mock server）", () => {
  it("connect / listTools / callTool 往返", async () => {
    const transport = new StdioTransport("node", ["tests/fixtures/mock-mcp-server.mjs"]);
    const client = new McpClient(transport);
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("echo");
    expect(await client.callTool("echo", { text: "hi" })).toBe("echo: hi");
    await client.close();
  });
});
