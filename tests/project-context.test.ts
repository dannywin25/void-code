import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { loadProjectContext } from "../src/context/project-context.js";

const base = "tests/.tmp-ctx";
const proj = `${base}/proj`;
const glob = `${base}/glob`;

beforeAll(async () => {
  await mkdir(proj, { recursive: true });
  await mkdir(glob, { recursive: true });
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("loadProjectContext", () => {
  it("都没有时返回空字符串", async () => {
    expect(await loadProjectContext(proj, `${base}/none`)).toBe("");
  });

  it("仅项目 CLAUDE.md", async () => {
    await writeFile(`${proj}/CLAUDE.md`, "项目约定A");
    const out = await loadProjectContext(proj, `${base}/none`);
    expect(out).toContain("项目记忆");
    expect(out).toContain("项目约定A");
    expect(out).not.toContain("全局记忆");
  });

  it("项目 + 全局都有时合并，全局在前", async () => {
    await writeFile(`${proj}/CLAUDE.md`, "项目约定A");
    await writeFile(`${glob}/CLAUDE.md`, "全局约定B");
    const out = await loadProjectContext(proj, glob);
    expect(out).toContain("全局约定B");
    expect(out).toContain("项目约定A");
    expect(out.indexOf("全局约定B")).toBeLessThan(out.indexOf("项目约定A"));
  });
});
