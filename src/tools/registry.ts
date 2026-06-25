import { ToolCall, ToolSchema } from "../provider/types.js";

export interface Tool {
  schema: ToolSchema;
  isWriteOrExec: boolean;
  execute(args: Record<string, unknown>): Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.schema.function.name, tool);
  }

  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => t.schema);
  }

  isWriteOrExec(name: string): boolean {
    return this.tools.get(name)?.isWriteOrExec ?? false;
  }

  async execute(call: ToolCall): Promise<string> {
    const tool = this.tools.get(call.function.name);
    if (!tool) return `错误：未知工具 "${call.function.name}"`;

    let args: Record<string, unknown>;
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return `错误：工具参数不是合法 JSON：${call.function.arguments}`;
    }

    try {
      return await tool.execute(args);
    } catch (e) {
      return `错误：工具执行失败：${(e as Error).message}`;
    }
  }
}
