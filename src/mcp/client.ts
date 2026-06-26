import { Transport } from "./transport.js";

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2024-11-05";

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

export class McpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private clientInfo: { name: string; version: string };

  constructor(
    private transport: Transport,
    clientInfo?: { name: string; version: string },
    private requestTimeoutMs = 30000
  ) {
    this.clientInfo = clientInfo ?? { name: "void-code", version: "0.1.0" };
    this.transport.onMessage((msg) => this.handleMessage(msg));
  }

  private handleMessage(msg: any): void {
    if (msg && typeof msg.id === "number" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "MCP 错误"));
      else p.resolve(msg.result);
    }
    // 无 id 的通知忽略
  }

  private request(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}（${this.requestTimeoutMs}ms）`));
      }, this.requestTimeoutMs);
      if (typeof (timer as any).unref === "function") (timer as any).unref();
      this.pending.set(id, {
        resolve: (v: any) => { clearTimeout(timer); resolve(v); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      });
      this.transport.send({ jsonrpc: "2.0", id, method, params }).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private notify(method: string, params?: unknown): Promise<void> {
    return this.transport.send({ jsonrpc: "2.0", method, params });
  }

  async connect(): Promise<void> {
    await this.transport.start();
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: this.clientInfo,
    });
    await this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = await this.request("tools/list");
    return (result?.tools ?? []) as McpToolDef[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request("tools/call", { name, arguments: args });
    return formatToolResult(result);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

function formatToolResult(result: any): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  const parts = content.map((c: any) =>
    c?.type === "text" ? String(c.text ?? "") : `[非文本内容: ${c?.type ?? "unknown"}]`
  );
  const text = parts.join("\n");
  return result?.isError ? `错误：${text}` : text;
}
