import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ChatMessage } from "../provider/types.js";

export interface StoredSession {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

function projectKey(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

export function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  const result = [...messages];
  for (let i = result.length - 1; i >= 0; i--) {
    const m = result[i];
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      const answered = new Set(
        result.slice(i + 1).filter((x) => x.role === "tool").map((x) => x.tool_call_id)
      );
      const allAnswered = m.tool_calls.every((tc) => answered.has(tc.id));
      // 最后一个带 tool_calls 的 assistant 若未被完整闭合 → 裁掉它及其后所有消息
      return allAnswered ? result : result.slice(0, i);
    }
  }
  return result;
}

export class SessionStore {
  constructor(private baseDir: string = join(homedir(), ".void-code")) {}

  private dirFor(cwd: string): string {
    return join(this.baseDir, "sessions", projectKey(cwd));
  }

  newId(now: Date): string {
    return now.toISOString().replace(/[:.]/g, "-");
  }

  async save(session: {
    id: string;
    cwd: string;
    createdAt: string;
    messages: ChatMessage[];
  }): Promise<void> {
    const dir = this.dirFor(session.cwd);
    await mkdir(dir, { recursive: true });
    const stored: StoredSession = {
      id: session.id,
      cwd: session.cwd,
      createdAt: session.createdAt,
      updatedAt: new Date().toISOString(),
      messages: session.messages,
    };
    await writeFile(join(dir, `${session.id}.json`), JSON.stringify(stored, null, 2), "utf8");
  }

  async load(cwd: string, id: string): Promise<StoredSession | null> {
    try {
      const raw = await readFile(join(this.dirFor(cwd), `${id}.json`), "utf8");
      return JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
  }

  async loadLatest(cwd: string): Promise<StoredSession | null> {
    let files: string[];
    try {
      files = (await readdir(this.dirFor(cwd))).filter((f) => f.endsWith(".json"));
    } catch {
      return null;
    }
    if (files.length === 0) return null;
    files.sort();
    const latest = files[files.length - 1].replace(/\.json$/, "");
    return this.load(cwd, latest);
  }
}
