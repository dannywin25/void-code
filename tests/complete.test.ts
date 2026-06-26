import { describe, it, expect } from "vitest";
import { completeSlash, SLASH_COMMANDS } from "../src/ui/commands.js";

describe("completeSlash", () => {
  it("按前缀筛选候选", () => {
    const cands = ["/skills", "/skill commit-msg", "/help"];
    expect(completeSlash("/sk", cands)).toEqual(["/skills", "/skill commit-msg"]);
  });
  it("更长前缀只留精确匹配", () => {
    expect(completeSlash("/he", SLASH_COMMANDS)).toEqual(["/help"]);
  });
  it("非斜杠输入不匹配任何命令候选", () => {
    expect(completeSlash("hello", SLASH_COMMANDS)).toEqual([]);
  });
  it("单个 / 列出全部命令", () => {
    expect(completeSlash("/", SLASH_COMMANDS)).toEqual(SLASH_COMMANDS);
  });
});

describe("SLASH_COMMANDS", () => {
  it("含核心命令", () => {
    expect(SLASH_COMMANDS).toContain("/help");
    expect(SLASH_COMMANDS).toContain("/skills");
  });
});
