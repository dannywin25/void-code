// 极小 MCP server：读换行分隔 JSON-RPC，回应 initialize / tools/list / tools/call
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "1.0" } },
    });
  } else if (msg.method === "notifications/initialized") {
    // 通知，无需回应
  } else if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          { name: "echo", description: "回显输入", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
        ],
      },
    });
  } else if (msg.method === "tools/call") {
    const text = msg.params?.arguments?.text ?? "";
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `echo: ${text}` }] } });
  } else if (msg.id !== undefined) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
});
