import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/ui/markdown.js";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderMarkdown", () => {
  it("渲染标题与列表后仍含原文要点", () => {
    const out = strip(renderMarkdown("# 标题\n\n- 项目一\n- 项目二"));
    expect(out).toContain("标题");
    expect(out).toContain("项目一");
    expect(out).toContain("项目二");
  });

  it("普通文本原样保留", () => {
    expect(strip(renderMarkdown("你好世界"))).toContain("你好世界");
  });
});
