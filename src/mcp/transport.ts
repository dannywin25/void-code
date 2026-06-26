import { spawn, ChildProcess } from "node:child_process";

export interface Transport {
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
  onMessage(handler: (msg: any) => void): void;
  close(): Promise<void>;
}

export class StdioTransport implements Transport {
  private child?: ChildProcess;
  private handler: (msg: any) => void = () => {};
  private buffer = "";

  constructor(
    private command: string,
    private args: string[] = [],
    private env?: Record<string, string>
  ) {}

  async start(): Promise<void> {
    const child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, ...this.env },
    });
    this.child = child;
    child.stdout!.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    // stderr 忽略：MCP server 常往 stderr 打日志
    // 等待可能的 ENOENT 等 spawn 错误
    await new Promise<void>((resolve, reject) => {
      child.once("error", (err) => reject(err));
      child.once("spawn", () => resolve());
      // 如果进程已有状态（极少情况），立即 resolve
      if (child.pid !== undefined) resolve();
    });
  }

  private onData(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        this.handler(JSON.parse(line));
      } catch {
        // 非 JSON 行跳过
      }
    }
  }

  onMessage(handler: (msg: any) => void): void {
    this.handler = handler;
  }

  async send(message: unknown): Promise<void> {
    if (!this.child) throw new Error("StdioTransport 未启动");
    this.child.stdin!.write(JSON.stringify(message) + "\n");
  }

  async close(): Promise<void> {
    this.child?.kill();
  }
}

// 从 SSE 文本里抽出所有 data: 行的内容
export function parseSseData(body: string): string[] {
  const out: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("data:")) out.push(line.slice(5).trim());
  }
  return out;
}

export class HttpTransport implements Transport {
  private handler: (msg: any) => void = () => {};
  private sessionId?: string;

  constructor(private url: string) {}

  async start(): Promise<void> {
    // HTTP 无需预先建立连接
  }

  onMessage(handler: (msg: any) => void): void {
    this.handler = handler;
  }

  async send(message: unknown): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    // 通知（无 id）：服务端通常回 202 无体，不解析
    if ((message as any)?.id === undefined) return;

    if (!res.ok) {
      throw new Error(`MCP HTTP 请求失败：${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const body = await res.text();
      for (const data of parseSseData(body)) {
        try {
          this.handler(JSON.parse(data));
        } catch {
          // 跳过非 JSON 的 data 行
        }
      }
    } else {
      this.handler(await res.json());
    }
  }

  async close(): Promise<void> {
    // 最小实现：无显式会话关闭
  }
}
