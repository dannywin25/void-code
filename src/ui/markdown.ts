import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

// 注册终端渲染器（模块级一次性）。markedTerminal 的类型与 marked 的 use() 略有出入，用 as any 兼容。
marked.use(markedTerminal() as any);

export function renderMarkdown(text: string): string {
  const rendered = marked.parse(text, { async: false }) as string;
  return rendered.trimEnd();
}
