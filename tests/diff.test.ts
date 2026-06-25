import { describe, it, expect } from "vitest";
import { renderDiff } from "../src/ui/diff.js";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderDiff", () => {
  it("标记新增与删除行", () => {
    const out = strip(renderDiff("a\nb\n", "a\nc\n"));
    expect(out).toContain("- b");
    expect(out).toContain("+ c");
    expect(out).toContain("  a");
  });

  it("旧内容为空时全部按新增", () => {
    const out = strip(renderDiff("", "x\ny\n"));
    expect(out).toContain("+ x");
    expect(out).toContain("+ y");
    expect(out).not.toContain("- ");
  });
});
