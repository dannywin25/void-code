import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("无 --resume", () => {
    expect(parseArgs([])).toEqual({ resume: false });
  });
  it("--resume 无 id", () => {
    expect(parseArgs(["--resume"])).toEqual({ resume: true });
  });
  it("--resume 带 id", () => {
    expect(parseArgs(["--resume", "abc123"])).toEqual({ resume: true, resumeId: "abc123" });
  });
  it("--resume 后跟另一个 flag 不当作 id", () => {
    expect(parseArgs(["--resume", "--foo"])).toEqual({ resume: true });
  });
});
